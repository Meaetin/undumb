const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { OfficeStore } = require('./store.cjs')
const { CodexSessions } = require('./codex.cjs')
const { initializeGit } = require('./git.cjs')

const appRoot = path.resolve(__dirname, '..')
const smokeRoot = path.join(appRoot, `.codex-smoke-${randomUUID()}`)
let sessions
function waitForReply(projectId, agentId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sessions.off('state', check); reject(new Error('Timed out waiting for an agent reply.')) }, 90000)
    function check(state) {
      const actor = state.projects.find(item => item.id === projectId)?.agents.find(item => item.id === agentId)
      const chat = actor?.sessions.find(item => item.id === actor.activeSessionId)
      if (chat?.status === 'available' && chat.messages.some(item => item.role === 'agent')) {
        clearTimeout(timer); sessions.off('state', check); resolve()
      }
      if (chat?.status === 'interrupted' && chat.activity.some(item => item.kind === 'error')) {
        clearTimeout(timer); sessions.off('state', check); reject(new Error(chat.activity.at(-1)?.summary || 'Turn failed.'))
      }
    }
    sessions.on('state', check)
    check(sessions.snapshot())
  })
}
function waitForTask(projectId, condition, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sessions.off('state', check)
      const project = sessions.snapshot().projects.find(item => item.id === projectId)
      const intern = project?.agents.find(item => item.role === 'intern')
      const chat = intern?.sessions[0]
      reject(new Error(`Timed out waiting for ${label}. Status: ${chat?.status}; task: ${project?.tasks[0]?.status}; requests: ${JSON.stringify(sessions.requests)}; reply: ${chat?.messages.filter(item => item.role === 'agent').at(-1)?.text || '(none)'}; activity: ${chat?.activity.at(-1)?.summary || '(none)'}`))
    }, 120000)
    function check(state) {
      const project = state.projects.find(item => item.id === projectId)
      if (project && condition(project)) { clearTimeout(timer); sessions.off('state', check); resolve() }
    }
    sessions.on('state', check)
    check(sessions.snapshot())
  })
}
async function main() {
  const store = new OfficeStore({ userDataPath: smokeRoot })
  const project = store.createProject('Codex connection smoke')
  const lead = project.agents[0]
  const intern = store.hireIntern(project.id, 'Smoke Intern')
  sessions = new CodexSessions(store)
  await sessions.sendMessage(project.id, lead.id, lead.sessions[0].id, 'Reply with exactly READY and no other text.')
  await waitForReply(project.id, lead.id)
  const answer = store.getAgent(project.id, lead.id).agent.sessions[0].messages.filter(item => item.role === 'agent').at(-1)?.text || ''
  if (!answer.includes('READY')) throw new Error(`Unexpected tech lead reply: ${answer}`)
  await sessions.sendMessage(project.id, lead.id, lead.sessions[0].id,
    'All clarifications are resolved. Create one task now: make greeting.txt containing exactly Hello from intern, verify it, and commit the file. Do not ask more questions.')
  await waitForTask(project.id, item => item.tasks.length === 1, 'lead task Markdown')
  const task = store.getProject(project.id).tasks[0]
  if (!fs.existsSync(store.taskPath(store.getProject(project.id), task.id))) throw new Error('Lead task file is missing.')
  initializeGit(project.root)
  sessions.on('state', state => {
    for (const request of state.requests) {
      if (request.kind !== 'approval' || !request.details.includes('git') || !request.details.includes(smokeRoot)) continue
      setImmediate(() => {
        try { sessions.answerRequest(request.id, { decision: 'accept' }) } catch {}
      })
    }
  })
  await sessions.sendMessage(project.id, intern.id, intern.sessions[0].id, 'Please implement the attached task.', [], task.id)
  await waitForTask(project.id, item => item.tasks[0]?.status === 'done', 'intern commit and task completion')
  const run = store.getProject(project.id).tasks[0].runs[0]
  if (!fs.existsSync(path.join(run.workspacePath, 'greeting.txt'))) throw new Error('Intern did not create the greeting file.')
  const attachment = path.join(smokeRoot, 'attachment.txt')
  fs.writeFileSync(attachment, 'The secret word is LEMON.\n')
  await sessions.sendMessage(project.id, intern.id, intern.sessions[0].id,
    'Read the attached text file and reply with its secret word. Do not change code files.', [], null, null,
    [{ path: attachment, name: 'attachment.txt' }])
  await waitForTask(project.id, item => {
    const chat = item.agents.find(actor => actor.id === intern.id)?.sessions[0]
    return chat?.status === 'available' && chat.messages.filter(message => message.role === 'agent').at(-1)?.text.includes('LEMON')
  }, 'attached-file reply')
  await sessions.compact(project.id, intern.id, intern.sessions[0].id)
  await waitForTask(project.id, item => item.agents.find(actor => actor.id === intern.id)?.sessions[0].status === 'available', 'chat compaction')
  await sessions.sendMessage(project.id, intern.id, intern.sessions[0].id, 'Reply with exactly COMPACT_READY. Do not edit files.')
  await waitForTask(project.id, item => item.agents.find(actor => actor.id === intern.id)?.sessions[0].messages
    .filter(message => message.role === 'agent').at(-1)?.text.includes('COMPACT_READY'), 'post-compaction reply')
  if (store.getAgent(project.id, lead.id).agent.sessions[0].threadId === store.getAgent(project.id, intern.id).agent.sessions[0].threadId) throw new Error('Lead and intern shared a Codex thread.')
  process.stdout.write(`Codex task, attachment, and compaction completed in separate lead and intern chats: ${task.title} / ${run.branch}\n`)
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 }).finally(async () => {
  const child = sessions?.child
  const closed = child && new Promise(resolve => { child.once('close', resolve); setTimeout(resolve, 2000) })
  sessions?.stop()
  if (closed) await closed
  const safeRoot = path.resolve(smokeRoot)
  if (!safeRoot.startsWith(appRoot + path.sep)) throw new Error('Refusing to remove smoke files outside this app folder.')
  if (fs.existsSync(safeRoot)) fs.rmSync(safeRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
})
