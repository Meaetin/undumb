const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { OfficeStore } = require('./store.cjs')
const { gitStatus, initializeGit, createTaskRun, taskCommitReady } = require('./git.cjs')
const { CodexSessions } = require('./codex.cjs')

async function fixture(work) {
  const testParent = path.join(__dirname, '.test-workspaces')
  fs.mkdirSync(testParent, { recursive: true })
  const tempRoot = fs.mkdtempSync(path.join(testParent, 'workspace-'))
  try { return await work(new OfficeStore({ userDataPath: tempRoot }), tempRoot) }
  finally {
    const safeRoot = path.resolve(tempRoot)
    if (!safeRoot.startsWith(path.resolve(testParent) + path.sep)) throw new Error('Refusing to remove files outside test directory.')
    fs.rmSync(safeRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
    if (fs.existsSync(testParent) && fs.readdirSync(testParent).length === 0) fs.rmdirSync(testParent)
  }
}

test('task Markdown and full session history survive restart outside code folder', () => fixture((store, root) => {
  const project = store.createProject('Customer Portal')
  const intern = store.hireIntern(project.id, 'Intern 1')
  const task = store.createTask(project.id, '# Build onboarding\n\nCreate a welcome screen.')
  const first = store.getAgent(project.id, intern.id).agent.sessions[0]
  for (let i = 0; i < 125; i++) store.addMessage(first, 'user', `Message ${i}`)
  const second = store.createSession(project.id, intern.id)
  assert.equal(second.messages.length, 0)
  assert.equal(first.messages.length, 125)
  assert.ok(fs.existsSync(path.join(project.plansPath, `${task.id}.md`)))
  assert.ok(!project.plansPath.startsWith(project.root + path.sep))
  assert.equal(store.snapshot().projects[0].tasks[0].markdown, '# Build onboarding\n\nCreate a welcome screen.\n')
  const loaded = new OfficeStore({ userDataPath: root })
  assert.equal(loaded.getAgent(project.id, intern.id).agent.sessions[1].messages.length, 125)
  assert.equal(loaded.snapshot().projects[0].tasks[0].title, 'Build onboarding')
}))

test('Git tasks use separate branches and worktrees; dependent task starts from committed work', () => fixture(store => {
  const project = store.createProject('Git project')
  const firstIntern = store.hireIntern(project.id, 'Intern 1')
  const secondIntern = store.hireIntern(project.id, 'Intern 2')
  const firstTask = store.createTask(project.id, '# First task\n\nWrite the first feature.')
  const secondTask = store.createTask(project.id, '# Second task\n\nBuild on the first feature.')
  assert.equal(gitStatus(project.root).initialized, false)
  assert.equal(initializeGit(project.root).hasCommit, true)
  const firstRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, firstTask.id).task, firstIntern.id)
  store.assignTask(project.id, firstTask.id, firstIntern.id, firstRun)
  assert.notEqual(firstRun.workspacePath, project.root)
  assert.equal(taskCommitReady(firstRun), false)
  fs.writeFileSync(path.join(firstRun.workspacePath, 'feature.txt'), 'first feature')
  execFileSync('git', ['-C', firstRun.workspacePath, 'add', 'feature.txt'])
  execFileSync('git', ['-C', firstRun.workspacePath, '-c', 'user.name=Test', '-c', 'user.email=test@local.invalid', 'commit', '-m', 'Add feature'])
  assert.equal(taskCommitReady(firstRun), true)
  store.completeTask(project.id, firstTask.id)
  const secondRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, secondTask.id).task, secondIntern.id, firstTask.id)
  assert.notEqual(secondRun.workspacePath, firstRun.workspacePath)
  assert.ok(fs.existsSync(path.join(secondRun.workspacePath, 'feature.txt')))
  assert.equal(fs.existsSync(path.join(project.root, 'feature.txt')), false)
}))

test('clear context keeps files, while reassignment starts fresh files and chat', () => fixture(store => {
  const project = store.createProject('Reassignment')
  const firstIntern = store.hireIntern(project.id, 'Intern 1')
  const secondIntern = store.hireIntern(project.id, 'Intern 2')
  const task = store.createTask(project.id, '# Make a page\n\nCreate the page.')
  initializeGit(project.root)
  const firstRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, task.id).task, firstIntern.id)
  store.assignTask(project.id, task.id, firstIntern.id, firstRun)
  const firstChat = store.getAgent(project.id, firstIntern.id).agent.sessions[0]
  firstChat.taskId = task.id
  firstChat.workspacePath = firstRun.workspacePath
  store.addMessage(firstChat, 'user', 'Start the page')
  fs.writeFileSync(path.join(firstRun.workspacePath, 'partial.txt'), 'unfinished')
  const freshContext = store.createSession(project.id, firstIntern.id, { carryTask: true })
  assert.equal(freshContext.workspacePath, firstRun.workspacePath)
  assert.equal(freshContext.taskId, task.id)
  assert.equal(firstChat.messages.length, 1)
  store.unassignTask(project.id, task.id)
  assert.equal(firstChat.locked, true)
  const secondRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, task.id).task, secondIntern.id)
  store.assignTask(project.id, task.id, secondIntern.id, secondRun)
  assert.notEqual(secondRun.workspacePath, firstRun.workspacePath)
  assert.equal(fs.existsSync(path.join(secondRun.workspacePath, 'partial.txt')), false)
  assert.equal(store.getAgent(project.id, secondIntern.id).agent.sessions[0].messages.length, 0)
}))

