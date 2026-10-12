const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { OfficeControls } = require('./office-controls.cjs')
const { CodexBridge } = require('./codex-bridge.cjs')

const root = fs.mkdtempSync(path.join(__dirname, '.controls-test-'))
async function main() {
try {
  const controls = new OfficeControls({ userDataPath: root })
  assert.deepEqual(controls.getState().settings, {
    leadNetwork: true, internNetwork: true, internFileEdits: true, terminalCommands: true, approvalReviewer: 'user',
  })
  assert.equal(controls.getState().capabilities.terminalCommands, false)
  assert.throws(() => controls.update({ terminalCommands: false }), /not supported/)
  assert.throws(() => controls.update({ internNetwork: false }), /unavailable/)
  assert.equal(fs.existsSync(path.join(root, 'office-controls.json')), false)
  controls.update({ internFileEdits: false })
  assert.equal(new OfficeControls({ userDataPath: root }).getState().settings.internFileEdits, false)
  controls.update({ approvalReviewer: 'auto_review' })
  assert.equal(new OfficeControls({ userDataPath: root }).getState().settings.approvalReviewer, 'auto_review')
  assert.throws(() => controls.update({ approvalReviewer: 'never' }), /Unknown or invalid/)

  const projectRoot = path.join(root, 'site')
  fs.mkdirSync(projectRoot)
  const project = { projectRoot, metadata: { id: randomUUID(), idea: 'policy test' } }
  const bridge = new CodexBridge({ userDataPath: root, getProject: () => project })
  try {
    assert.deepEqual(bridge.turnPolicy('lead'), {
      sandbox: 'read-only', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: true },
    })
    assert.deepEqual(bridge.turnPolicy('intern'), {
      sandbox: 'read-only', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: true },
    })
    const rpcCalls = []
    bridge.start = async () => {}
    bridge.rpc = async (method, params) => {
      rpcCalls.push({ method, params })
      if (method === 'thread/resume') return { thread: { id: 'lead-thread' } }
      if (method === 'turn/start') return { turn: { id: 'lead-turn' } }
      throw new Error(`Unexpected RPC ${method}`)
    }
    bridge.state.roles.lead.threadId = 'lead-thread'
    await bridge.sendMessage('lead', 'Consider the website layout')
    assert.equal(rpcCalls[0].method, 'thread/resume')
    assert.equal(rpcCalls[0].params.sandbox, 'read-only')
    assert.equal(rpcCalls[1].params.sandboxPolicy.networkAccess, true, 'Per-turn policy applies to resumed threads')
    bridge.state.roles.lead.turnId = undefined
    bridge.state.roles.lead.status = 'idle'
    assert.throws(() => bridge.updateControls({ terminalCommands: false }), /not supported/)
    assert.throws(() => bridge.updateControls({ internNetwork: false }), /unavailable/)
    bridge.updateControls({ internFileEdits: true })
    assert.equal(bridge.turnPolicy('intern').sandboxPolicy.networkAccess, true)
    assert.equal(bridge.turnPolicy('intern').approvalPolicy, 'on-request')
    bridge.state.roles.intern.status = 'working'
    assert.throws(() => bridge.updateControls({ internFileEdits: false }), /Wait for the active agent/)
    assert.throws(() => bridge.updateControls({ approvalReviewer: 'user' }), /Wait for the active agent/)
    bridge.state.roles.intern.status = 'idle'
    bridge.turnStarts.add('lead')
    assert.throws(() => bridge.updateControls({ internFileEdits: false }), /Wait for the active agent/)
    bridge.turnStarts.clear()

    bridge.state.roles.intern.threadId = 'intern-thread'
    bridge.state.roles.intern.turnId = 'turn-one'
    bridge.activeInternTaskId = 'task-one'
    const sent = []
    bridge.child = { stdin: { writable: true, write: line => sent.push(JSON.parse(line)), end() {} }, kill() {} }
    assert.throws(() => bridge.updateControls({ internFileEdits: false }), /Wait for the active agent/)
    bridge.state.roles.intern.turnId = undefined
    bridge.activeInternTaskId = null
    bridge.updateControls({ internFileEdits: false })
    bridge.state.roles.intern.turnId = 'turn-two'
    bridge.activeInternTaskId = 'task-two'
    bridge.onServerRequest({ id: 17, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'intern-thread', turnId: 'turn-two', command: 'curl example.org',
      networkApprovalContext: { host: 'example.org', protocol: 'https' },
    } })
    assert.deepEqual(sent.at(-1), { id: 17, result: { decision: 'decline' } }, 'restricted turn cannot be bypassed by approval')
    bridge.onServerRequest({ id: 18, method: 'item/permissions/requestApproval', params: {
      threadId: 'intern-thread', turnId: 'turn-two', cwd: projectRoot,
      permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: projectRoot } }] } },
    } })
    assert.deepEqual(sent.at(-1), { id: 18, result: { permissions: {}, scope: 'turn' } },
      'File edits off must deny newer permission requests without asking the boss')
    bridge.onServerRequest({ id: 19, method: 'item/fileChange/requestApproval', params: {
      threadId: 'intern-thread', turnId: 'turn-two', grantRoot: projectRoot,
    } })
    assert.deepEqual(sent.at(-1), { id: 19, result: { decision: 'decline' } })
    assert.deepEqual(bridge.getState().requests, [])
  } finally { bridge.stop() }

  const settingsPath = path.join(root, 'office-controls.json')
  fs.writeFileSync(settingsPath, JSON.stringify({ version: 1, settings: {
    leadNetwork: false, internNetwork: false, internFileEdits: false, terminalCommands: true,
  } }))
  const restoredNetwork = new OfficeControls({ userDataPath: root })
  assert.equal(restoredNetwork.getState().settings.leadNetwork, true)
  assert.equal(restoredNetwork.getState().settings.internNetwork, true)
  assert.equal(restoredNetwork.getState().settings.internFileEdits, false)
  assert.equal(restoredNetwork.getState().settings.approvalReviewer, 'user')
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).settings.internNetwork, true)
  fs.writeFileSync(settingsPath, '{bad-json')
  assert.throws(() => new OfficeControls({ userDataPath: root }), /Could not load office controls/)
  const damaged = new CodexBridge({ userDataPath: root, getProject: () => project })
  try {
    assert.match(damaged.getState().controls.error, /Could not load office controls/)
    assert.throws(() => damaged.turnPolicy('intern'), /could not be loaded/)
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{bad-json', 'Bad settings are preserved for recovery')
  } finally { damaged.stop() }
  fs.writeFileSync(settingsPath, Buffer.alloc(64 * 1024 + 1, 32))
  assert.throws(() => new OfficeControls({ userDataPath: root }), /file is invalid/)
  assert.equal(fs.statSync(settingsPath).size, 64 * 1024 + 1)
  console.log('Office controls checks passed: durable settings, per-turn policy, active-turn lock, approval denial, corrupt-file recovery.')
} finally {
  const resolved = path.resolve(root)
  if (path.dirname(resolved) === __dirname && path.basename(resolved).startsWith('.controls-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
