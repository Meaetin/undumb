const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { WorkRecords } = require('./work-records.cjs')

function fixture() {
  // The Windows managed sandbox permits file creation in the system temp folder
  // but denies renames there; use the writable workspace for atomic-write checks.
  const userDataPath = fs.mkdtempSync(path.join(__dirname, '.test-work-records-'))
  let id = randomUUID()
  const projectRoot = path.join(userDataPath, 'projects', 'active', 'site')
  fs.mkdirSync(projectRoot, { recursive: true })
  const getProject = () => ({ projectRoot, metadata: { id } })
  return {
    userDataPath, projectRoot, getProject,
    setProjectId(value) { id = value },
    records() { return new WorkRecords({ userDataPath, getProject }) },
    cleanup() {
      if (path.dirname(userDataPath) !== __dirname || !path.basename(userDataPath).startsWith('.test-work-records-')) {
        throw new Error('Unsafe test cleanup path')
      }
      fs.rmSync(userDataPath, { recursive: true, force: true })
    },
  }
}

test('plan approval follows exact version and tasks require criteria', () => {
  const fx = fixture()
  try {
    const records = fx.records()
    assert.equal(records.getState().plan.approvedVersion, null)
    assert.throws(() => records.createTask({ title: 'Header', instructions: 'Build header', acceptanceCriteria: 'Visible' }), /Approve/)
    const first = records.savePlan('A simple page')
    assert.equal(first.version, 1)
    assert.throws(() => records.approvePlan(2), /latest/)
    records.approvePlan(1)
    assert.equal(records.getApprovedPlanText(), 'A simple page')
    assert.throws(() => records.createTask({ title: 'Header', instructions: 'Build header', acceptanceCriteria: '' }), /Acceptance criteria/)
    const task = records.createTask({ title: 'Header', instructions: 'Build header', acceptanceCriteria: 'Heading visible' })
    assert.equal(task.planVersion, 1)
    records.savePlan('A revised page')
    assert.equal(records.getApprovedPlanText(), null)
    assert.throws(() => records.assignTask(task.id), /current approved plan/)
    records.approvePlan(2)
    assert.throws(() => records.assignTask(task.id), /current approved plan/)
    records.revokePlanApproval()
    assert.equal(records.getState().plan.approvedVersion, null)
  } finally { fx.cleanup() }
})

test('decision, ordinary blocker, answer, report, revision, and acceptance survive restart', () => {
  const fx = fixture()
  try {
    let records = fx.records()
    records.savePlan('Build an accessible website')
    records.approvePlan(1)
    const decision = records.addDecision({ choice: 'Use CSS grid', reason: 'Layout is two-dimensional', context: 'Hero layout' })
    const question = records.addQuestion({ question: 'Which color?', context: 'Hero area' })
    records.resolveQuestion(question.id, 'Orange')
    const task = records.createTask({ title: 'Hero', instructions: 'Build hero', acceptanceCriteria: 'Title is visible' })
    records.assignTask(task.id)
    const blocker = records.blockTask(task.id, { question: 'Which headline?', evidence: 'Spec has none' })
    records = fx.records()
    assert.deepEqual(records.interruptWorkingTasks(), [])
    assert.equal(records.getState().tasks[0].status, 'blocked')
    assert.equal(records.getState().escalations[0].id, blocker.id)
    records.answerEscalation(blocker.id, 'Use The Boss’s Office')
    assert.equal(records.getState().tasks[0].status, 'ready')
    records.assignTask(task.id)
    const report = records.completeTaskTurn(task.id, { turnId: 'turn-1', outcome: 'Hero built',
      filesChanged: ['src/App.tsx'], checks: ['npm run build'], unresolved: [] })
    assert.equal(report.taskId, task.id)
    assert.deepEqual(records.getState().tasks[0].turnIds, ['turn-1'])
    assert.equal(records.attachTurn(task.id, 'turn-1').status, 'review')
    records.requestRevision(task.id, { instructions: 'Increase heading contrast' })
    assert.equal(records.getState().tasks[0].revisionCount, 1)
    assert.deepEqual(records.getState().tasks[0].revisions.map(entry => entry.instructions),
      ['Build hero', 'Increase heading contrast'])
    records.assignTask(task.id)
    records.completeTaskTurn(task.id, { turnId: 'turn-2', outcome: 'Contrast improved' })
    records.acceptTask(task.id)
    records = fx.records()
    const state = records.getState()
    assert.equal(state.tasks[0].status, 'accepted')
    assert.equal(state.decisions[0].id, decision.id)
    assert.equal(state.decisions[0].reason, 'Layout is two-dimensional')
    assert.equal(state.decisions[0].context, 'Hero layout')
    assert.equal(state.questions[0].answer, 'Orange')
    assert.equal(state.workReports.length, 2)
    assert.ok(state.history.length >= 10)
    assert.equal(fs.readdirSync(fx.projectRoot).length, 0)
    assert.ok(fs.existsSync(path.join(fx.userDataPath, 'office-work-records', `${state.projectId}.json`)))
  } finally { fx.cleanup() }
})

