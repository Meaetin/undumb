const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const EventEmitter = require('node:events')
const { WorkRecords } = require('./work-records.cjs')
const { OfficeControls } = require('./office-controls.cjs')
const { WARNING_PERCENT, buildUsageState } = require('./usage-state.cjs')
const { listProjectChanges } = require('./file-review.cjs')

const LEAD_INSTRUCTIONS = `You are the tech lead in the Boss's Office. The human boss owns product and engineering decisions. Ask focused questions about requirements, trade-offs, dependencies, and failure cases. Give hints first; research and compare options with sources when asked. Record which choices the boss made and why. Produce a plan for the boss to approve, but never treat your suggestion as approval. You may inspect the active frontend project but must not edit files. Keep your final replies clear and concise.`
const INTERN_INSTRUCTIONS = `You are the intern in the Boss's Office. Work only on the assigned task within this frontend-only Vite, React, TypeScript website. The boss owns decisions. Follow explicit task instructions and existing conventions for routine details. If instructions are ambiguous, an action fails, or a new decision is needed, stop before guessing and ask the boss a concrete question with evidence and options. End a blocked final message with the exact marker [BOSS_OFFICE_BLOCKED]. Never use that marker when work is complete. Do not access files outside this project. Report actual files changed, checks run, and unresolved issues.`
const MAX_MESSAGE = 30000
const MAX_ACTIVITY = 80

function resolveCodexCommand(command = 'codex', env = process.env, platform = process.platform) {
  if (platform !== 'win32' || command !== 'codex') return command

  // Electron may be started from Explorer with a different PATH than a terminal.
  // Windows cannot reliably spawn a .cmd shim without a shell, so use an .exe.
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe')
    try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
  }

  const profileLocalAppData = path.join(env.USERPROFILE || require('node:os').homedir(), 'AppData', 'Local')
  const localRoots = [...new Set([env.LOCALAPPDATA, profileLocalAppData].filter(Boolean))]
  const candidates = []
  for (const localRoot of localRoots) {
    const binRoot = path.join(localRoot, 'OpenAI', 'Codex', 'bin')
    try {
      for (const entry of fs.readdirSync(binRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(binRoot, entry.name, 'codex.exe')
        try { const stat = fs.statSync(candidate); if (stat.isFile()) candidates.push({ candidate, mtimeMs: stat.mtimeMs }) }
        catch {}
      }
    } catch {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (candidates.length) return candidates[0].candidate

  // Keep the original spawn error when Codex really is unavailable.
  return command
}

function initialRole() { return { threadId: undefined, turnId: undefined, status: 'idle', messages: [] } }
function sanitizeText(value, max = MAX_MESSAGE) {
  if (typeof value !== 'string') throw new Error('Text must be a string')
  const text = value.trim()
  if (!text || text.length > max) throw new Error(`Text must be 1–${max} characters`)
  return text
}
function denyApproval(method) {
  return method === 'item/permissions/requestApproval'
    ? { permissions: {}, scope: 'turn' }
    : { decision: 'decline' }
}
function boundedObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing`)
  const serialized = JSON.stringify(value)
  if (!serialized || serialized.length > 10000) throw new Error(`${label} is too large`)
  return JSON.parse(serialized)
}
function requestedPermissions(value) {
  const permissions = boundedObject(value, 'Requested permissions')
  const keys = Object.keys(permissions)
  if (!keys.length || keys.some(key => !['network', 'fileSystem'].includes(key))) {
    throw new Error('Permission request contains unknown or empty fields')
  }
  if ('network' in permissions &&
      (!permissions.network || typeof permissions.network !== 'object' ||
       typeof permissions.network.enabled !== 'boolean')) {
    throw new Error('Network permission request is unclear')
  }
  if ('fileSystem' in permissions) {
    const files = permissions.fileSystem
    if (!files || typeof files !== 'object' || Array.isArray(files) ||
        !Object.keys(files).length || Object.keys(files).some(key => !['entries', 'read', 'write', 'globScanMaxDepth'].includes(key))) {
      throw new Error('File permission request is unclear')
    }
    if (files.entries !== undefined && (!Array.isArray(files.entries) || files.entries.some(entry =>
      !['read', 'write', 'deny'].includes(entry?.access) ||
      !['path', 'glob_pattern', 'special'].includes(entry?.path?.type) ||
      typeof (entry.path.path ?? entry.path.pattern ?? entry.path.value) !== 'string'))) {
      throw new Error('File permission entries are unclear')
    }
    if (['read', 'write'].some(key => files[key] !== undefined &&
      (!Array.isArray(files[key]) || files[key].some(item => typeof item !== 'string')))) {
      throw new Error('File permission paths are unclear')
    }
    if (!(files.entries?.length || files.read?.length || files.write?.length)) {
      throw new Error('File permission request names no paths')
    }
  }
  return permissions
}
function approvalContext(method, params) {
  const context = {
    reason: typeof params.reason === 'string' ? params.reason.slice(0, 2000) : undefined,
    command: typeof params.command === 'string' ? params.command.slice(0, 5000) : undefined,
    cwd: typeof params.cwd === 'string' ? params.cwd.slice(0, 2000) : undefined,
    host: typeof params.networkApprovalContext?.host === 'string' ? params.networkApprovalContext.host.slice(0, 500) : undefined,
    protocol: typeof params.networkApprovalContext?.protocol === 'string' ? params.networkApprovalContext.protocol : undefined,
    port: Number.isInteger(params.networkApprovalContext?.port) ? params.networkApprovalContext.port : undefined,
    grantRoot: typeof params.grantRoot === 'string' ? params.grantRoot.slice(0, 2000) : undefined,
    files: Array.isArray(params.changes) ? params.changes.map(change => change?.path).filter(file => typeof file === 'string').slice(0, 100) : undefined,
  }
  if (method === 'item/commandExecution/requestApproval') {
    if (!context.command || !context.cwd) throw new Error('Command approval does not identify the command and directory')
    if (params.additionalPermissions) context.additionalPermissions = boundedObject(params.additionalPermissions, 'Additional permissions')
  } else if (method === 'item/fileChange/requestApproval') {
    if (!context.grantRoot && !context.files?.length) throw new Error('File approval does not identify the requested files or root')
  } else {
    context.permissions = requestedPermissions(params.permissions)
  }
  return context
}
function approvalDetails(context) {
  return [context.reason, context.command, context.cwd,
    context.host && `Network: ${context.protocol || 'unknown'}://${context.host}${context.port ? `:${context.port}` : ''}`,
    context.grantRoot && `Grant root: ${context.grantRoot}`,
    context.files?.length && `Files: ${context.files.join(', ')}`,
    context.additionalPermissions && `Additional permissions: ${JSON.stringify(context.additionalPermissions)}`,
    context.permissions && `Requested permissions: ${JSON.stringify(context.permissions)}`].filter(Boolean).join('\n')
}
function unavailableRecords(error) {
  return new Proxy({}, { get(_target, property) {
    if (property === 'getState') return () => null
    if (property === 'getApprovedPlanText') return () => null
    if (property === 'interruptWorkingTasks') return () => []
    return () => { throw new Error(`Work records could not be loaded: ${error.message}`) }
  } })
}

