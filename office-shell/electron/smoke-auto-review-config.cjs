const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { CodexBridge } = require('./codex-bridge.cjs')

async function main() {
  const root = fs.mkdtempSync(path.join(__dirname, '.auto-review-smoke-'))
  const bridge = new CodexBridge({ userDataPath: root, getProject: () => null })
  try {
    bridge.officeControls.update({ approvalReviewer: 'auto_review' })
    try { await bridge.start() }
    catch (error) { throw new Error(`${error.message}\n${bridge.lastStderr || ''}`) }
    const result = await bridge.rpc('config/read', { includeLayers: false })
    const reviewer = result?.config?.approvals_reviewer
    assert.equal(reviewer, 'auto_review', 'App-server did not apply the office-only reviewer override')
    await bridge.updateControls({ approvalReviewer: 'user' })
    const manual = await bridge.rpc('config/read', { includeLayers: false })
    assert.equal(manual?.config?.approvals_reviewer, 'user', 'Live mode change did not restart the app-server')
    console.log('App-server accepted Auto-review and switched back to manual review without changing global config.')
  } finally {
    const child = bridge.child
    const closed = child && new Promise(resolve => child.once('close', resolve))
    bridge.stop()
    if (closed) await closed
    const resolved = path.resolve(root)
    if (path.dirname(resolved) === __dirname && path.basename(resolved).startsWith('.auto-review-smoke-')) {
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
