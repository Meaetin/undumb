const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { CodexBridge } = require('./codex-bridge.cjs')
const { getActiveProject } = require('./project-workspace.cjs')
const { listProjectChanges } = require('./file-review.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function waitFor(bridge, check, timeoutMs = 60000) {
  if (check(bridge.getState())) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge.off('state', onState); reject(new Error('Timed out waiting for live Codex activity')) }, timeoutMs)
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
  const temp = path.join(base, `.pause-smoke-${randomUUID()}`)
  let bridge
  try {
    const active = path.join(temp, 'projects', 'active')
    fs.mkdirSync(active, { recursive: true })
    const starter = path.join(__dirname, 'project-starter')
    fs.cpSync(starter, path.join(active, 'site'), { recursive: true })
    fs.cpSync(starter, path.join(active, 'baseline'), { recursive: true })
    fs.writeFileSync(path.join(active, 'metadata.json'), JSON.stringify({ id: randomUUID(),
      idea: 'Disposable pause verification', createdAt: new Date().toISOString(),
      starter: 'vite-react-typescript' }))
    const project = getActiveProject({ userDataPath: temp })
    bridge = new CodexBridge({ userDataPath: temp, getProject: () => getActiveProject({ userDataPath: temp }) })
    bridge.approvePlan('Run a harmless command inside this disposable frontend project. Do not edit files.')
    const task = bridge.createTask({ title: 'Interrupt a harmless command',
      instructions: 'Run exactly this harmless command in the project: node -e "setTimeout(()=>console.log(\'sleep finished\'),30000)". Do not edit files. After the command ends, report what happened.',
      acceptanceCriteria: 'Only a command runs; no project files change.' })
    await bridge.dispatchTask(task.id)
    await waitFor(bridge, state => state.activity.some(item => item.role === 'intern' && item.kind === 'command'))
    const before = bridge.getState().workRecords.tasks.find(item => item.id === task.id)
    assert.equal(before.status, 'working')
    const paused = await bridge.pauseTask(task.id)
    assert.equal(paused.status, 'paused')
    assert.equal(bridge.getState().workRecords.tasks.find(item => item.id === task.id).status, 'paused')
    assert.deepEqual(listProjectChanges(project).files, [])
    console.log(JSON.stringify({ confirmedPause: true, taskStatus: paused.status, filesChanged: 0,
      activity: bridge.getState().activity.slice(-6) }, null, 2))
  } catch (error) {
    console.error('Codex stderr:', bridge?.lastStderr || '(none)')
    throw error
  } finally {
    const child = bridge?.child
    bridge?.stop()
    if (child && child.exitCode === null) {
      await Promise.race([
        new Promise(resolve => child.once('close', resolve)),
        sleep(3000),
      ])
    }
    const resolved = path.resolve(temp)
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('.pause-smoke-')) {
      throw new Error('Unsafe smoke cleanup path')
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break }
      catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 4) throw error
        await sleep(300)
      }
    }
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