test('without Git, interns share the project folder as chosen', () => fixture(store => {
  const project = store.createProject('Shared folder')
  const first = store.hireIntern(project.id, 'Intern 1')
  const second = store.hireIntern(project.id, 'Intern 2')
  const a = store.createTask(project.id, '# Task A\n\nDo A.')
  const b = store.createTask(project.id, '# Task B\n\nDo B.')
  const firstRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, a.id).task, first.id)
  const secondRun = createTaskRun(store, store.getProject(project.id), store.task(project.id, b.id).task, second.id)
  assert.equal(firstRun.workspacePath, project.root)
  assert.equal(secondRun.workspacePath, project.root)
}))

test('an updated task steers the active intern and idle chats close without losing their thread', () => fixture(async store => {
  const project = store.createProject('Updates')
  const intern = store.hireIntern(project.id, 'Intern 1')
  const task = store.createTask(project.id, '# First plan\n\nDo the original work.')
  const run = createTaskRun(store, store.getProject(project.id), store.task(project.id, task.id).task, intern.id)
  store.assignTask(project.id, task.id, intern.id, run)
  const chat = store.getAgent(project.id, intern.id).agent.sessions[0]
  chat.taskId = task.id
  chat.threadId = 'saved-thread'
  chat.turnId = 'active-turn'
  chat.status = 'working'
  const codex = new CodexSessions(store)
  const calls = []
  codex.rpc = async (method, params) => { calls.push({ method, params }); return {} }
  try {
    const updated = store.updateTask(project.id, task.id, '# Revised plan\n\nFollow the revised instructions.')
    codex.notifyTaskUpdated(store.getProject(project.id), updated)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls[0].method, 'turn/steer')
    assert.equal(calls[0].params.expectedTurnId, 'active-turn')
    assert.match(chat.messages.at(-1).text, /Revised plan/)
    chat.turnId = null
    chat.status = 'available'
    chat.updatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString()
    codex.closeIdleSessions()
    assert.equal(chat.status, 'closed')
    assert.equal(chat.threadId, 'saved-thread')
  } finally { clearInterval(codex.idleTimer) }
}))

test('work log retains structured Codex progress and command results', () => fixture(store => {
  const project = store.createProject('Activity')
  const intern = store.hireIntern(project.id, 'Intern 1')
  const chat = store.getAgent(project.id, intern.id).agent.sessions[0]
  chat.threadId = 'thread-1'
  const codex = new CodexSessions(store)
  const send = (method, extra) => codex.onNotification(method, { threadId: chat.threadId, turnId: 'turn-1', ...extra })
  try {
    send('turn/plan/updated', { plan: [{ step: 'Inspect files', status: 'inProgress' }] })
    send('item/reasoning/summaryTextDelta', { itemId: 'reason-1', summaryIndex: 0, delta: 'Checking the project structure.' })
    send('item/started', { item: { id: 'command-1', type: 'commandExecution', command: 'npm test', cwd: project.root, status: 'inProgress' } })
    send('item/commandExecution/outputDelta', { itemId: 'command-1', delta: 'Tests passed\n' })
    send('item/completed', { item: { id: 'command-1', type: 'commandExecution', command: 'npm test', cwd: project.root, status: 'completed', exitCode: 0, durationMs: 2400 } })
    send('item/completed', { item: { id: 'file-1', type: 'fileChange', status: 'completed', changes: [{ kind: 'update', path: 'src/App.tsx', diff: '+ new line' }] } })
    assert.match(chat.activity.find(item => item.kind === 'plan').summary, /Inspect files/)
    assert.match(chat.activity.find(item => item.kind === 'reasoning').summary, /project structure/)
    assert.match(chat.activity.find(item => item.kind === 'command').summary, /exit 0.*2\.4s/)
    assert.equal(chat.activity.filter(item => item.kind === 'command').length, 1)
    assert.match(chat.activity.find(item => item.kind === 'file').summary, /src\/App.tsx[\s\S]*new line/)
    assert.equal(chat.activity.find(item => item.kind === 'output').summary, 'Tests passed\n')
  } finally { clearInterval(codex.idleTimer) }
}))
