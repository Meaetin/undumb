const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const VERSION = 1
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RECORD_BYTES = 8 * 1024 * 1024

function fail(message, code = 'INVALID_WORK_RECORD') {
  const error = new Error(message)
  error.code = code
  throw error
}

function text(value, label, max = 30000) {
  if (typeof value !== 'string') fail(`${label} must be text`)
  const result = value.trim()
  if (!result || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
    fail(`${label} must contain 1–${max} readable characters`)
  }
  return result
}

function optionalText(value, label, max = 30000) {
  return value === undefined || value === null || value === '' ? undefined : text(value, label, max)
}

function stringList(value, label, maxItems = 200) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be a list of at most ${maxItems} items`)
  return value.map((item, index) => text(item, `${label} item ${index + 1}`, 2000))
}

function clone(value) { return JSON.parse(JSON.stringify(value)) }
function now() { return new Date().toISOString() }

function initialState(projectId) {
  return {
    version: VERSION, projectId, createdAt: now(), updatedAt: now(),
    plan: { versions: [], approvedVersion: null },
    decisions: [], questions: [], tasks: [], escalations: [], workReports: [], history: [],
  }
}

function latestPlan(state) { return state.plan.versions.at(-1) }
function approvedPlan(state) {
  const latest = latestPlan(state)
  return latest && state.plan.approvedVersion === latest.version ? latest : null
}

function findById(list, id, label) {
  if (typeof id !== 'string' || !PROJECT_ID.test(id)) fail(`Invalid ${label} ID`)
  const item = list.find(entry => entry.id === id)
  if (!item) fail(`${label} was not found`, 'WORK_RECORD_NOT_FOUND')
  return item
}

function addHistory(state, kind, summary) {
  state.history.push({ id: randomUUID(), kind, summary: text(summary, 'History summary', 1000), at: now() })
}

function validateSaved(saved, projectId) {
  if (!saved || saved.version !== VERSION || saved.projectId !== projectId ||
      !saved.plan || !Array.isArray(saved.plan.versions) ||
      !['number', 'object'].includes(typeof saved.plan.approvedVersion) ||
      !['decisions', 'questions', 'tasks', 'escalations', 'workReports', 'history'].every(key => Array.isArray(saved[key]))) {
    fail('Saved work records are invalid. The file was left untouched.', 'INVALID_SAVED_WORK_RECORDS')
  }
  for (let index = 0; index < saved.plan.versions.length; index++) {
    const version = saved.plan.versions[index]
    if (version?.version !== index + 1 || typeof version.text !== 'string' || !version.text || typeof version.at !== 'string') {
      fail('Saved plan history is invalid. The file was left untouched.', 'INVALID_SAVED_WORK_RECORDS')
    }
  }
  if (saved.plan.approvedVersion !== null &&
      (!Number.isSafeInteger(saved.plan.approvedVersion) ||
       saved.plan.approvedVersion < 1 || saved.plan.approvedVersion > saved.plan.versions.length)) {
    fail('Saved plan approval is invalid. The file was left untouched.', 'INVALID_SAVED_WORK_RECORDS')
  }
  return saved
}

class WorkRecords {
  constructor({ userDataPath, getProject }) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) fail('userDataPath must be an absolute path')
    if (typeof getProject !== 'function') fail('getProject must be a function')
    this.userDataPath = userDataPath
    this.getProject = getProject
    this.root = path.join(userDataPath, 'office-work-records')
    this.projectId = null
    this.state = null
    this.refreshProject()
  }

  refreshProject() {
    const project = this.getProject()
    const projectId = project?.metadata?.id ?? null
    if (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID.test(projectId))) {
      fail('Active project ID is invalid', 'INVALID_PROJECT')
    }
    if (projectId === this.projectId) return this.getStateSnapshot()
    if (!projectId) {
      this.projectId = null
      this.state = null
      return null
    }
    const file = path.join(this.root, `${projectId}.json`)
    let nextState
    let stat
    try { stat = fs.lstatSync(file) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_BYTES) {
        fail('Saved work records are invalid. The file was left untouched.', 'INVALID_SAVED_WORK_RECORDS')
      }
      try { nextState = validateSaved(JSON.parse(fs.readFileSync(file, 'utf8')), projectId) }
      catch (error) {
        if (error.code === 'INVALID_SAVED_WORK_RECORDS') throw error
        fail('Saved work records could not be read. The file was left untouched.', 'INVALID_SAVED_WORK_RECORDS')
      }
    } else nextState = initialState(projectId)
    this.projectId = projectId
    this.state = nextState
    return this.getStateSnapshot()
  }

  filePath() {
    if (!this.projectId) fail('Create a website project first', 'NO_PROJECT')
    return path.join(this.root, `${this.projectId}.json`)
  }

  getStateSnapshot() { return this.state ? clone(this.state) : null }
  getState() { this.refreshProject(); return this.getStateSnapshot() }
  getApprovedPlanText() { this.refreshProject(); return this.state ? approvedPlan(this.state)?.text ?? null : null }

  persist(state) {
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const rootStat = fs.lstatSync(this.root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('Work record directory is invalid', 'INVALID_WORK_RECORD_PATH')
    const file = this.filePath()
    try {
      const current = fs.lstatSync(file)
      if (!current.isFile() || current.isSymbolicLink()) fail('Work record file is invalid', 'INVALID_WORK_RECORD_PATH')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const serialized = JSON.stringify(state, null, 2) + '\n'
    if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) fail('Work records exceed the size limit', 'WORK_RECORD_LIMIT')
    const temp = path.join(this.root, `${this.projectId}.${randomUUID()}.tmp`)
    let fd
    try {
      fd = fs.openSync(temp, 'wx', 0o600)
      fs.writeFileSync(fd, serialized, 'utf8')
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temp, file)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
      try { fs.unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }

  mutate(callback) {
    this.refreshProject()
    if (!this.state) fail('Create a website project first', 'NO_PROJECT')
    const next = clone(this.state)
    const result = callback(next)
    next.updatedAt = now()
    this.persist(next)
    this.state = next
    return clone(result)
  }

  savePlan(value) {
    const planText = text(value, 'Plan', 50000)
    return this.mutate(state => {
      const version = { version: state.plan.versions.length + 1, text: planText, at: now() }
      state.plan.versions.push(version)
      state.plan.approvedVersion = null
      addHistory(state, 'plan', `Boss saved plan version ${version.version}`)
      return version
    })
  }

  approvePlan(version) {
    return this.mutate(state => {
      const latest = latestPlan(state)
      if (!latest || version !== latest.version) fail('Approve the latest plan version exactly', 'PLAN_VERSION_MISMATCH')
      state.plan.approvedVersion = version
      addHistory(state, 'plan-approved', `Boss approved plan version ${version}`)
      return latest
    })
  }

  revokePlanApproval() {
    return this.mutate(state => {
      state.plan.approvedVersion = null
      addHistory(state, 'plan-revoked', 'Boss revoked plan approval')
      return state.plan
    })
  }

  importLegacyPlan(value, approved = false) {
    const planText = text(value, 'Legacy plan', 50000)
    if (typeof approved !== 'boolean') fail('Legacy approval must be a boolean')
    return this.mutate(state => {
      if (state.plan.versions.length) return latestPlan(state)
      const version = { version: 1, text: planText, at: now() }
      state.plan.versions.push(version)
      state.plan.approvedVersion = approved ? 1 : null
      addHistory(state, 'plan-imported', approved ? 'Imported previously approved plan' : 'Imported previous plan draft')
      return version
    })
  }

  addDecision({ choice, reason, context, taskId } = {}) {
    const safeChoice = text(choice, 'Decision', 5000)
    const safeReason = text(reason, 'Decision reason', 10000)
    const safeContext = optionalText(context, 'Decision context', 10000)
    return this.mutate(state => {
      const decision = { id: randomUUID(), choice: safeChoice, reason: safeReason, at: now() }
      if (safeContext) decision.context = safeContext
      if (taskId !== undefined) decision.taskId = findById(state.tasks, taskId, 'Task').id
      state.decisions.push(decision)
      addHistory(state, 'decision', safeChoice.slice(0, 500))
      return decision
    })
  }

  addQuestion({ question, context } = {}) {
    const safeQuestion = text(question, 'Question', 5000)
    const safeContext = optionalText(context, 'Question context', 10000)
    return this.mutate(state => {
      const item = { id: randomUUID(), question: safeQuestion, status: 'open', createdAt: now() }
      if (safeContext) item.context = safeContext
      state.questions.push(item)
      addHistory(state, 'question', safeQuestion.slice(0, 500))
      return item
    })
  }

  resolveQuestion(id, answer) {
    const safeAnswer = text(answer, 'Question answer', 10000)
    return this.mutate(state => {
      const question = findById(state.questions, id, 'Question')
      if (question.status !== 'open') fail('Question is already resolved', 'INVALID_WORK_TRANSITION')
      question.status = 'answered'; question.answer = safeAnswer; question.answeredAt = now()
      addHistory(state, 'question-answered', question.question.slice(0, 500))
      return question
    })
  }

  createTask({ title, instructions, acceptanceCriteria } = {}) {
    const safeTitle = text(title, 'Task title', 300)
    const safeInstructions = text(instructions, 'Task instructions', 30000)
    const safeCriteria = text(acceptanceCriteria, 'Acceptance criteria', 15000)
    return this.mutate(state => {
      const plan = approvedPlan(state)
      if (!plan) fail('Approve the latest plan before creating an intern task', 'PLAN_NOT_APPROVED')
      const task = { id: randomUUID(), title: safeTitle, instructions: safeInstructions,
        acceptanceCriteria: safeCriteria, status: 'ready', planVersion: plan.version,
        turnIds: [], revisionCount: 0, interrupted: false, createdAt: now(), updatedAt: now(),
        revisions: [{ version: 0, instructions: safeInstructions, acceptanceCriteria: safeCriteria, at: now() }] }
      state.tasks.push(task)
      addHistory(state, 'task-created', safeTitle)
      return task
    })
  }

  assignTask(id) {
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'ready') fail('Task must be ready before assignment', 'INVALID_WORK_TRANSITION')
      if (state.tasks.some(other => other.id !== id && ['working', 'blocked'].includes(other.status))) {
        fail('Another intern task is active. Finish or pause it first', 'INTERN_BUSY')
      }
      const plan = approvedPlan(state)
      if (!plan || task.planVersion !== plan.version) fail('Task requires the current approved plan', 'PLAN_NOT_APPROVED')
      if (state.escalations.some(item => item.taskId === id && item.status === 'open')) {
        fail('Answer the open blocker before assigning this task', 'OPEN_ESCALATION')
      }
      task.status = 'working'; task.interrupted = false; task.updatedAt = now()
      addHistory(state, 'task-assigned', task.title)
      return task
    })
  }

  attachTurn(id, turnId) {
    const safeTurnId = text(turnId, 'Codex turn ID', 200)
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      // A very short turn may complete before turn/start returns to the bridge.
      if (task.status !== 'working' && !(task.status === 'review' && task.turnIds.includes(safeTurnId))) {
        fail('Task is not working', 'INVALID_WORK_TRANSITION')
      }
      if (!task.turnIds.includes(safeTurnId)) task.turnIds.push(safeTurnId)
      task.updatedAt = now()
      return task
    })
  }

  pauseTask(id) {
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (!['ready', 'working', 'blocked'].includes(task.status)) fail('Task cannot be paused now', 'INVALID_WORK_TRANSITION')
      if (task.status === 'blocked') {
        for (const escalation of state.escalations) {
          if (escalation.taskId === id && escalation.status === 'open' && escalation.sourceRequestId) {
            escalation.status = 'interrupted'; escalation.interruptedAt = now()
          }
        }
      }
      task.status = 'paused'; task.updatedAt = now()
      addHistory(state, 'task-paused', task.title)
      return task
    })
  }

  resumeTask(id) {
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'paused') fail('Task is not paused', 'INVALID_WORK_TRANSITION')
      task.status = 'ready'; task.updatedAt = now()
      addHistory(state, 'task-resumed', task.title)
      return task
    })
  }

  interruptWorkingTasks() {
    return this.mutate(state => {
      const interrupted = []
      for (const task of state.tasks) {
        const liveEscalation = state.escalations.some(item =>
          item.taskId === task.id && item.status === 'open' && item.sourceRequestId)
        // An ordinary final-message blocker remains answerable after restart.
        if (task.status !== 'working' && !(task.status === 'blocked' && liveEscalation)) continue
        task.status = 'ready'; task.interrupted = true; task.updatedAt = now()
        interrupted.push(task.id)
        addHistory(state, 'task-interrupted', `${task.title}: previous Codex turn cannot resume automatically`)
      }
      for (const escalation of state.escalations) {
        if (interrupted.includes(escalation.taskId) && escalation.status === 'open' && escalation.sourceRequestId) {
          escalation.status = 'interrupted'; escalation.interruptedAt = now()
        }
      }
      return interrupted
    })
  }

  blockTask(id, { question, evidence, sourceRequestId } = {}) {
    const safeQuestion = text(question, 'Escalation question', 10000)
    const safeEvidence = optionalText(evidence, 'Escalation evidence', 15000)
    const safeSource = optionalText(sourceRequestId, 'Source request ID', 200)
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'working') fail('Only a working task can be blocked', 'INVALID_WORK_TRANSITION')
      if (state.escalations.some(item => item.taskId === id && item.status === 'open')) fail('Task already has an open blocker', 'OPEN_ESCALATION')
      const escalation = { id: randomUUID(), taskId: id, question: safeQuestion, status: 'open', createdAt: now() }
      if (safeEvidence) escalation.evidence = safeEvidence
      if (safeSource) escalation.sourceRequestId = safeSource
      state.escalations.push(escalation)
      task.status = 'blocked'; task.updatedAt = now()
      addHistory(state, 'task-blocked', `${task.title}: ${safeQuestion.slice(0, 400)}`)
      return escalation
    })
  }

  answerEscalation(id, answer, { resumeWorking = false } = {}) {
    const safeAnswer = text(answer, 'Escalation answer', 15000)
    if (typeof resumeWorking !== 'boolean') fail('resumeWorking must be a boolean')
    return this.mutate(state => {
      const escalation = findById(state.escalations, id, 'Escalation')
      if (escalation.status !== 'open') fail('Escalation is no longer open', 'INVALID_WORK_TRANSITION')
      const task = findById(state.tasks, escalation.taskId, 'Task')
      if (!['blocked', 'paused'].includes(task.status)) fail('Task is not waiting on this escalation', 'INVALID_WORK_TRANSITION')
      if (resumeWorking && (!escalation.sourceRequestId || task.status !== 'blocked')) {
        fail('Only a live in-turn request may resume work', 'INVALID_WORK_TRANSITION')
      }
      escalation.status = 'answered'; escalation.answer = safeAnswer; escalation.answeredAt = now()
      task.status = resumeWorking ? 'working' : task.status === 'paused' ? 'paused' : 'ready'
      task.updatedAt = now()
      addHistory(state, 'escalation-answered', `${task.title}: boss answered blocker`)
      return escalation
    })
  }

  completeTaskTurn(id, { turnId, outcome, filesChanged, checks, unresolved } = {}) {
    const safeTurnId = optionalText(turnId, 'Codex turn ID', 200)
    const safeOutcome = text(outcome, 'Work outcome', 15000)
    const safeFiles = stringList(filesChanged, 'Changed files')
    const safeChecks = stringList(checks, 'Checks')
    const safeUnresolved = stringList(unresolved, 'Unresolved items')
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'working') fail('Only a working task can move to review', 'INVALID_WORK_TRANSITION')
      const report = { id: randomUUID(), taskId: id, outcome: safeOutcome, filesChanged: safeFiles,
        checks: safeChecks, unresolved: safeUnresolved, at: now() }
      if (safeTurnId) report.turnId = safeTurnId
      state.workReports.push(report)
      if (safeTurnId && !task.turnIds.includes(safeTurnId)) task.turnIds.push(safeTurnId)
      task.status = 'review'; task.updatedAt = now()
      addHistory(state, 'task-review', task.title)
      return report
    })
  }

  requestRevision(id, { instructions, acceptanceCriteria } = {}) {
    const safeInstructions = text(instructions, 'Revision instructions', 30000)
    const safeCriteria = optionalText(acceptanceCriteria, 'Acceptance criteria', 15000)
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'review') fail('Only review-ready work can be revised', 'INVALID_WORK_TRANSITION')
      const plan = approvedPlan(state)
      if (!plan) fail('Approve the latest plan before revision', 'PLAN_NOT_APPROVED')
      if (task.revisions.length >= 30) fail('Task reached the revision limit', 'WORK_RECORD_LIMIT')
      task.instructions = safeInstructions
      if (safeCriteria) task.acceptanceCriteria = safeCriteria
      task.planVersion = plan.version
      task.revisionCount += 1
      task.revisions.push({ version: task.revisionCount, instructions: task.instructions,
        acceptanceCriteria: task.acceptanceCriteria, at: now() })
      task.status = 'ready'; task.updatedAt = now()
      addHistory(state, 'task-revision', `${task.title}: revision ${task.revisionCount}`)
      return task
    })
  }

  acceptTask(id) {
    return this.mutate(state => {
      const task = findById(state.tasks, id, 'Task')
      if (task.status !== 'review') fail('Review the work before accepting it', 'INVALID_WORK_TRANSITION')
      task.status = 'accepted'; task.updatedAt = now()
      addHistory(state, 'task-accepted', task.title)
      return task
    })
  }
}

module.exports = { WorkRecords }
