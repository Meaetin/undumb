const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { CodexBridge } = require('./codex-bridge.cjs')
const { createProject, getActiveProject } = require('./project-workspace.cjs')

function inventory(root, prefix = '') {
  const result = {}
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) Object.assign(result, inventory(absolute, relative))
    else if (entry.isFile()) result[relative.replaceAll('\\', '/')] = createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')
  }
  return result
}

function waitFor(bridge, check, timeoutMs = 120000) {
  if (check(bridge.getState())) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.off('state', onState); reject(new Error('Timed out waiting for intern turn')) }, timeoutMs)
    const onState = state => {
      if (!check(state)) return
      clearTimeout(timer)
      bridge.off('state', onState)
      resolve()
    }
    bridge.on('state', onState)
  })
}

async function main() {
  const base = path.resolve(__dirname, '..')
  const temp = path.join(base, `.intern-smoke-${randomUUID()}`)
  const project = createProject({ userDataPath: temp, idea: 'A disposable frontend website to verify supervised delegation.' })
  const bridge = new CodexBridge({ userDataPath: temp, getProject: () => getActiveProject({ userDataPath: temp }) })
  try {
    const before = inventory(project.projectRoot)
    bridge.approvePlan('For this disposable verification, change only the starter heading in src/App.tsx to "Delegation works." Keep the Vite, React, and TypeScript starter. No other product or architecture decision is needed.')
    const task = bridge.createTask({ title: 'Change starter heading',
      instructions: 'Implement the approved one-line heading change. Edit only src/App.tsx. Do not install dependencies or access anything outside this disposable project. Then report the file changed. If you encounter a real blocker, ask the boss and stop.',
      acceptanceCriteria: 'The visible heading reads Delegation works. and only src/App.tsx changes.' })
    await bridge.dispatchTask(task.id)
    await waitFor(bridge, state => ['idle', 'blocked', 'error'].includes(state.roles.intern.status) && !state.roles.intern.turnId)
    const state = bridge.getState()
    const after = inventory(project.projectRoot)
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file])
    const appSource = fs.readFileSync(path.join(project.projectRoot, 'src', 'App.tsx'), 'utf8')
    const finalReply = state.roles.intern.messages.filter(message => message.role === 'agent').at(-1)?.text || ''
    console.log(JSON.stringify({ status: state.roles.intern.status, threadId: state.roles.intern.threadId,
      changed, expectedHeadingPresent: appSource.includes('Delegation works.'), requests: state.requests,
      finalReply }, null, 2))
    assert.equal(state.roles.intern.status, 'idle', 'Intern did not complete the bounded task')
    assert.equal(state.workRecords.tasks.find(item => item.id === task.id)?.status, 'review')
    assert.deepEqual(changed, ['src/App.tsx'], 'Unexpected project files changed')
    assert.ok(appSource.includes('<h1>Delegation works.</h1>'), 'Expected visible heading change missing')
  } finally {
    bridge.stop()
    await waitFor(bridge, state => state.connection === 'stopped', 10000).catch(() => {})
    const resolved = path.resolve(temp)
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('.intern-smoke-')) throw new Error('Unsafe smoke cleanup path')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
