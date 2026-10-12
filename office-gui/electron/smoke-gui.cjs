const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const appRoot = path.resolve(__dirname, '..')
const smokeRoot = path.join(appRoot, `.smoke-${randomUUID()}`)
const electron = path.join(appRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
if (!fs.existsSync(path.join(appRoot, 'dist', 'index.html'))) throw new Error('Run npm run build before the GUI smoke check.')
try {
  const env = { ...process.env, BOSS_OFFICE_GUI_SMOKE_DIR: smokeRoot }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(electron, [appRoot], { cwd: appRoot,
    env,
    encoding: 'utf8', timeout: 45000, windowsHide: true })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`GUI smoke exited with code ${result.status}`)
} finally {
  const safeRoot = path.resolve(smokeRoot)
  if (!safeRoot.startsWith(appRoot + path.sep)) throw new Error('Refusing to remove smoke files outside this app folder.')
  if (fs.existsSync(safeRoot)) fs.rmSync(safeRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
}
