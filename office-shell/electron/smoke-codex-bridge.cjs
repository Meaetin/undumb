const { CodexBridge } = require('./codex-bridge.cjs')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function waitFor(bridge, check, timeoutMs = 120000) {
  if (check(bridge.getState())) return
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.off('state', onState); reject(new Error('Timed out waiting for bridge state')) }, timeoutMs)
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-office-bridge-'))
  const projectRoot = path.join(temp, 'site')
  fs.mkdirSync(projectRoot)
  const project = { projectRoot, metadata: { id: 'smoke', idea: 'A simple frontend website', createdAt: new Date().toISOString(), starter: 'vite-react-typescript' } }
  let bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
  try {
    const unavailable = new CodexBridge({ userDataPath: temp, getProject: () => project, command: 'codex-command-that-does-not-exist' })
    try { await unavailable.start(); throw new Error('Missing Codex executable unexpectedly connected') }
    catch (error) { if (!/ENOENT|not found|spawn/i.test(error.message)) throw error }
    unavailable.stop()
    await bridge.start()
    const networkProbe = await bridge.rpc('command/exec', {
      command: ['curl.exe', '-I', '--max-time', '8', '-sS', '-o', 'NUL', '-w', 'HTTP_STATUS=%{http_code}', 'http://developers.openai.com/'],
      cwd: projectRoot, sandboxPolicy: { type: 'readOnly', networkAccess: true }, timeoutMs: 12000,
    }, 20000)
    const { turnId } = await bridge.sendMessage('lead', 'Smoke test only. Say one sentence about the role of a tech lead. Do not use tools or edit files.')
    await waitFor(bridge, state => state.roles.lead.status === 'idle' && state.roles.lead.messages.some(message => message.role === 'agent'))
    const state = bridge.getState()
    if (!turnId || !state.roles.lead.threadId || state.roles.lead.messages.some(message => message.role === 'agent' && !message.text.trim())) {
      throw new Error('Lead turn did not produce a valid thread and reply')
    }
    const firstThreadId = state.roles.lead.threadId
    bridge.stop()
    await waitFor(bridge, snapshot => snapshot.connection === 'stopped', 10000)
    bridge = new CodexBridge({ userDataPath: temp, getProject: () => project })
    await bridge.start()
    await bridge.sendMessage('lead', 'Second smoke turn. Reply with exactly: ready')
    await waitFor(bridge, snapshot => snapshot.roles.lead.status === 'idle' && snapshot.roles.lead.messages.filter(message => message.role === 'agent').length >= 2)
    const resumed = bridge.getState()
    if (resumed.roles.lead.threadId !== firstThreadId) throw new Error('Lead thread was not resumed after host restart')
    console.log(JSON.stringify({ connection: resumed.connection, leadThreadId: firstThreadId, firstTurnId: turnId,
      replies: resumed.roles.lead.messages.filter(message => message.role === 'agent').map(message => message.text),
      requests: resumed.requests.length, missingCommandRejected: true, resumedThread: true,
      readOnlyNetworkProbe: { exitCode: networkProbe.exitCode, stdout: networkProbe.stdout, stderr: networkProbe.stderr },
    }, null, 2))
  } finally {
    bridge.stop()
    await waitFor(bridge, state => state.connection === 'stopped', 10000)
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('boss-office-bridge-')) {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
