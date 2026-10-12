// Minimal Electron-main-compatible Codex process harness. No renderer or preload access.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(base, 'fixture')
const runtime = path.join(base, '.runtime')
const stateFile = path.join(runtime, 'state.json')
const schemaFile = path.join(base, 'response.schema.json')
const action = process.argv[2]
const answer = process.argv.slice(3).join(' ').trim()

const prompts = {
  'lead:start': `You are the tech lead for a frontend-only website project. Read the starter files but do not edit them. The proposed task is: build a task list where users can add tasks and mark them complete. Identify the consequential missing requirement about whether tasks survive a page reload. Ask the boss to decide; do not choose for them. Return the required JSON response with status blocked, a concise summary, a specific question, and empty changedFiles/checks.`,
  'lead:resume': `Continue as the read-only tech lead. The boss answered the outstanding question: ${answer}. Summarize the consequence of that choice, then a bounded intern task and acceptance criteria. Do not edit any files. Return the required JSON response with status completed, empty question, and empty changedFiles/checks.`,
  'intern:start': `You are an intern working only in this disposable Vite + React + TypeScript website project. The approved task says: build a task list where a visitor can add a task and mark it complete. Acceptance criteria: input and add action work; list renders; completion toggle works. The task does not specify whether tasks should survive a page reload. That choice changes implementation and expected behavior. Do not decide it yourself. Do not edit any files yet. Stop and ask the boss whether tasks should be in memory only or persist locally. Return the required JSON response with status blocked, a specific question, and empty changedFiles/checks.`,
  'intern:resume': `The boss answered the outstanding question: ${answer}. Implement the approved task in this disposable website project, following that answer. Keep changes inside this project. Run the available build check if dependencies are installed; otherwise say exactly why it could not run. Return the required JSON response with status completed, empty question, changedFiles, and checks.`,
}

if (!Object.hasOwn(prompts, action) || (resumeAnswerRequired(action) && !answer)) {
  console.error('Usage: node harness.mjs lead:start|lead:resume|intern:start|intern:resume [answer]')
  process.exit(2)
}

function resumeAnswerRequired(value) { return value === 'lead:resume' || value === 'intern:resume' }

await mkdir(runtime, { recursive: true })
const state = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : { roles: {}, runs: [] }
const role = action.split(':')[0]
const resume = action.endsWith(':resume')
if (resume && !state.roles[role]?.sessionId) throw new Error(`No ${role} session to resume`)
if (action === 'intern:resume' && state.roles.intern?.status !== 'blocked') throw new Error('Intern has no recorded blocker')

async function snapshot(dir, prefix = '') {
  const result = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
    const name = path.join(prefix, entry.name)
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(result, await snapshot(absolute, name))
    else if (entry.isFile()) result[name.replaceAll('\\', '/')] = createHash('sha256').update(await readFile(absolute)).digest('hex')
  }
  return result
}

const before = await snapshot(fixture)
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const runName = `${stamp}-${action.replace(':', '-')}`
const eventsFile = path.join(runtime, `${runName}.jsonl`)
const messageFile = path.join(runtime, `${runName}.message.json`)
const stderrFile = path.join(runtime, `${runName}.stderr.txt`)
const common = ['--json', '--skip-git-repo-check', '--output-schema', schemaFile, '--output-last-message', messageFile, '-c', 'approval_policy="never"']
const args = resume
  ? ['exec', 'resume', ...common, '-c', `sandbox_mode="${role === 'lead' ? 'read-only' : 'workspace-write'}"`, state.roles[role].sessionId, '-']
  : ['exec', ...common, '--cd', fixture, '--sandbox', role === 'lead' ? 'read-only' : 'workspace-write', '-']

// spawn() with windowsHide is the same process boundary Electron main would use.
const child = spawn('codex', args, { cwd: fixture, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.end(prompts[action])
let stdout = ''
let stderr = ''
let sessionId = state.roles[role]?.sessionId
let completed = false
const events = []
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  stdout += chunk
  while (stdout.includes('\n')) {
    const index = stdout.indexOf('\n')
    const line = stdout.slice(0, index).trim()
    stdout = stdout.slice(index + 1)
    if (!line) continue
    try {
      const event = JSON.parse(line)
      events.push(event)
      if (event.type === 'thread.started') sessionId = event.thread_id
      if (event.type === 'turn.completed') completed = true
      const useful = ['thread.started', 'turn.started', 'item.started', 'item.completed', 'turn.completed', 'turn.failed']
      if (useful.includes(event.type)) console.log(JSON.stringify({ type: event.type, itemType: event.item?.type, threadId: event.thread_id }))
    } catch { console.error(`Non-JSON stdout: ${line}`) }
  }
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', chunk => { stderr += chunk })
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject)
  child.on('close', resolve)
})
await writeFile(eventsFile, events.map(event => JSON.stringify(event)).join('\n') + '\n')
await writeFile(stderrFile, stderr)

let result
if (existsSync(messageFile)) {
  try { result = JSON.parse(await readFile(messageFile, 'utf8')) }
  catch { /* reported below */ }
}
const after = await snapshot(fixture)
const changedFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name])
const record = { action, at: new Date().toISOString(), exitCode, completed, sessionId, status: result?.status ?? 'failed', changedFiles, eventsFile: path.relative(base, eventsFile), messageFile: path.relative(base, messageFile) }
state.runs.push(record)
if (sessionId) state.roles[role] = { sessionId, status: record.status }
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n')
console.log(JSON.stringify({ record, response: result, stderr: stderr.trim() }, null, 2))

if (exitCode !== 0 || !completed || !result) process.exitCode = 1
if ((role === 'lead' || result?.status === 'blocked') && changedFiles.length) {
  console.error('Invariant failed: planning or blocked turn changed website files')
  process.exitCode = 1
}
if (action === 'intern:start' && result?.status !== 'blocked') process.exitCode = 1
if (action === 'intern:resume' && result?.status !== 'completed') process.exitCode = 1
