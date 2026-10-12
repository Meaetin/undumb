// Narrow stdio JSON-RPC probe for a locally signed-in Codex app-server.
// All approval requests are declined. No app-server response can broaden access.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(base, 'fixture')
const runtime = path.join(base, '.runtime')
const runStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const logFile = path.join(runtime, `${runStamp}-app-server.jsonl`)
const summaryFile = path.join(runtime, `${runStamp}-app-server-summary.json`)
await mkdir(runtime, { recursive: true })

async function snapshot(dir, prefix = '') {
  const result = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
    const rel = path.join(prefix, entry.name)
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(result, await snapshot(absolute, rel))
    else if (entry.isFile()) result[rel.replaceAll('\\', '/')] = createHash('sha256').update(await readFile(absolute)).digest('hex')
  }
  return result
}

const before = await snapshot(fixture)
const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
  cwd: fixture,
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
})
const raw = []
const pending = new Map()
const turnDone = new Map()
const turnWaiters = new Map()
const requests = []
const notificationCounts = {}
const threadIds = {}
let nextId = 1
let stderr = ''
let stdoutBuffer = ''
let exitCode = null

function write(message) { child.stdin.write(JSON.stringify(message) + '\n') }
function rpc(method, params, timeoutMs = 20000) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer, method })
    write({ id, method, params })
  })
}
function waitForTurn(turnId, timeoutMs = 150000) {
  if (turnDone.has(turnId)) return Promise.resolve(turnDone.get(turnId))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { turnWaiters.delete(turnId); reject(new Error(`Turn ${turnId} timed out`)) }, timeoutMs)
    turnWaiters.set(turnId, { resolve, timer })
  })
}
function handleServerRequest(message) {
  const { id, method, params = {} } = message
  const record = { method, threadId: params.threadId, turnId: params.turnId, itemId: params.itemId }
  if (method === 'item/tool/requestUserInput') {
    const answers = {}
    for (const question of params.questions ?? []) {
      const preferred = question.options?.find(option => /memory|reset|no persistence/i.test(option.label))
      const choice = preferred?.label ?? question.options?.[0]?.label ?? 'For this disposable test only, keep tasks in memory.'
      answers[question.id] = { answers: [choice] }
    }
    record.questions = params.questions
    record.simulatedAnswers = answers
    requests.push(record)
    write({ id, result: { answers } })
    console.log(`SERVER REQUEST ${method}: simulated test answer sent`)
  } else if (/approval/i.test(method)) {
    record.command = params.command
    record.decision = 'decline'
    requests.push(record)
    write({ id, result: { decision: 'decline' } })
    console.log(`SERVER REQUEST ${method}: declined`)
  } else {
    record.unhandled = true
    requests.push(record)
    write({ id, error: { code: -32601, message: 'Unsupported request in spike harness' } })
    console.log(`SERVER REQUEST ${method}: unsupported`)
  }
}
function handle(message) {
  raw.push({ at: new Date().toISOString(), message })
  if ('method' in message) {
    notificationCounts[message.method] = (notificationCounts[message.method] ?? 0) + 1
    if ('id' in message) { handleServerRequest(message); return }
    if (message.method.startsWith('turn/')) console.log(`EVENT ${message.method} ${message.params?.turn?.id ?? ''}`)
    if (['turn/completed', 'turn/failed', 'turn/interrupted'].includes(message.method)) {
      const turn = message.params?.turn
      if (turn?.id) {
        turnDone.set(turn.id, { method: message.method, status: turn.status, error: turn.error })
        const waiter = turnWaiters.get(turn.id)
        if (waiter) { clearTimeout(waiter.timer); turnWaiters.delete(turn.id); waiter.resolve(turnDone.get(turn.id)) }
      }
    }
    return
  }
  if ('id' in message) {
    const item = pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(message.id)
    if (message.error) item.reject(new Error(`${item.method}: ${JSON.stringify(message.error)}`))
    else item.resolve(message.result)
  }
}
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => {
  stdoutBuffer += chunk
  while (stdoutBuffer.includes('\n')) {
    const index = stdoutBuffer.indexOf('\n')
    const line = stdoutBuffer.slice(0, index).trim()
    stdoutBuffer = stdoutBuffer.slice(index + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) }
    catch { raw.push({ at: new Date().toISOString(), nonJsonStdout: line }) }
  }
})
child.stderr.setEncoding('utf8')
child.stderr.on('data', chunk => { stderr += chunk })
child.on('close', code => {
  exitCode = code
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`app-server exited ${code}`)) }
  pending.clear()
})

