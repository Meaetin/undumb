const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { CodexBridge, resolveCodexCommand } = require('./codex-bridge.cjs')

async function main() {
  if (process.platform !== 'win32') return console.log('Windows Codex launch smoke skipped on this platform.')
  const executable = resolveCodexCommand('codex', { ...process.env, PATH: '' }, 'win32')
  assert.ok(path.isAbsolute(executable) && fs.statSync(executable).isFile(), 'Installed Codex executable was not found')

  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-office-codex-launch-'))
  const bridge = new CodexBridge({ userDataPath, getProject: () => null })
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH'
  const originalPath = process.env[pathKey]
  try {
    process.env[pathKey] = ''
    await bridge.start()
    assert.equal(bridge.getState().connection, 'ready')
    console.log(`Codex app-server initialized with empty PATH via ${executable}`)
  } finally {
    if (originalPath === undefined) delete process.env[pathKey]
    else process.env[pathKey] = originalPath
    bridge.stop()
    if (bridge.getState().connection !== 'stopped') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { bridge.off('state', onState); reject(new Error('Codex did not stop')) }, 10000)
        const onState = state => {
          if (state.connection !== 'stopped') return
          clearTimeout(timer)
          bridge.off('state', onState)
          resolve()
        }
        bridge.on('state', onState)
      })
    }
    const resolved = path.resolve(userDataPath)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('boss-office-codex-launch-')) {
      throw new Error('Unsafe smoke cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