test('one intern cannot work on two tasks at once', () => {
  const fx = fixture()
  try {
    const records = fx.records()
    records.savePlan('Build site'); records.approvePlan(1)
    const first = records.createTask({ title: 'First', instructions: 'Make first', acceptanceCriteria: 'First renders' })
    const second = records.createTask({ title: 'Second', instructions: 'Make second', acceptanceCriteria: 'Second renders' })
    const linked = records.addDecision({ choice: 'First first', reason: 'Foundational', taskId: first.id })
    assert.equal(linked.taskId, first.id)
    records.assignTask(first.id)
    assert.throws(() => records.assignTask(second.id), /Another intern task/)
    records.blockTask(first.id, { question: 'Clarify first?' })
    assert.throws(() => records.assignTask(second.id), /Another intern task/)
    records.pauseTask(first.id)
    records.assignTask(second.id)
  } finally { fx.cleanup() }
})

test('live in-turn escalation is interrupted on restart without stale answer', () => {
  const fx = fixture()
  try {
    let records = fx.records()
    records.savePlan('Make a page'); records.approvePlan(1)
    const task = records.createTask({ title: 'Page', instructions: 'Make page', acceptanceCriteria: 'Renders' })
    records.assignTask(task.id)
    const escalation = records.blockTask(task.id, { question: 'Need permission?', sourceRequestId: 'request-123' })
    records = fx.records()
    assert.deepEqual(records.interruptWorkingTasks(), [task.id])
    assert.equal(records.getState().tasks[0].status, 'ready')
    assert.equal(records.getState().tasks[0].interrupted, true)
    assert.equal(records.getState().escalations[0].status, 'interrupted')
    assert.throws(() => records.answerEscalation(escalation.id, 'Yes'), /no longer open/)
  } finally { fx.cleanup() }
})

test('pause/resume and per-project isolation reject malformed input', () => {
  const fx = fixture()
  try {
    const records = fx.records()
    assert.throws(() => records.savePlan('bad\u0000plan'), /readable/)
    records.savePlan('Make a page'); records.approvePlan(1)
    const task = records.createTask({ title: 'Page', instructions: 'Make page', acceptanceCriteria: 'Renders' })
    records.pauseTask(task.id)
    assert.equal(records.getState().tasks[0].status, 'paused')
    assert.throws(() => records.assignTask(task.id), /ready/)
    records.resumeTask(task.id)
    records.assignTask(task.id)
    records.pauseTask(task.id)
    assert.equal(records.getState().tasks[0].status, 'paused')
    const oldId = records.getState().projectId
    fx.setProjectId(randomUUID())
    assert.equal(records.refreshProject().tasks.length, 0)
    assert.notEqual(records.getState().projectId, oldId)
    fx.setProjectId(oldId)
    assert.equal(records.refreshProject().tasks[0].status, 'paused')
  } finally { fx.cleanup() }
})

test('invalid saved file is preserved and rejected', () => {
  const fx = fixture()
  try {
    const records = fx.records()
    records.savePlan('Build site')
    const file = path.join(fx.userDataPath, 'office-work-records', `${records.getState().projectId}.json`)
    fs.writeFileSync(file, '{invalid')
    assert.throws(() => fx.records(), /could not be read/)
    assert.equal(fs.readFileSync(file, 'utf8'), '{invalid')
  } finally { fx.cleanup() }
})
