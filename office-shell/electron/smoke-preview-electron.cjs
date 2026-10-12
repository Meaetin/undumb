const { app, BrowserWindow, WebContentsView, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PreviewRuntime } = require('./preview-runtime.cjs')

async function main() {
  await app.whenReady()
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-office-preview-'))
  const projectRoot = path.join(temp, 'site')
  fs.cpSync(path.join(__dirname, 'project-starter'), projectRoot, { recursive: true })
  const window = new BrowserWindow({ show: false, width: 900, height: 700 })
  const runtime = new PreviewRuntime({
    window, WebContentsView, session,
    getProject: () => ({ projectRoot, metadata: { id: 'electron-smoke' } }),
    cacheRoot: path.join(temp, 'cache'),
  })
  try {
    runtime.setBounds({ x: 20, y: 20, width: 500, height: 400 })
    const state = await runtime.run()
    assert.equal(state.status, 'running', state.error)
    assert.ok(runtime.view && runtime.attached)
    assert.equal(runtime.view.webContents.getURL(), state.url)
    const heading = await runtime.view.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        const heading = document.querySelector('h1')?.textContent;
        if (heading) resolve(heading);
        else if (Date.now() > deadline) reject(new Error('React did not render'));
        else setTimeout(check, 100);
      };
      check();
    })`)
    assert.equal(heading, 'Your website starts here.')
    const exposed = await runtime.view.webContents.executeJavaScript(`({
      officeApi: typeof window.officeApi,
      require: typeof require,
      process: typeof process
    })`)
    assert.deepEqual(exposed, { officeApi: 'undefined', require: 'undefined', process: 'undefined' })
    const refreshed = await runtime.refresh()
    assert.equal(refreshed.status, 'running')
    runtime.setBounds(null)
    assert.equal(runtime.attached, false)
    const stopped = await runtime.stop()
    assert.equal(stopped.status, 'stopped')
    console.log('Electron preview rendered the starter, refreshed, hid, and stopped.')
  } finally {
    await runtime.stop()
    window.destroy()
    const resolved = path.resolve(temp)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('boss-office-preview-')) {
      throw new Error('Unsafe preview smoke cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
    app.quit()
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
  app.quit()
})
