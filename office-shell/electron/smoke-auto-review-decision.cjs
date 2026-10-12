const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { CodexBridge } = require('./codex-bridge.cjs')

async function main() {
  const base = path.resolve(__dirname, '..')
  const root = path.join(base, `.auto-review-decision-${randomUUID()}`)
  const site = path.join(root, 'site')
  const marker = path.join(root, 'sibling-marker.txt')
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(site, 'README.txt'), 'Disposable sandbox test.\n')
  const bridge = new CodexBridge({ userDataPath: root, getProject: () => null })
  bridge.officeControls.update({ approvalReviewer: 'auto_review' })
  const requests = []
  const items = []
  let finalReply = ''
  let expectedThread
  let finish
  const completed = new Promise(resolve => { finish = resolve })
  const originalNotification = bridge.onNotification.bind(bridge)
  bridge.onNotification = (method, params) => {
    if (params.threadId === expectedThread) {
      if (method === 'item/started' || method === 'item/completed') {
        items.push({ method, type: params.item?.type, command: params.item?.command, status: params.item?.status })
        if (method === 'item/completed' && params.item?.type === 'agentMessage') finalReply = params.item.text || ''
      }
      if (method === 'turn/completed') finish(params.turn)
    }
    originalNotification(method, params)
  }
  bridge.onServerRequest = message => {
    requests.push(message.method)
    const result = message.method === 'item/permissions/requestApproval'
      ? { permissions: {}, scope: 'turn' } : { decision: 'decline' }
    bridge.send({ id: message.id, result })
  }
  try {
    await bridge.start()
    const started = await bridge.rpc('thread/start', {
      cwd: site, runtimeWorkspaceRoots: [site], sandbox: 'workspace-write', approvalPolicy: 'on-request',
      baseInstructions: 'You are in a disposable local permission-routing test. Follow the exact user request. If the sandbox blocks a file write, request approval through the normal Codex mechanism; do not look for a workaround. Report the outcome briefly.',
    })
    expectedThread = started.thread.id
    const result = await bridge.rpc('turn/start', {
      threadId: expectedThread,
      cwd: site, runtimeWorkspaceRoots: [site], approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: true,
        excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      input: [{ type: 'text', text: `This is an authorized disposable test. Write only the exact text AUTO_REVIEW_PROBE to ${marker}. That file is a sibling of the site workspace. If permission is needed, request it normally. Do not edit any other file.` }],
    })
    let timeout
    const turn = await Promise.race([completed, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out waiting for Auto-review test')), 120000)
    })]).finally(() => clearTimeout(timeout))
    const commandAttempted = items.some(item => ['commandExecution', 'fileChange'].includes(item.type))
    const markerExists = fs.existsSync(marker)
    console.log(JSON.stringify({ status: turn?.status, commandAttempted, clientApprovalRequests: requests,
      markerExists, items: items.slice(-12), finalReply: finalReply.slice(0, 1000) }, null, 2))
    assert.equal(turn?.id, result.turn.id)
    assert.ok(commandAttempted, 'Codex did not try the boundary-crossing action')
    assert.equal(requests.length, 0, 'Auto-review sent a tool approval to the office client')
    assert.ok(markerExists, 'The reviewed disposable write did not complete')
    assert.equal(fs.readFileSync(marker, 'utf8'), 'AUTO_REVIEW_PROBE')
  } finally {
    const child = bridge.child
    const closed = child && new Promise(resolve => child.once('close', resolve))
    bridge.stop()
    if (closed) await closed
    const resolved = path.resolve(root)
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('.auto-review-decision-')) {
      throw new Error('Unsafe smoke cleanup path')
    }
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
