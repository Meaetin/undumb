const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { randomUUID } = require('node:crypto')

const HOST = '127.0.0.1'
const OFFICE_ROOT = path.resolve(__dirname, '..')
const OFFICE_MODULES = path.join(OFFICE_ROOT, 'node_modules')

function trustedAliases() {
  const names = [
    'react-dom/client',
    'react/jsx-dev-runtime',
    'react/jsx-runtime',
    'react-dom',
    'react',
  ]
  return names.map(name => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    replacement: require.resolve(name, { paths: [OFFICE_ROOT] }),
  }))
}

function assertProjectRoot(project) {
  if (!project || typeof project.projectRoot !== 'string' ||
      typeof project.metadata?.id !== 'string') {
    throw new Error('Create a website project before running its preview.')
  }
  const root = path.resolve(project.projectRoot)
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('The active website project directory is invalid.')
  }
  return root
}

function chooseLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, HOST, () => {
      const address = probe.address()
      probe.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function startTrustedVite({ project, cacheRoot }) {
  const root = assertProjectRoot(project)
  const port = await chooseLoopbackPort()
  const [{ createServer }, { default: react }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react'),
  ])
  const server = await createServer({
    configFile: false,
    envFile: false,
    root,
    cacheDir: path.join(cacheRoot, project.metadata.id),
    plugins: [react({ babel: { babelrc: false, configFile: false } })],
    resolve: { alias: trustedAliases(), preserveSymlinks: false },
    css: { postcss: { plugins: [] } },
    appType: 'spa',
    server: {
      host: HOST,
      port,
      strictPort: true,
      open: false,
      cors: false,
      allowedHosts: [HOST],
      fs: { strict: true, allow: [root, OFFICE_MODULES] },
      hmr: { host: HOST },
      watch: { followSymlinks: false },
    },
  })
  try {
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string' || address.address !== HOST) {
      throw new Error('Website preview did not bind to the local loopback address.')
    }
    return { server, url: `http://${HOST}:${address.port}/` }
  } catch (error) {
    await server.close()
    throw error
  }
}

function validateBounds(bounds, window) {
  if (bounds === null) return null
  if (!bounds || typeof bounds !== 'object') throw new TypeError('Invalid preview bounds')
  const { x, y, width, height } = bounds
  if (![x, y, width, height].every(Number.isFinite)) throw new TypeError('Invalid preview bounds')
  const box = Object.fromEntries(Object.entries({ x, y, width, height }).map(([key, value]) => [key, Math.round(value)]))
  const size = window.getContentBounds()
  if (box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 ||
      box.x + box.width > size.width || box.y + box.height > size.height) {
    throw new RangeError('Preview bounds must stay within the office window')
  }
  return box
}

class PreviewRuntime {
  constructor({ window, WebContentsView, session, getProject, cacheRoot, onState }) {
    this.window = window
    this.WebContentsView = WebContentsView
    this.session = session
    this.getProject = getProject
    this.cacheRoot = cacheRoot
    this.onState = onState
    this.state = { status: 'stopped' }
    this.bounds = null
    this.view = null
    this.attached = false
    this.server = null
    this.origin = null
    this.queue = Promise.resolve()
    this.partition = `preview-${randomUUID()}` // In-memory; never use persist:.
  }

  getState() { return { ...this.state } }
  emit(state) {
    this.state = state
    this.onState?.(this.getState())
    return this.getState()
  }
  enqueue(operation) {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }
  run() { return this.enqueue(() => this.start()) }
  stop() { return this.enqueue(() => this.close()) }
  refresh() { return this.enqueue(() => this.reload()) }

  setBounds(bounds) {
    if (!this.window || this.window.isDestroyed()) return
    this.bounds = validateBounds(bounds, this.window)
    this.syncViewBounds()
  }

  syncViewBounds() {
    if (!this.view || !this.window || this.window.isDestroyed()) return
    if (this.bounds) {
      if (!this.attached) {
        this.window.contentView.addChildView(this.view)
        this.attached = true
      }
      this.view.setBounds(this.bounds)
    } else if (this.attached) {
      this.window.contentView.removeChildView(this.view)
      this.attached = false
    }
  }

  async start() {
    if (this.state.status === 'running') return this.getState()
    this.emit({ status: 'starting' })
    try {
      const { server, url } = await startTrustedVite({
        project: this.getProject(), cacheRoot: this.cacheRoot,
      })
      this.server = server
      this.origin = new URL(url).origin
      const previewSession = this.session.fromPartition(this.partition, { cache: false })
      previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      previewSession.setPermissionCheckHandler(() => false)
      previewSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        if (details.resourceType !== 'mainFrame') return callback({})
        callback({ cancel: !this.allowedNavigation(details.url) })
      })
      this.view = new this.WebContentsView({
        webPreferences: {
          partition: this.partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webviewTag: false,
          javascript: true,
        },
      })
      const contents = this.view.webContents
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      contents.on('will-navigate', (event, destination) => {
        if (!this.allowedNavigation(destination)) event.preventDefault()
      })
      contents.on('will-redirect', (event, destination) => {
        if (!this.allowedNavigation(destination)) event.preventDefault()
      })
      contents.on('will-attach-webview', event => event.preventDefault())
      contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) this.emit({ status: 'error', error: `Preview failed to load: ${description}` })
      })
      this.syncViewBounds()
      await contents.loadURL(url)
      return this.emit({ status: 'running', url })
    } catch (error) {
      await this.dispose()
      return this.emit({ status: 'error', error: error.message || String(error) })
    }
  }

  allowedNavigation(destination) {
    try {
      const url = new URL(destination)
      return url.origin === this.origin && url.protocol === 'http:'
    } catch { return false }
  }

  async dispose() {
    if (this.view) {
      if (this.attached && this.window && !this.window.isDestroyed()) {
        this.window.contentView.removeChildView(this.view)
      }
      this.attached = false
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
      this.view = null
    }
    if (this.server) {
      const server = this.server
      this.server = null
      await server.close()
    }
    this.origin = null
  }

  async close() {
    await this.dispose()
    return this.emit({ status: 'stopped' })
  }

  async reload() {
    if (this.state.status !== 'running' || !this.view || this.view.webContents.isDestroyed()) {
      throw new Error('Run the website preview before refreshing it.')
    }
    this.view.webContents.reloadIgnoringCache()
    return this.getState()
  }
}

module.exports = { PreviewRuntime, startTrustedVite, validateBounds }
