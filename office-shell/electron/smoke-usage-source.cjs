const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { CodexBridge } = require('./codex-bridge.cjs')

async function main() {
  const root = fs.mkdtempSync(path.join(__dirname, '.usage-source-smoke-'))
  const bridge = new CodexBridge({ userDataPath: root, getProject: () => null })
  try {
    await bridge.start()
    const usage = await bridge.refreshUsage()
    assert.equal(usage.status, 'ready', 'Signed-in Codex usage was unavailable')
    assert.ok(usage.buckets.length > 0, 'No Codex rate-limit window was returned')
    console.log(JSON.stringify({ status: usage.status, source: usage.source,
      bucketIds: usage.buckets.map(item => item.id), tokenActivityAvailable: Boolean(usage.tokenActivity),
      warningThresholdPercent: usage.thresholdPercent }, null, 2))
  } finally {
    const child = bridge.child
    const closed = child && new Promise(resolve => child.once('close', resolve))
    bridge.stop()
    if (closed) await closed
    const resolved = path.resolve(root)
    if (path.dirname(resolved) !== __dirname || !path.basename(resolved).startsWith('.usage-source-smoke-')) {
      throw new Error('Unsafe smoke cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
