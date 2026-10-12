const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { CodexBridge } = require('./codex-bridge.cjs')
const { createProject, getActiveProject } = require('./project-workspace.cjs')
const { PreviewRuntime } = require('./preview-runtime.cjs')
const { listProjectChanges, readProjectChange } = require('./file-review.cjs')

const builtUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href
const devUrl = 'http://127.0.0.1:5173/'
const isTrustedRenderer = contents => contents && (contents.getURL() === builtUrl || contents.getURL() === devUrl)
let mainWindow
let bridge
let preview

function activeProject() {
  const project = getActiveProject({ userDataPath: app.getPath('userData') })
  if (!project) throw new Error('Create a website project first.')
  return project
}

function trustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || !isTrustedRenderer(event.sender)) {
    throw new Error('Office API is only available to the main office window')
  }
}

function registerOfficeApi() {
  const guarded = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    trustedSender(event)
    return handler(...args)
  })
  guarded('office:get-state', () => bridge.getState())
  guarded('office:update-controls', patch => bridge.updateControls(patch))
  guarded('office:refresh-usage', () => bridge.refreshUsage())
  guarded('office:send-message', (role, text) => bridge.sendMessage(role, text))
  guarded('office:resolve-request', (id, response) => bridge.resolveRequest(id, response))
  guarded('office:approve-plan', text => bridge.approvePlan(text))
  guarded('office:revoke-plan-approval', () => bridge.revokePlanApproval())
  guarded('office:save-plan', text => bridge.savePlan(text))
  guarded('office:add-decision', value => bridge.addDecision(value))
  guarded('office:add-question', value => bridge.addQuestion(value))
  guarded('office:resolve-question', (id, answer) => bridge.resolveQuestion(id, answer))
  guarded('office:create-task', value => bridge.createTask(value))
  guarded('office:dispatch-task', id => bridge.dispatchTask(id))
  guarded('office:pause-task', id => bridge.pauseTask(id))
  guarded('office:resume-task', id => bridge.resumeTask(id))
  guarded('office:answer-escalation', (id, answer) => bridge.answerEscalation(id, answer))
  guarded('office:request-revision', (id, value) => bridge.requestRevision(id, value))
  guarded('office:accept-task', id => bridge.acceptTask(id))
  guarded('office:get-project', () => getActiveProject({ userDataPath: app.getPath('userData') }))
  guarded('office:create-project', idea => {
    const project = createProject({ userDataPath: app.getPath('userData'), idea })
    bridge.refreshProject()
    return project
  })
  guarded('office:preview:get-state', () => preview.getState())
  guarded('office:preview:run', () => preview.run())
  guarded('office:preview:stop', () => preview.stop())
  guarded('office:preview:refresh', () => preview.refresh())
  guarded('office:preview:set-bounds', bounds => preview.setBounds(bounds))
  guarded('office:review:list', () => listProjectChanges(activeProject()))
  guarded('office:review:read', relativePath => readProjectChange({
    ...activeProject(), relativePath,
  }))
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#101b23',
    title: "The Boss's Office",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow = window
  preview = new PreviewRuntime({
    window,
    WebContentsView,
    session,
    getProject: () => getActiveProject({ userDataPath: app.getPath('userData') }),
    cacheRoot: path.join(app.getPath('userData'), 'preview-cache'),
    onState: state => {
      if (!window.isDestroyed()) window.webContents.send('office:preview-state', state)
    },
  })
  const windowPreview = preview
  window.on('closed', () => {
    windowPreview.stop().catch(() => {})
    if (mainWindow === window) mainWindow = null
  })

  const devUrl = process.env.OFFICE_DEV_URL
  if (devUrl) {
    if (devUrl !== 'http://127.0.0.1:5173') throw new Error('Unexpected development URL')
    window.loadURL(devUrl)
  } else if (!app.isPackaged && process.env.npm_lifecycle_event === 'dev') {
    window.loadURL('http://127.0.0.1:5173')
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = devUrl || process.env.npm_lifecycle_event === 'dev'
      ? url.startsWith('http://127.0.0.1:5173/')
      : url === builtUrl
    if (!allowed) event.preventDefault()
  })
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'pointerLock' && isTrustedRenderer(contents))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return permission === 'pointerLock' && isTrustedRenderer(contents)
  })
  bridge = new CodexBridge({
    userDataPath: app.getPath('userData'),
    getProject: () => getActiveProject({ userDataPath: app.getPath('userData') }),
  })
  bridge.on('state', state => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('office:state', state)
  })
  registerOfficeApi()
  createWindow()
  bridge.start().catch(() => {})
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  bridge?.stop()
  preview?.stop().catch(() => {})
})
