const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { CodexBridge, resolveCodexCommand } = require('./codex-bridge.cjs')
let turnNumber = 0

function fakeCodex(bridge, { fastTurn = false } = {}) {
  const sent = []
  bridge.child = { stdin: { writable: true, write: line => sent.push(JSON.parse(line)), end() {} }, kill() {} }
  bridge.start = async () => {}
  bridge.rpc = async method => {
    if (method === 'thread/start') return { thread: { id: 'intern-thread' } }
    if (method === 'thread/resume') return { thread: { id: 'intern-thread' } }
    if (method === 'turn/interrupt') return {}
    if (method === 'turn/start') {
      const id = `turn-${++turnNumber}`
      if (fastTurn) finish(bridge, id, 'Done.')
      return { turn: { id } }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  }
  return sent
}

function finish(bridge, turnId, message) {
  bridge.onNotification('item/completed', { threadId: 'intern-thread', turnId,
    item: { type: 'agentMessage', id: `agent-${turnId}`, text: message } })
  bridge.onNotification('turn/completed', { threadId: 'intern-thread', turn: { id: turnId, status: 'completed' } })
}

async function main() {
  const temp = fs.mkdtempSync(path.join(__dirname, '.bridge-unit-'))
  const projectRoot = path.join(temp, 'site')
  fs.mkdirSync(projectRoot)
  const project = { projectRoot, metadata: { id: randomUUID(), idea: 'test', createdAt: '', starter: 'vite-react-typescript' } }
  if (process.platform === 'win32') {
    const fakeProfile = path.join(temp, 'profile')
    const fakeExe = path.join(fakeProfile, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'test-version', 'codex.exe')
    fs.mkdirSync(path.dirname(fakeExe), { recursive: true })
    fs.writeFileSync(fakeExe, '')
    assert.equal(resolveCodexCommand('codex', { PATH: '', LOCALAPPDATA: path.join(temp, 'local'), USERPROFILE: fakeProfile }, 'win32'), fakeExe)
  }
  const noProject = new CodexBridge({ userDataPath: temp, getProject: () => null })
  noProject.stop()
  fs.writeFileSync(path.join(temp, 'office-agent-state.json'), JSON.stringify({ version: 1,
    projectId: project.metadata.id, planApproved: true, approvedPlan: 'Legacy approved plan', activity: [],
    roles: { lead: { threadId: 'old-lead', messages: [{ id: 'legacy-message', role: 'agent', text: 'Prior advice', at: '2026-10-08T00:00:00.000Z' }] },
      intern: { messages: [] } },
  }))
  let bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
  try {
    assert.equal(bridge.getState().workRecords.plan.versions[0].text, 'Legacy approved plan')
    assert.equal(bridge.getState().workRecords.plan.approvedVersion, 1)
    assert.equal(bridge.getState().roles.lead.messages[0].text, 'Prior advice')
    assert.throws(() => noProject.createTask({ title: 'A', instructions: 'B', acceptanceCriteria: 'C' }), /project/i)
    await assert.rejects(() => bridge.sendMessage('intern', 'Build a page'), /dispatch an approved task/)
    bridge.approvePlan('Build a frontend-only page with one heading')
    const fastTask = bridge.createTask({ title: 'Fast task', instructions: 'Build a page', acceptanceCriteria: 'One heading' })
    fakeCodex(bridge, { fastTurn: true })
    await bridge.dispatchTask(fastTask.id)
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === fastTask.id).status, 'review')
    assert.equal(bridge.getState().roles.intern.turnId, undefined)

    const blockedTask = bridge.createTask({ title: 'Ambiguous task', instructions: 'Check the page', acceptanceCriteria: 'Report findings' })
    fakeCodex(bridge)
    await bridge.dispatchTask(blockedTask.id)
    const firstTurn = bridge.getState().roles.intern.turnId
    const pausePromise = bridge.pauseTask(blockedTask.id)
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === blockedTask.id).status, 'working', 'Pause must wait for confirmation')
    bridge.onNotification('turn/completed', { threadId: 'intern-thread', turn: { id: firstTurn, status: 'interrupted' } })
    await pausePromise
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === blockedTask.id).status, 'paused')
    bridge.resumeTask(blockedTask.id)
    await bridge.dispatchTask(blockedTask.id)
    assert.throws(() => bridge.savePlan('Different plan'), /Wait for the intern turn/)
    assert.throws(() => bridge.revokePlanApproval(), /Wait for the intern turn/)
    finish(bridge, bridge.getState().roles.intern.turnId, 'Which heading should I use?\n[BOSS_OFFICE_BLOCKED]')
    let state = bridge.getState()
    assert.equal(state.workRecords.tasks.find(task => task.id === blockedTask.id).status, 'blocked')
    const ordinaryBlocker = state.workRecords.escalations.find(item => item.taskId === blockedTask.id)
    assert.equal(ordinaryBlocker.status, 'open')
    assert.equal(ordinaryBlocker.sourceRequestId, undefined)
    const secondTask = bridge.createTask({ title: 'Other task', instructions: 'Inspect the page', acceptanceCriteria: 'A note' })
    const beforeRejectedDispatch = bridge.getState().roles.intern.messages.length
    await assert.rejects(() => bridge.dispatchTask(secondTask.id), /Another intern task is active/)
    assert.equal(bridge.getState().roles.intern.messages.length, beforeRejectedDispatch)
    assert.equal(bridge.getState().roles.intern.status, 'blocked')
    bridge.stop()

    bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
    state = bridge.getState()
    assert.equal(state.workRecords.plan.versions.length, 2, 'Legacy plan is imported only once')
    assert.equal(state.roles.lead.messages[0].text, 'Prior advice')
    assert.equal(state.workRecords.tasks.find(task => task.id === blockedTask.id).status, 'blocked')
    assert.equal(state.workRecords.escalations.find(item => item.id === ordinaryBlocker.id).question, ordinaryBlocker.question)
    bridge.answerEscalation(ordinaryBlocker.id, 'Use the project title.')
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === blockedTask.id).status, 'ready')
    fakeCodex(bridge)
    await bridge.dispatchTask(blockedTask.id)
    finish(bridge, bridge.getState().roles.intern.turnId, 'Changed the heading. Check: reviewed src/App.tsx.')
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === blockedTask.id).status, 'review')
    bridge.stop()

    bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
    state = bridge.getState()
    assert.equal(state.workRecords.tasks.find(task => task.id === blockedTask.id).status, 'review')
    assert.ok(state.workRecords.workReports.some(report => report.taskId === blockedTask.id))
    const liveTask = bridge.createTask({ title: 'Live request task', instructions: 'Try a command', acceptanceCriteria: 'Report result' })
    const sent = fakeCodex(bridge)
    await bridge.dispatchTask(liveTask.id)
    bridge.onServerRequest({ id: 39, method: 'item/permissions/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId, itemId: 'permission-opaque',
      cwd: projectRoot, permissions: {},
    } })
    assert.deepEqual(sent.at(-1), { id: 39, result: { permissions: {}, scope: 'turn' } })
    bridge.onServerRequest({ id: 40, method: 'item/permissions/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId, itemId: 'permission-1',
      cwd: projectRoot, reason: 'Need to write in named path',
      permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: projectRoot } }] } },
    } })
    const permissionRequest = bridge.getState().requests[0]
    assert.equal(permissionRequest.context.permissions.fileSystem.entries[0].path.path, projectRoot)
    assert.equal(sent.length, 1, 'Permission grant must wait for boss')
    bridge.resolveRequest(permissionRequest.id, { decision: 'accept' })
    assert.deepEqual(sent.at(-1), { id: 40, result: {
      permissions: { fileSystem: { entries: [{ access: 'write', path: { type: 'path', path: projectRoot } }] } }, scope: 'turn',
    } })
    bridge.onServerRequest({ id: 44, method: 'item/permissions/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId, itemId: 'permission-network',
      cwd: projectRoot, reason: 'Reach an external service', permissions: { network: { enabled: true } },
    } })
    const networkRequest = bridge.getState().requests[0]
    assert.deepEqual(networkRequest.context.permissions, { network: { enabled: true } })
    assert.match(networkRequest.details, /Requested permissions.*network/)
    assert.equal(sent.length, 2, 'Network grant must wait for boss')
    bridge.resolveRequest(networkRequest.id, { decision: 'decline' })
    assert.deepEqual(sent.at(-1), { id: 44, result: { permissions: {}, scope: 'turn' } })
    bridge.onServerRequest({ id: 45, method: 'item/fileChange/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId, itemId: 'file-1',
      reason: 'Change outside workspace', grantRoot: projectRoot,
    } })
    const fileRequest = bridge.getState().requests[0]
    assert.equal(fileRequest.context.grantRoot, projectRoot)
    assert.match(fileRequest.details, /Grant root:/)
    assert.equal(sent.length, 3, 'File change approval must wait for boss')
    bridge.resolveRequest(fileRequest.id, { decision: 'decline' })
    assert.deepEqual(sent.at(-1), { id: 45, result: { decision: 'decline' } })
    bridge.onServerRequest({ id: 41, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId, itemId: 'cmd-1', command: 'write outside project', cwd: projectRoot, reason: 'sandbox denied',
    } })
    const request = bridge.getState().requests[0]
    assert.equal(request.taskId, liveTask.id)
    assert.equal(sent.length, 4, 'Command approval must wait for the boss')
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === liveTask.id).status, 'blocked')
    bridge.onServerRequest({ id: 43, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId,
      itemId: 'cmd-duplicate', command: 'another action', cwd: projectRoot, reason: 'already blocked',
    } })
    assert.deepEqual(sent.at(-1), { id: 43, result: { decision: 'decline' } })
    assert.equal(bridge.getState().requests.length, 1)
    const liveTurn = bridge.getState().roles.intern.turnId
    const pausedRequest = bridge.pauseTask(liveTask.id)
    bridge.onNotification('turn/completed', { threadId: 'intern-thread', turn: { id: liveTurn, status: 'interrupted' } })
    await pausedRequest
    assert.equal(bridge.getState().workRecords.tasks.find(task => task.id === liveTask.id).status, 'paused')
    assert.deepEqual(bridge.getState().requests, [])
    assert.ok(bridge.getState().workRecords.escalations.some(item => item.taskId === liveTask.id && item.status === 'interrupted'))
    bridge.resumeTask(liveTask.id)
    await bridge.dispatchTask(liveTask.id)
    bridge.onServerRequest({ id: 42, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'intern-thread', turnId: bridge.getState().roles.intern.turnId,
      itemId: 'cmd-2', command: 'write outside project', cwd: projectRoot, reason: 'sandbox denied',
    } })
    bridge.stop()

    bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
    state = bridge.getState()
    assert.deepEqual(state.requests, [])
    assert.equal(state.workRecords.tasks.find(task => task.id === liveTask.id).status, 'ready')
    assert.equal(state.workRecords.tasks.find(task => task.id === liveTask.id).interrupted, true)
    assert.ok(state.workRecords.escalations.filter(item => item.taskId === liveTask.id).every(item => item.status !== 'open'))
    assert.equal(state.workRecords.tasks.find(task => task.id === blockedTask.id).status, 'review')
    bridge.stop()
    const recordsFile = path.join(temp, 'office-work-records', `${project.metadata.id}.json`)
    fs.writeFileSync(recordsFile, '{corrupt-json')
    const damaged = new CodexBridge({ userDataPath: temp, getProject: () => project })
    assert.match(damaged.getState().error, /Work records could not be loaded/)
    assert.equal(damaged.getState().roles.lead.messages[0].text, 'Prior advice')
    assert.throws(() => damaged.createTask({ title: 'A', instructions: 'B', acceptanceCriteria: 'C' }), /Work records could not be loaded/)
    damaged.stop()
    assert.equal(fs.readFileSync(recordsFile, 'utf8'), '{corrupt-json', 'Corrupt record remains untouched for recovery')
    console.log('Bridge checks passed: task gate, fast turn, live pause, restart continuity, request interruption, legacy migration, recoverable bad records.')
  } finally {
    noProject.stop()
    bridge.stop()
    const resolved = path.resolve(temp)
    if (path.dirname(resolved) === __dirname && path.basename(resolved).startsWith('.bridge-unit-')) {
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