class CodexBridge extends EventEmitter {
  constructor({ userDataPath, getProject, command = 'codex' }) {
    super()
    this.userDataPath = userDataPath
    this.getProject = getProject
    this.command = command
    this.storagePath = path.join(userDataPath, 'office-agent-state.json')
    this.state = { connection: 'stopped', error: undefined, project: null, planApproved: false, approvedPlanText: undefined,
      roles: { lead: initialRole(), intern: initialRole() }, requests: [], activity: [], workRecords: null, controls: null,
      usage: { status: 'unavailable', source: 'Codex app-server account endpoints', thresholdPercent: WARNING_PERCENT,
        buckets: [], tokenActivity: null, warnings: [], rateError: 'Codex not connected', tokenError: 'Codex not connected' } }
    this.projectReadFailed = false
    try {
      this.officeControls = new OfficeControls({ userDataPath })
      this.state.controls = this.officeControls.getState()
    } catch (error) {
      this.controlsLoadError = error
      this.state.controls = { settings: null, capabilities: { leadNetwork: false, internNetwork: false, internFileEdits: true, terminalCommands: false, approvalReviewer: true }, error: error.message }
      this.state.error = error.message
    }
    try {
      this.workRecords = new WorkRecords({ userDataPath, getProject: () => {
        try { return getProject() } catch { return null }
      } })
    } catch (error) {
      this.workRecordsLoadError = error
      this.workRecords = unavailableRecords(error)
      this.state.error = `Work records could not be loaded: ${error.message}`
    }
    this.child = null
    this.stdout = ''
    this.nextRpcId = 1
    this.pendingRpc = new Map()
    this.serverRequests = new Map()
    this.completedTurns = new Set()
    this.finalMessageByTurn = new Map()
    this.startPromise = null
    this.stopping = false
    this.saveTimer = null
    this.usageRefreshPromise = null
    this.usageRefreshTimer = null
    this.usagePoll = null
    this.activeInternTaskId = null
    this.pendingInternDispatch = false
    this.turnStarts = new Set()
    this.pausePending = null
    this.loadSaved()
    this.refreshProject()
    // A Codex app-server request belongs to its old process. It cannot be
    // answered after relaunch, even when the thread itself can be resumed.
    this.interruptActiveRecords()
    this.syncWorkRecords()
  }

