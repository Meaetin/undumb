const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { OfficeStore } = require('./store.cjs')
const { CodexSessions } = require('./codex.cjs')
const { gitStatus, initializeGit } = require('./git.cjs')

app.setName('Boss Office GUI')
if (process.env.BOSS_OFFICE_GUI_SMOKE_DIR) {
  const smokeRoot = path.resolve(process.env.BOSS_OFFICE_GUI_SMOKE_DIR)
  const appRoot = path.resolve(__dirname, '..')
  if (!smokeRoot.startsWith(appRoot + path.sep)) throw new Error('Smoke data must stay inside this app folder.')
  fs.mkdirSync(smokeRoot, { recursive: true })
  app.setPath('userData', smokeRoot)
}
const devUrl = 'http://127.0.0.1:5174/'
const builtUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href
const pendingImages = new Map()
const pendingFiles = new Map()
let mainWindow = null
let store = null
let codex = null

function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame ||
    ![devUrl, builtUrl].includes(event.sender.getURL())) throw new Error('Only the main office window can use this API.')
}

function guard(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => { trusted(event); return handler(...args) })
}

function registerApi() {
  guard('gui:get-state', () => codex.snapshot())
  guard('gui:create-project', name => { const result = store.createProject(name); codex.emitState(); return result })
  guard('gui:hire-intern', (projectId, name) => { const result = store.hireIntern(projectId, name); codex.emitState(); return result })
  guard('gui:create-session', (projectId, agentId, carryTask) => {
    const result = store.createSession(projectId, agentId, { carryTask: Boolean(carryTask) }); codex.emitState(); return result
  })
  guard('gui:select-session', (projectId, agentId, sessionId) => {
    const result = store.selectSession(projectId, agentId, sessionId); codex.emitState(); return result
  })
  guard('gui:git-status', projectId => gitStatus(store.getProject(projectId).root))
  guard('gui:init-git', projectId => { const result = initializeGit(store.getProject(projectId).root); codex.emitState(); return result })
  guard('gui:unassign-task', (projectId, taskId) => { const result = store.unassignTask(projectId, taskId); codex.emitState(); return result })
  guard('gui:open-project-folder', async projectId => {
    const error = await shell.openPath(store.getProject(projectId).root)
    if (error) throw new Error(error)
  })
  guard('gui:reconnect', () => codex.start())
  guard('gui:answer-request', (id, answer) => codex.answerRequest(id, answer))
  guard('gui:interrupt', (projectId, agentId, sessionId) => codex.interrupt(projectId, agentId, sessionId))
  guard('gui:compact', (projectId, agentId, sessionId) => codex.compact(projectId, agentId, sessionId))
  guard('gui:pick-images', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Add images to message', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    })
    if (selected.canceled) return []
    if (selected.filePaths.length > 4) throw new Error('Attach up to four images per message.')
    return selected.filePaths.map(filePath => {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('Each image must be a file under 10 MB.')
      const extension = path.extname(filePath).toLowerCase()
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extension]
      if (!mime) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.')
      const id = randomUUID()
      pendingImages.set(id, { path: filePath, name: path.basename(filePath) })
      return { id, name: path.basename(filePath), dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` }
    })
  })
  guard('gui:pick-files', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach files to message', properties: ['openFile', 'multiSelections'],
    })
    if (selected.canceled) return []
    if (selected.filePaths.length > 4) throw new Error('Attach up to four files per message.')
    return selected.filePaths.map(filePath => {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Each file must be under 20 MB.')
      const id = randomUUID()
      pendingFiles.set(id, { path: filePath, name: path.basename(filePath) })
      return { id, name: path.basename(filePath) }
    })
  })
  guard('gui:send-message', async (projectId, agentId, sessionId, text, imageIds, fileIds, taskId, baseTaskId) => {
    if (!Array.isArray(imageIds) || imageIds.length > 4 || imageIds.some(id => typeof id !== 'string' || !pendingImages.has(id))) throw new Error('Select up to four images in the office.')
    if (!Array.isArray(fileIds) || fileIds.length > 4 || fileIds.some(id => typeof id !== 'string' || !pendingFiles.has(id))) throw new Error('Select up to four files in the office.')
    const { project, session: chat } = store.getSession(projectId, agentId, sessionId)
    const attachmentRoot = path.join(store.userDataPath, 'attachments', project.id, chat.id)
    fs.mkdirSync(attachmentRoot, { recursive: true })
    function saved(source, id) {
      const target = path.join(attachmentRoot, `${id}${path.extname(source.name).slice(0, 12)}`)
      fs.copyFileSync(source.path, target)
      return { path: target, name: source.name }
    }
    const images = imageIds.map(id => saved(pendingImages.get(id), id))
    const files = fileIds.map(id => saved(pendingFiles.get(id), id))
    const result = await codex.sendMessage(projectId, agentId, sessionId, text, images, taskId, baseTaskId, files)
    for (const id of imageIds) pendingImages.delete(id)
    for (const id of fileIds) pendingFiles.delete(id)
    return result
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1420, height: 900, minWidth: 850, minHeight: 590,
    title: 'Boss Office GUI', backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
      preload: path.join(__dirname, 'preload.cjs') },
  })
  mainWindow = window
  window.loadURL(process.env.npm_lifecycle_event === 'dev' ? devUrl : builtUrl)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== (process.env.npm_lifecycle_event === 'dev' ? devUrl : builtUrl)) event.preventDefault()
  })
  window.on('closed', () => { if (mainWindow === window) mainWindow = null })
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  store = new OfficeStore({ userDataPath: app.getPath('userData') })
  codex = new CodexSessions(store)
  codex.on('state', state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('gui:state', state) })
  registerApi()
  createWindow()
  if (process.env.BOSS_OFFICE_GUI_SMOKE_DIR) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const api = window.officeApi;
          if (!api || !document.querySelector('.sidebar')) throw new Error('Renderer or preload did not load');
          const project = await api.createProject('Smoke Project');
          const intern = await api.hireIntern(project.id, 'Smoke Intern');
          const state = await api.getState();
          if (state.projects[0].agents.length !== 2 || !state.projects[0].agents.some(agent => agent.id === intern.id)) throw new Error('Project or intern was not saved');
          return { projectId: project.id, project: project.name, intern: intern.name, title: document.title };
        })()`)
        mainWindow.show()
        await new Promise(resolve => setTimeout(resolve, 800))
        const screenshotPath = path.join(__dirname, '../screenshots/gui-smoke.png')
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
        const screenshot = (await mainWindow.webContents.capturePage()).toPNG()
        if (screenshot.length) fs.writeFileSync(screenshotPath, screenshot)
        store.createTask(result.projectId, '# Smoke task\n\nCreate a simple, keyboard-accessible greeting page.')
        codex.emitState()
        await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('[role="tab"]')[1].click()`)
        await new Promise(resolve => setTimeout(resolve, 300))
        const boardScreenshot = (await mainWindow.webContents.capturePage()).toPNG()
        if (boardScreenshot.length) fs.writeFileSync(path.join(__dirname, '../screenshots/gui-whiteboard-smoke.png'), boardScreenshot)
        process.stdout.write(JSON.stringify(result) + '\n')
        app.exit(0)
      } catch (error) { process.stderr.write(`GUI smoke failed: ${error.message}\n`); app.exit(1) }
    })
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => codex?.stop())