const outcomes = {}
let error = null
try {
  const initialized = await rpc('initialize', {
    clientInfo: { name: 'boss_office_spike', title: 'Boss Office Spike', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  })
  outcomes.initialize = { ok: Boolean(initialized), serverVersion: initialized?.serverVersion }
  write({ method: 'initialized', params: {} })

  const lead = await rpc('thread/start', {
    cwd: fixture,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    baseInstructions: 'You are a read-only tech lead. Do not edit files or make product decisions for the user.',
  })
  const intern = await rpc('thread/start', {
    cwd: fixture,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    baseInstructions: 'You are an intern in a disposable frontend project. Ask about missing requirements before editing.',
  })
  threadIds.lead = lead.thread?.id
  threadIds.intern = intern.thread?.id
  outcomes.threads = {
    lead: { id: threadIds.lead, cwd: lead.cwd, sandbox: lead.sandbox, approvalPolicy: lead.approvalPolicy },
    intern: { id: threadIds.intern, cwd: intern.cwd, sandbox: intern.sandbox, approvalPolicy: intern.approvalPolicy },
  }
  if (!threadIds.lead || !threadIds.intern || threadIds.lead === threadIds.intern) throw new Error('Distinct role thread IDs were not returned')

  const leadTurn = await rpc('turn/start', {
    threadId: threadIds.lead,
    input: [{ type: 'text', text: 'Read the disposable site and say briefly what it currently does. Do not edit files.' }],
  })
  outcomes.leadTurn = await waitForTurn(leadTurn.turn.id)

  const internTurn = await rpc('turn/start', {
    threadId: threadIds.intern,
    input: [{ type: 'text', text: 'Do not edit files. The next task is to add a task list, but whether tasks survive reload is unspecified. If request_user_input is available, call it now with a question asking the boss to choose in-memory or local persistence, then use the answer to summarize the intended behavior. This is only a protocol test.' }],
  })
  outcomes.internTurn = await waitForTurn(internTurn.turn.id)

  // A separate read-only probe can trigger an approval without writing outside the fixture.
  if (!requests.some(request => request.method === 'item/tool/requestUserInput')) {
    const probe = await rpc('thread/start', {
      cwd: fixture,
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
      baseInstructions: 'This is a sandbox approval protocol probe. Only use this disposable fixture; never access outside it.',
    })
    threadIds.approvalProbe = probe.thread?.id
    const probeTurn = await rpc('turn/start', {
      threadId: threadIds.approvalProbe,
      input: [{ type: 'text', text: 'To test the approval protocol, try to create a tiny app-server-approval-probe.txt file in this current disposable fixture using a shell command. Request approval if the read-only sandbox requires it. Do not access any path outside this fixture. If declined, stop without retrying.' }],
    })
    outcomes.probeTurn = await waitForTurn(probeTurn.turn.id)
  }
} catch (cause) {
  error = String(cause?.stack ?? cause)
} finally {
  child.stdin.end()
  if (exitCode === null) child.kill()
  await new Promise(resolve => { if (exitCode !== null) resolve(); else child.once('close', resolve) })
  const after = await snapshot(fixture)
  const changedFiles = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name])
  const summary = { at: new Date().toISOString(), cliVersion: '0.162.0-alpha.2', outcomes, threadIds, requests, notificationCounts, changedFiles, exitCode, error, stderr: stderr.trim(), logFile: path.relative(base, logFile) }
  await writeFile(logFile, raw.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  await writeFile(summaryFile, JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify({ summaryFile: path.relative(base, summaryFile), outcomes, requests, changedFiles, error }, null, 2))
  if (error || changedFiles.length || outcomes.leadTurn?.status !== 'completed' || outcomes.internTurn?.status !== 'completed') process.exitCode = 1
}