  loadSaved() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
      if (saved?.version !== 1) return
      for (const role of ['lead', 'intern']) {
        const source = saved.roles?.[role]
        if (!source) continue
        this.state.roles[role].threadId = typeof source.threadId === 'string' ? source.threadId : undefined
        this.state.roles[role].messages = Array.isArray(source.messages) ? source.messages.slice(-100) : []
      }
      this.savedProjectId = saved.projectId
      this.approvedPlan = typeof saved.approvedPlan === 'string' ? saved.approvedPlan : null
      this.state.planApproved = Boolean(saved.planApproved && this.approvedPlan)
      this.state.approvedPlanText = this.state.planApproved ? this.approvedPlan : undefined
      this.state.activity = Array.isArray(saved.activity) ? saved.activity.slice(-MAX_ACTIVITY) : []
    } catch (error) {
      if (error.code !== 'ENOENT') this.state.error = 'Saved agent state could not be loaded.'
    }
  }

  scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save() }, 500)
  }

  save() {
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true })
      const payload = { version: 1, projectId: this.state.project?.metadata?.id,
        planApproved: this.state.planApproved, approvedPlan: this.approvedPlan,
        activity: this.state.activity.slice(-MAX_ACTIVITY),
        roles: Object.fromEntries(['lead', 'intern'].map(role => [role, {
          threadId: this.state.roles[role].threadId,
          messages: this.state.roles[role].messages.slice(-100),
        }])) }
      const temp = `${this.storagePath}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 })
      fs.renameSync(temp, this.storagePath)
    } catch (error) {
      this.state.error = `Could not save agent state: ${error.message}`
      this.emitState()
    }
  }

  refreshProject() {
    let project
    try { project = this.getProject() }
    catch (error) {
      this.projectReadFailed = true
      this.state.error = `Active project could not be opened: ${error.message}`
      this.emitState()
      return null
    }
    this.projectReadFailed = false
    if (!project || project.metadata.id !== this.savedProjectId) {
      this.state.roles = { lead: initialRole(), intern: initialRole() }
      this.state.planApproved = false
      this.approvedPlan = null
      this.state.approvedPlanText = undefined
    }
    this.state.project = project
    this.savedProjectId = project?.metadata?.id
    if (project && this.approvedPlan && this.workRecords.getState()?.plan.versions.length === 0) {
      this.workRecords.importLegacyPlan(this.approvedPlan, this.state.planApproved)
    }
    this.syncWorkRecords()
    this.emitState()
    this.scheduleSave()
    return project
  }

  getState() { return JSON.parse(JSON.stringify(this.state)) }
  syncWorkRecords() {
    if (this.projectReadFailed) return
    if (this.workRecordsLoadError) {
      this.state.workRecords = null
      this.state.error = `Work records could not be loaded: ${this.workRecordsLoadError.message}`
      return
    }
    this.state.workRecords = this.workRecords.getState()
    this.approvedPlan = this.workRecords.getApprovedPlanText()
    this.state.planApproved = Boolean(this.approvedPlan)
    this.state.approvedPlanText = this.approvedPlan || undefined
  }
  interruptActiveRecords() {
    if (this.workRecords.getState()) this.workRecords.interruptWorkingTasks()
  }
  emitState() { this.emit('state', this.getState()) }
  addActivity(role, kind, summary) {
    this.state.activity.push({ id: randomUUID(), role, kind, summary: String(summary).slice(0, 1000), at: new Date().toISOString() })
    this.state.activity = this.state.activity.slice(-MAX_ACTIVITY)
    this.scheduleSave()
    this.emitState()
  }

  async start() {
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start()
    return this.startPromise
  }

  async _start() {
    this.stopping = false
    this.state.connection = 'starting'
    this.state.error = undefined
    this.emitState()
    try {
      fs.mkdirSync(this.userDataPath, { recursive: true })
      const executable = resolveCodexCommand(this.command)
      const reviewer = this.officeControls?.settings.approvalReviewer || 'user'
      const child = spawn(executable, ['app-server', '--listen', 'stdio://', '-c', `approvals_reviewer="${reviewer}"`], {
        cwd: this.userDataPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => this.onStdout(chunk))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => { this.lastStderr = (this.lastStderr || '').concat(chunk).slice(-2000) })
      child.on('error', error => this.onExit(error))
      child.on('close', code => this.onExit(new Error(`Codex app-server exited (${code})`)))
      await this.rpc('initialize', { clientInfo: { name: 'boss_office', title: "The Boss's Office", version: '0.1.0' },
        capabilities: { experimentalApi: true } }, 20000)
      this.send({ method: 'initialized', params: {} })
      const account = await this.rpc('account/read', { refreshToken: false }, 20000)
      if (account?.account?.type !== 'chatgpt') {
        throw new Error('Codex is not signed in with a ChatGPT account. Run codex login, choose ChatGPT sign-in, then restart the office.')
      }
      this.state.connection = 'ready'
      this.state.error = this.controlsLoadError?.message || (this.workRecordsLoadError
        ? `Work records could not be loaded: ${this.workRecordsLoadError.message}` : undefined)
      this.emitState()
      void this.refreshUsage().catch(() => {})
      this.usagePoll = setInterval(() => { void this.refreshUsage().catch(() => {}) }, 120000)
    } catch (error) {
      const child = this.child
      if (child) { this.onExit(error); child.kill() }
      else this.startPromise = null
      this.state.connection = 'error'
      this.state.error = error.code === 'ENOENT'
        ? 'Codex CLI was not found. Install the Codex CLI, ensure codex.exe is on PATH, then restart the office.'
        : `Could not connect to local Codex: ${error.message}`
      this.emitState()
      throw error
    }
  }

  onExit(error) {
    if (!this.child) return
    if (this.usagePoll) { clearInterval(this.usagePoll); this.usagePoll = null }
    if (this.usageRefreshTimer) { clearTimeout(this.usageRefreshTimer); this.usageRefreshTimer = null }
    this.usageRefreshPromise = null
    this.child = null
    this.startPromise = null
    for (const pending of this.pendingRpc.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pendingRpc.clear()
    for (const request of this.serverRequests.values()) this.state.requests = this.state.requests.filter(item => item.id !== request.id)
    this.serverRequests.clear()
    if (this.pausePending) {
      clearTimeout(this.pausePending.timer)
      this.pausePending.reject(new Error('Codex disconnected before confirming the pause'))
      this.pausePending = null
    }
    this.interruptActiveRecords()
    this.activeInternTaskId = null
    this.pendingInternDispatch = false
    this.syncWorkRecords()
    for (const role of ['lead', 'intern']) {
      this.state.roles[role].turnId = undefined
      if (this.state.roles[role].status === 'working') this.state.roles[role].status = 'error'
    }
    this.state.connection = this.stopping ? 'stopped' : 'error'
    this.state.usage = { ...this.state.usage, status: 'unavailable',
      rateError: 'Codex not connected', tokenError: 'Codex not connected' }
    if (!this.stopping) this.state.error = error.message
    this.emitState()
  }

  send(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not available')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  rpc(method, params, timeoutMs = 30000) {
    const id = this.nextRpcId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingRpc.delete(id); reject(new Error(`${method} timed out`)) }, timeoutMs)
      this.pendingRpc.set(id, { resolve, reject, timer, method })
      try { this.send({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pendingRpc.delete(id); reject(error) }
    })
  }

  scheduleUsageRefresh() {
    if (this.usageRefreshTimer || !this.child) return
    this.usageRefreshTimer = setTimeout(() => {
      this.usageRefreshTimer = null
      void this.refreshUsage().catch(() => {})
    }, 1000)
  }

  async refreshUsage() {
    if (this.usageRefreshPromise) return this.usageRefreshPromise
    if (!this.child || this.state.connection !== 'ready') throw new Error('Codex is not connected')
    const child = this.child
    this.state.usage = { ...this.state.usage, status: 'loading' }
    this.emitState()
    const refresh = (async () => {
      const [rates, tokens] = await Promise.allSettled([
        this.rpc('account/rateLimits/read', {}, 20000),
        this.rpc('account/usage/read', {}, 20000),
      ])
      if (this.child !== child) return this.state.usage
      this.state.usage = buildUsageState(
        rates.status === 'fulfilled' ? rates.value : null,
        tokens.status === 'fulfilled' ? tokens.value : null,
        { rate: rates.status === 'rejected' ? rates.reason.message : null,
          tokens: tokens.status === 'rejected' ? tokens.reason.message : null },
      )
      this.emitState()
      return this.state.usage
    })()
    this.usageRefreshPromise = refresh
    try { return await refresh }
    finally { if (this.usageRefreshPromise === refresh) this.usageRefreshPromise = null }
  }

  onStdout(chunk) {
    this.stdout += chunk
    if (this.stdout.length > 4_000_000) {
      const child = this.child
      this.onExit(new Error('Codex output exceeded the safe line limit'))
      child?.kill()
      return
    }
    while (true) {
      const index = this.stdout.indexOf('\n')
      if (index < 0) break
      const line = this.stdout.slice(0, index).trim()
      this.stdout = this.stdout.slice(index + 1)
      if (!line) continue
      try { this.onMessage(JSON.parse(line)) }
      catch (error) { this.addActivity('lead', 'protocol', `Ignored malformed Codex message: ${error.message}`) }
    }
  }

  onMessage(message) {
    if (message && 'method' in message) {
      if ('id' in message) this.onServerRequest(message)
      else this.onNotification(message.method, message.params || {})
      return
    }
    const pending = this.pendingRpc.get(message?.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingRpc.delete(message.id)
    if (message.error) pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`))
    else pending.resolve(message.result)
  }

  roleForThread(threadId) {
    return ['lead', 'intern'].find(role => this.state.roles[role].threadId === threadId)
  }

  onServerRequest(message) {
    const { id, method, params = {} } = message
    const role = this.roleForThread(params.threadId)
    const approval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
      'item/permissions/requestApproval'].includes(method)
    const question = method === 'item/tool/requestUserInput'
    const actor = role && this.state.roles[role]
    const wrongTurn = Boolean(params.turnId && actor?.turnId && params.turnId !== actor.turnId)
    const requestedNetwork = method === 'item/permissions/requestApproval' && params.permissions?.network?.enabled === true
    const restrictedInternApproval = role === 'intern' && approval &&
      (!this.officeControls?.settings.internFileEdits ||
        ((method === 'item/commandExecution/requestApproval' || requestedNetwork) && !this.officeControls?.settings.internNetwork))
    if (!role || (!approval && !question) || (role === 'lead' && approval) ||
        (role === 'intern' && !this.activeInternTaskId) || wrongTurn || restrictedInternApproval) {
      if (approval) this.send({ id, result: denyApproval(method) })
      else this.send({ id, error: { code: -32601, message: 'Unsupported office request' } })
      return
    }
    const requestId = randomUUID()
    const title = approval ? 'Codex requests permission' : 'Agent needs your answer'
    let context
    try { if (approval) context = approvalContext(method, params) }
    catch (error) {
      this.send({ id, result: denyApproval(method) })
      this.addActivity(role, 'approval', `Declined request with incomplete details: ${error.message}`)
      return
    }
    const details = approval ? approvalDetails(context) : undefined
    let escalationId
    const taskId = role === 'intern' ? this.activeInternTaskId : undefined
    if (taskId) {
      const prompt = question
        ? (params.questions || []).map(item => item.question).filter(Boolean).join('\n') || title
        : `Approve this action? ${details || title}`
      try {
        const escalation = this.workRecords.blockTask(taskId, {
          question: prompt, evidence: details, sourceRequestId: requestId,
        })
        escalationId = escalation.id
        this.syncWorkRecords()
      } catch (error) {
        // Every server request must receive a response; otherwise the Codex
        // turn can remain blocked forever on an untracked request.
        if (approval) this.send({ id, result: denyApproval(method) })
        else this.send({ id, error: { code: -32000, message: 'Office already has an open blocker for this task' } })
        this.addActivity('intern', 'error', `Could not record Codex request: ${error.message}`)
        return
      }
    }
    const record = { id: requestId, role, taskId, escalationId, kind: approval ? 'approval' : 'question', method, title,
      details, context, questions: question ? params.questions : undefined }
    this.serverRequests.set(requestId, { id: requestId, rpcId: id, method, role, taskId, escalationId,
      questions: params.questions, requestedPermissions: context?.permissions })
    this.state.requests.push(record)
    this.state.roles[role].status = 'blocked'
    this.emitState()
  }

  resolveRequest(requestId, response) {
    const pending = this.serverRequests.get(requestId)
    if (!pending) throw new Error('This Codex request is no longer pending')
    let result
    if (pending.method === 'item/tool/requestUserInput') {
      const answers = response?.answers
      if (!answers || typeof answers !== 'object') throw new Error('Question answers are required')
      const safe = {}
      for (const question of pending.questions || []) {
        const values = answers[question.id]?.answers
        if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 10000)) {
          throw new Error(`Answer required for ${question.id}`)
        }
        safe[question.id] = { answers: values.map(value => value.trim()) }
      }
      result = { answers: safe }
    } else {
      if (!['accept', 'decline'].includes(response?.decision)) throw new Error('Choose accept or decline')
      if (pending.role !== 'intern' && response.decision === 'accept') throw new Error('The tech lead cannot receive write approval')
      result = pending.method === 'item/permissions/requestApproval'
        ? { permissions: response.decision === 'accept' ? pending.requestedPermissions : {}, scope: 'turn' }
        : { decision: response.decision }
    }
    if (pending.taskId) {
      const task = this.workRecords.getState()?.tasks.find(item => item.id === pending.taskId)
      if (!task || task.status !== 'blocked' || pending.taskId !== this.activeInternTaskId) {
        throw new Error('This request no longer belongs to the active intern task')
      }
    }
    this.send({ id: pending.rpcId, result })
    this.serverRequests.delete(requestId)
    this.state.requests = this.state.requests.filter(item => item.id !== requestId)
    if (pending.escalationId) {
      const answer = pending.method === 'item/tool/requestUserInput'
        ? Object.values(result.answers).flatMap(item => item.answers).join('\n')
        : `Boss ${response.decision === 'accept' ? 'approved' : 'declined'} the action.`
      this.workRecords.answerEscalation(pending.escalationId, answer, { resumeWorking: true })
      this.syncWorkRecords()
    }
    this.state.roles[pending.role].status = 'working'
    this.addActivity(pending.role, 'decision', pending.method === 'item/tool/requestUserInput' ? 'Boss answered agent question' : `Boss ${response.decision === 'accept' ? 'approved' : 'declined'} requested action`)
  }

  onNotification(method, params) {
    if (method === 'account/rateLimits/updated' || method === 'account/updated' || method === 'turn/completed') {
      this.scheduleUsageRefresh()
    }
    if (method === 'serverRequest/resolved') {
      for (const [requestId, request] of this.serverRequests) {
        if (request.rpcId !== params.requestId) continue
        this.serverRequests.delete(requestId)
        this.state.requests = this.state.requests.filter(item => item.id !== requestId)
        if (request.taskId) {
          const escalation = this.workRecords.getState()?.escalations.find(item => item.id === request.escalationId)
          if (escalation?.status === 'open') {
            this.interruptActiveRecords()
            this.activeInternTaskId = null
            this.syncWorkRecords()
          }
        }
        const requestRole = this.state.roles[request.role]
        if (requestRole.status === 'blocked' && requestRole.turnId && (!request.taskId || this.activeInternTaskId === request.taskId)) requestRole.status = 'working'
        this.emitState()
        break
      }
      return
    }
    const role = this.roleForThread(params.threadId)
    if (!role) return
    const actor = this.state.roles[role]
    if (role === 'intern' && this.pausePending &&
        (method === 'turn/completed' || method === 'turn/interrupted' || method === 'turn/failed') &&
        params.turn?.id === this.pausePending.turnId) {
      const interrupted = method === 'turn/interrupted' || params.turn?.status === 'interrupted'
      if (interrupted) {
        const pending = this.pausePending
        this.pausePending = null
        clearTimeout(pending.timer)
        try {
          this.workRecords.pauseTask(pending.taskId)
          this.activeInternTaskId = null
          this.pendingInternDispatch = false
          this.activeInternMessageStart = null
          actor.turnId = undefined
          actor.status = 'idle'
          for (const [requestId, request] of this.serverRequests) {
            if (request.taskId !== pending.taskId) continue
            this.serverRequests.delete(requestId)
            this.state.requests = this.state.requests.filter(item => item.id !== requestId)
          }
          if (params.turn?.id) this.completedTurns.add(params.turn.id)
          this.syncWorkRecords()
          this.addActivity('intern', 'pause', 'Boss paused intern task')
          pending.resolve(this.workRecords.getState().tasks.find(item => item.id === pending.taskId))
        } catch (error) { pending.reject(error) }
        return
      }
      const pending = this.pausePending
      this.pausePending = null
      clearTimeout(pending.timer)
      pending.reject(new Error('The intern turn ended before Codex confirmed an interruption'))
      // Continue through the normal completion/failure path so the report is retained.
    }
    if (method === 'item/agentMessage/delta') {
      const id = params.itemId || randomUUID()
      let entry = actor.messages.find(message => message.id === id)
      if (!entry) { entry = { id, role: 'agent', text: '', at: new Date().toISOString() }; actor.messages.push(entry) }
      entry.text = (entry.text + String(params.delta || '')).slice(0, MAX_MESSAGE)
      actor.messages = actor.messages.slice(-100)
      this.emitState()
    } else if (method === 'item/completed') {
      const item = params.item || {}
      if (item.type === 'agentMessage') {
        const text = String(item.text || '').slice(0, MAX_MESSAGE)
        if (params.turnId) this.finalMessageByTurn.set(params.turnId, text)
        let entry = actor.messages.find(message => message.id === item.id)
        if (!entry) { entry = { id: item.id || randomUUID(), role: 'agent', text, at: new Date().toISOString() }; actor.messages.push(entry) }
        else entry.text = text
        actor.messages = actor.messages.slice(-100)
        this.scheduleSave(); this.emitState()
      } else if (item.type === 'commandExecution') this.addActivity(role, 'command', `${item.command || 'Command'} — ${item.status || 'finished'}`)
      else if (item.type === 'fileChange') this.addActivity(role, 'file', 'Files changed')
    } else if (method === 'turn/completed') {
      if (params.turn?.status === 'interrupted' || params.turn?.status === 'failed') {
        this.onNotification('turn/interrupted', params)
        return
      }
      if (actor.turnId && params.turn?.id && actor.turnId !== params.turn.id) return
      if (params.turn?.id && this.completedTurns.has(params.turn.id)) return
      if (params.turn?.id) {
        this.completedTurns.add(params.turn.id)
        if (this.completedTurns.size > 200) this.completedTurns.delete(this.completedTurns.values().next().value)
      }
      actor.turnId = undefined
      const recentInternMessage = role === 'intern' && this.activeInternMessageStart != null
        ? actor.messages.slice(this.activeInternMessageStart).filter(message => message.role === 'agent').at(-1)?.text
        : undefined
      const finalText = this.finalMessageByTurn.get(params.turn?.id) || recentInternMessage || ''
      this.finalMessageByTurn.delete(params.turn?.id)
      actor.status = finalText.trimEnd().endsWith('[BOSS_OFFICE_BLOCKED]') ? 'blocked' : 'idle'
      if (role === 'intern' && this.activeInternTaskId) {
        const taskId = this.activeInternTaskId
        const task = this.workRecords.getState()?.tasks.find(item => item.id === taskId)
        if (task?.status === 'working' && actor.status === 'blocked') {
          const question = finalText.replace(/\[BOSS_OFFICE_BLOCKED\]\s*$/, '').trim()
          this.workRecords.blockTask(taskId, {
            question: question || 'The intern stopped and needs a decision from the boss.',
            evidence: finalText,
          })
        } else if (task?.status === 'working') {
          let filesChanged = []
          try { filesChanged = listProjectChanges(this.state.project).files.map(file => file.path) }
          catch (error) { this.addActivity('intern', 'review', `Could not list changed files: ${error.message}`) }
          this.workRecords.completeTaskTurn(taskId, {
            turnId: params.turn?.id,
            outcome: finalText || 'The intern finished without a final report.',
            filesChanged,
            checks: [], unresolved: [],
          })
        } else if (task?.status === 'blocked') {
          this.interruptActiveRecords()
        }
        for (const [requestId, request] of this.serverRequests) {
          if (request.taskId !== taskId) continue
          this.serverRequests.delete(requestId)
          this.state.requests = this.state.requests.filter(item => item.id !== requestId)
        }
        this.activeInternTaskId = null
        this.pendingInternDispatch = false
        this.activeInternMessageStart = null
        this.syncWorkRecords()
      }
      this.addActivity(role, 'turn', actor.status === 'blocked' ? 'Waiting for boss decision' : 'Turn completed')
      this.scheduleSave()
    } else if (method === 'turn/failed' || method === 'turn/interrupted') {
      if (params.turn?.id) this.completedTurns.add(params.turn.id)
      if (params.turn?.id) this.finalMessageByTurn.delete(params.turn.id)
      actor.turnId = undefined
      actor.status = 'error'
      if (role === 'intern' && this.activeInternTaskId) {
        this.interruptActiveRecords()
        this.activeInternTaskId = null
        this.pendingInternDispatch = false
        this.activeInternMessageStart = null
        this.syncWorkRecords()
      }
      this.addActivity(role, 'error', params.turn?.error?.message || method)
    } else if (method === 'item/started') {
      const item = params.item || {}
      if (item.type === 'commandExecution') this.addActivity(role, 'command', item.command || 'Running command')
      else if (item.type === 'fileChange') this.addActivity(role, 'file', 'Editing files')
    }
  }

  async ensureThread(role, projectRoot) {
    const actor = this.state.roles[role]
    const policy = this.turnPolicy(role)
    const params = { cwd: projectRoot, runtimeWorkspaceRoots: [projectRoot],
      sandbox: policy.sandbox,
      approvalPolicy: policy.approvalPolicy,
      baseInstructions: role === 'lead' ? LEAD_INSTRUCTIONS : INTERN_INSTRUCTIONS }
    if (actor.threadId) {
      await this.rpc('thread/resume', { threadId: actor.threadId, ...params })
      return actor.threadId
    }
    const started = await this.rpc('thread/start', params)
    const id = started?.thread?.id
    if (!id) throw new Error('Codex did not return a thread ID')
    actor.threadId = id
    this.scheduleSave(); this.emitState()
    return id
  }

  turnPolicy(role) {
    if (!this.officeControls) throw new Error(`Office controls could not be loaded: ${this.controlsLoadError?.message || 'unknown error'}`)
    const settings = this.officeControls.settings
    if (role === 'lead') return {
      sandbox: 'read-only', approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: settings.leadNetwork },
    }
    return {
      sandbox: settings.internFileEdits ? 'workspace-write' : 'read-only',
      approvalPolicy: settings.internFileEdits ? 'on-request' : 'never',
      sandboxPolicy: settings.internFileEdits
        ? { type: 'workspaceWrite', writableRoots: [], networkAccess: settings.internNetwork,
          excludeTmpdirEnvVar: false, excludeSlashTmp: false }
        : { type: 'readOnly', networkAccess: settings.internNetwork },
    }
  }

  updateControls(patch) {
    if (!this.officeControls) throw new Error(`Office controls could not be loaded: ${this.controlsLoadError?.message || 'unknown error'}`)
    if (this.state.connection === 'starting' || this.turnStarts.size || this.pausePending || this.state.requests.length || this.pendingInternDispatch ||
      ['lead', 'intern'].some(role => this.state.roles[role].turnId || this.state.roles[role].status === 'working')) {
      throw new Error('Wait for the active agent turn and permission requests to finish before changing office controls')
    }
    const previousReviewer = this.officeControls.settings.approvalReviewer
    this.state.controls = this.officeControls.update(patch)
    this.addActivity('lead', 'controls', `Boss updated office controls: ${Object.keys(patch).join(', ')}`)
    if (previousReviewer !== this.officeControls.settings.approvalReviewer && this.child) {
      const child = this.child
      const closed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Codex did not stop while changing approval mode')), 10000)
        child.once('close', () => { clearTimeout(timer); resolve() })
      })
      this.stop()
      return closed.then(() => this.start()).then(() => this.state.controls)
    }
    if (previousReviewer !== this.officeControls.settings.approvalReviewer && !this.child &&
        ['stopped', 'error'].includes(this.state.connection)) {
      return this.start().then(() => this.state.controls)
    }
    return this.state.controls
  }

  approvePlan(text) {
    if (!this.refreshProject()) throw new Error('Create a website project first')
    if (typeof text === 'string' && this.activeInternTaskId) throw new Error('Wait for the intern turn to finish before changing the plan')
    let version = text
    // Preserve the old IPC call for installed prototypes and bridge tests.
    if (typeof text === 'string') version = this.workRecords.savePlan(sanitizeText(text, 50000)).version
    const result = this.workRecords.approvePlan(version)
    this.syncWorkRecords(); this.scheduleSave(); this.emitState()
    return result
  }

  revokePlanApproval() {
    if (this.activeInternTaskId) throw new Error('Wait for the intern turn to finish before revoking plan approval')
    const result = this.workRecords.revokePlanApproval()
    this.syncWorkRecords(); this.scheduleSave(); this.emitState()
    return result
  }

  savePlan(text) {
    if (this.activeInternTaskId) throw new Error('Wait for the intern turn to finish before changing the plan')
    const result = this.workRecords.savePlan(sanitizeText(text, 50000))
    this.syncWorkRecords(); this.scheduleSave(); this.emitState()
    return result
  }

  addDecision(value) { const result = this.workRecords.addDecision(value); this.syncWorkRecords(); this.emitState(); return result }
  addQuestion(value) { const result = this.workRecords.addQuestion(value); this.syncWorkRecords(); this.emitState(); return result }
  resolveQuestion(id, answer) { const result = this.workRecords.resolveQuestion(id, answer); this.syncWorkRecords(); this.emitState(); return result }
  createTask(value) { const result = this.workRecords.createTask(value); this.syncWorkRecords(); this.emitState(); return result }
  requestRevision(id, value) { const result = this.workRecords.requestRevision(id, value); this.syncWorkRecords(); this.emitState(); return result }
  acceptTask(id) { const result = this.workRecords.acceptTask(id); this.syncWorkRecords(); this.emitState(); return result }
  resumeTask(id) { const result = this.workRecords.resumeTask(id); this.syncWorkRecords(); this.emitState(); return result }

  async pauseTask(id) {
    const task = this.workRecords.getState()?.tasks.find(item => item.id === id)
    if (!task) throw new Error('Task not found')
    if (this.activeInternTaskId === id) {
      if (this.pausePending) throw new Error('Pause is already waiting for Codex to stop')
      const actor = this.state.roles.intern
      if (!actor.turnId || !actor.threadId) throw new Error('The intern turn is starting. Try Pause again when it is running.')
      const turnId = actor.turnId
      const completion = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pausePending?.turnId !== turnId) return
          this.pausePending = null
          reject(new Error('Codex did not confirm interruption; the task is not marked paused'))
        }, 20000)
        this.pausePending = { taskId: id, turnId, resolve, reject, timer }
      })
      completion.catch(() => {})
      try {
        await this.rpc('turn/interrupt', { threadId: actor.threadId, turnId }, 10000)
      } catch (error) {
        if (this.pausePending?.taskId === id) {
          clearTimeout(this.pausePending.timer)
          this.pausePending.reject(error)
          this.pausePending = null
        }
        throw error
      }
      return completion
    }
    if (task.status === 'working') throw new Error('This intern turn is unavailable; restart the app to recover it safely')
    const result = this.workRecords.pauseTask(id)
    this.syncWorkRecords(); this.emitState()
    return result
  }

  answerEscalation(id, answer) {
    const result = this.workRecords.answerEscalation(id, answer)
    this.syncWorkRecords(); this.emitState()
    return result
  }

  async sendMessage(role, text) {
    if (role === 'intern') throw new Error('Create and dispatch an approved task for the intern')
    return this.startTurn(role, text)
  }

  async dispatchTask(taskId) {
    const work = this.workRecords.getState()
    const task = work?.tasks.find(item => item.id === taskId)
    if (!task) throw new Error('Task not found')
    if (task.status !== 'ready') throw new Error('Only a ready task can be dispatched')
    if (work.plan.approvedVersion !== task.planVersion) throw new Error('Approve this task’s plan version before dispatch')
    const answered = work.escalations.filter(item => item.taskId === taskId && item.status === 'answered')
      .map(item => `Question: ${item.question}\nBoss answer: ${item.answer}`).join('\n\n')
    const text = `Task: ${task.title}\nInstructions: ${task.instructions}\nAcceptance criteria: ${task.acceptanceCriteria}` +
      (answered ? `\n\nBoss answers to prior blockers:\n${answered}` : '')
    return this.startTurn('intern', text, taskId)
  }

  async startTurn(role, text, taskId) {
    if (!['lead', 'intern'].includes(role)) throw new Error('Unknown office role')
    const content = sanitizeText(text)
    const project = this.refreshProject()
    if (!project) throw new Error('Create a website project first')
    if (role === 'intern' && (!taskId || !this.state.planApproved || !this.approvedPlan)) throw new Error('Approve a plan and task before assigning intern work')
    const actor = this.state.roles[role]
    if (actor.turnId || actor.status === 'working' || this.turnStarts.has(role) ||
        this.state.requests.some(request => request.role === role)) throw new Error(`${role} is already working or waiting for an answer`)
    const policy = this.turnPolicy(role)
    this.turnStarts.add(role)
    try {
    await this.start()
    const threadId = await this.ensureThread(role, project.projectRoot)
    const input = role === 'intern'
      ? `Approved plan from the boss:\n${this.approvedPlan}\n\nAssigned task / boss message:\n${content}` +
        (this.officeControls.settings.internFileEdits ? '' : '\n\nBoss office control: Website file edits are disabled for this turn. Inspect and report only; do not attempt edits.')
      : content
    if (role === 'intern') this.workRecords.assignTask(taskId)
    const message = { id: randomUUID(), role: 'user', text: content, at: new Date().toISOString() }
    actor.messages.push(message)
    actor.messages = actor.messages.slice(-100)
    actor.status = 'working'
    if (role === 'intern') {
      this.activeInternTaskId = taskId
      this.pendingInternDispatch = true
      this.activeInternMessageStart = actor.messages.length
      this.syncWorkRecords()
    }
    this.scheduleSave(); this.emitState()
    try {
      const result = await this.rpc('turn/start', { threadId, input: [{ type: 'text', text: input }],
        cwd: project.projectRoot, runtimeWorkspaceRoots: [project.projectRoot],
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
      }, 30000)
      if (!result?.turn?.id) throw new Error('Codex did not return a turn ID')
      if (!this.completedTurns.delete(result.turn.id)) actor.turnId = result.turn.id
      if (role === 'intern') {
        const task = this.workRecords.getState()?.tasks.find(item => item.id === taskId)
        if (task?.status === 'working') this.workRecords.attachTurn(taskId, result.turn.id)
        this.pendingInternDispatch = false
        this.syncWorkRecords()
      }
      this.emitState()
      return { turnId: result.turn.id }
    } catch (error) {
      actor.status = 'error'
      if (role === 'intern' && this.activeInternTaskId === taskId) {
        this.interruptActiveRecords()
        this.activeInternTaskId = null
        this.pendingInternDispatch = false
        this.syncWorkRecords()
      }
      this.state.error = error.message
      this.emitState()
      throw error
    }
    } finally { this.turnStarts.delete(role) }
  }

  stop() {
    this.stopping = true
    if (this.usagePoll) { clearInterval(this.usagePoll); this.usagePoll = null }
    if (this.usageRefreshTimer) { clearTimeout(this.usageRefreshTimer); this.usageRefreshTimer = null }
    if (this.pausePending) {
      clearTimeout(this.pausePending.timer)
      this.pausePending.reject(new Error('Office closed before Codex confirmed the pause'))
      this.pausePending = null
    }
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    for (const pending of this.serverRequests.values()) {
      try {
        if (pending.method === 'item/tool/requestUserInput') {
          this.send({ id: pending.rpcId, error: { code: -32000, message: 'Office closed before the boss answered' } })
        } else this.send({ id: pending.rpcId, result: denyApproval(pending.method) })
      } catch {}
    }
    this.serverRequests.clear()
    this.state.requests = []
    this.interruptActiveRecords()
    this.activeInternTaskId = null
    this.pendingInternDispatch = false
    this.activeInternMessageStart = null
    this.syncWorkRecords()
    this.save()
    if (this.child) { this.child.stdin.end(); this.child.kill() }
  }
}

module.exports = { CodexBridge, resolveCodexCommand }
