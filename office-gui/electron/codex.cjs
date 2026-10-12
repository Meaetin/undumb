const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const EventEmitter = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { createTaskRun, taskCommitReady } = require('./git.cjs')

const LEAD_INSTRUCTIONS = `You are the tech lead in Boss Office. The human owns product and engineering decisions. Ask focused clarification questions, then when you have no more questions, say you understand and create a concrete task without asking for a separate approval. Do not edit files yourself. The app provides the project's task Markdown below. If an unfinished task is relevant to a new planning discussion, ask whether to update it or create a new task. When ready to create, put exactly one block at the end of your reply:\n[BOSS_OFFICE_TASK_CREATE]\n# Clear task heading\n\nImplementation instructions for the intern.\n[/BOSS_OFFICE_TASK_CREATE]\nTo update a task after the human chooses update, use [BOSS_OFFICE_TASK_UPDATE id=TASK_UUID] and [/BOSS_OFFICE_TASK_UPDATE] instead. Do not emit a task block until clarifications are resolved. Keep other replies clear and concise.`
const INTERN_INSTRUCTIONS = `You are an intern in Boss Office. You work in the active task workspace. The human owns product and engineering decisions. Follow the attached Markdown task and project conventions. Ask a concrete question when a material requirement is missing. If blocked, end your final reply with [BOSS_OFFICE_BLOCKED]. When the task is finished in a Git worktree, commit only the files you changed, then end the final reply with [BOSS_OFFICE_TASK_DONE]. In a non-Git folder, end with the same marker when finished. Report what you changed, checks run, and unresolved issues. Your conversation belongs only to this project.`

function codexExecutable() {
  if (process.platform !== 'win32') return 'codex'
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe')
    try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
  }
  const base = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin')
  const candidates = []
  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(base, entry.name, 'codex.exe')
      try { candidates.push({ path: candidate, time: fs.statSync(candidate).mtimeMs }) } catch {}
    }
  } catch {}
  candidates.sort((a, b) => b.time - a.time)
  return candidates[0]?.path || 'codex'
}

function describeItem(item, completed = false) {
  const status = item.status ? ` · ${item.status}` : completed ? ' · finished' : ' · running'
  if (item.type === 'commandExecution') {
    const result = [item.exitCode != null ? `exit ${item.exitCode}` : null,
      item.durationMs != null ? `${(item.durationMs / 1000).toFixed(1)}s` : null].filter(Boolean).join(' · ')
    return [item.command || 'Running command', item.cwd ? `in ${item.cwd}` : null,
      completed ? `${result || item.status || 'finished'}` : 'running'].filter(Boolean).join('\n')
  }
  if (item.type === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : []
    return [`${changes.length || 'File'} change${changes.length === 1 ? '' : 's'}${status}`,
      ...changes.map(change => `${change.kind || 'edit'} ${change.path}${change.diff ? `\n${change.diff}` : ''}`)].join('\n')
  }
  if (item.type === 'mcpToolCall') return `${item.server || 'MCP'} · ${item.tool || 'tool'}${status}`
  if (item.type === 'dynamicToolCall') return `${item.namespace ? `${item.namespace} · ` : ''}${item.tool || 'tool'}${status}`
  if (item.type === 'collabAgentToolCall') return `${item.tool || 'Agent tool'}${status}`
  if (item.type === 'webSearch') return `Search: ${item.query || 'web'}${status}`
  if (item.type === 'error') return item.message || 'Codex error'
  return null
}

class CodexSessions extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.connection = 'stopped'
    this.error = null
    this.requests = []
    this.pendingRequests = new Map()
    this.pendingRpc = new Map()
    this.nextRpcId = 1
    this.stdout = ''
    this.child = null
    this.startPromise = null
    this.startingAgents = new Set()
    this.completedTurns = new Set()
    this.stopping = false
    this.pendingTaskNotes = new Map()
    this.idleTimer = setInterval(() => this.closeIdleSessions(), 60000)
    this.idleTimer.unref?.()
  }

  snapshot() { return { connection: this.connection, error: this.error, requests: structuredClone(this.requests), projects: this.store.snapshot().projects } }
  emitState() { this.emit('state', this.snapshot()) }

  async start() {
    if (this.connection === 'ready') return
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start()
    try { await this.startPromise } finally { this.startPromise = null }
  }

  async _start() {
    this.stopping = false
    this.connection = 'starting'
    this.error = null
    this.emitState()
    try {
      fs.mkdirSync(this.store.userDataPath, { recursive: true })
      const child = spawn(codexExecutable(), ['app-server', '--listen', 'stdio://'], {
        cwd: this.store.userDataPath, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => this.onStdout(chunk))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => { this.lastStderr = (this.lastStderr || '').concat(chunk).slice(-2000) })
      child.on('error', error => this.onExit(error))
      child.on('close', code => this.onExit(new Error(`Codex exited (${code}): ${this.lastStderr || 'no diagnostics'}`)))
      await this.rpc('initialize', { clientInfo: { name: 'boss_office_gui', title: 'Boss Office GUI', version: '0.1.0' }, capabilities: { experimentalApi: true } }, 20000)
      this.write({ method: 'initialized', params: {} })
      const account = await this.rpc('account/read', { refreshToken: false }, 20000)
      if (account?.account?.type !== 'chatgpt') throw new Error('Sign in to the Codex CLI with ChatGPT, then reconnect.')
      this.connection = 'ready'
      this.error = null
      this.emitState()
    } catch (error) {
      const child = this.child
      if (child) { this.onExit(error); child.kill() }
      this.connection = 'error'
      this.error = error.code === 'ENOENT' ? 'Codex CLI was not found. Install it and sign in, then reconnect.' : error.message
      this.emitState()
      throw error
    }
  }

  onExit(error) {
    if (!this.child) return
    this.child = null
    for (const pending of this.pendingRpc.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pendingRpc.clear()
    this.pendingRequests.clear()
    this.requests = []
    for (const project of this.store.state.projects) for (const agent of project.agents) for (const session of agent.sessions) {
      if (session.status === 'working' || session.status === 'needs-you') session.status = 'interrupted'
      session.turnId = null
    }
    this.store.save()
    this.connection = this.stopping ? 'stopped' : 'error'
    if (!this.stopping) this.error = [error.message, this.lastStderr?.trim()].filter(Boolean).join('\n')
    this.emitState()
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex is disconnected.')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  rpc(method, params, timeoutMs = 30000) {
    const id = this.nextRpcId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingRpc.delete(id); reject(new Error(`${method} timed out.`)) }, timeoutMs)
      this.pendingRpc.set(id, { resolve, reject, timer, method })
      try { this.write({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pendingRpc.delete(id); reject(error) }
    })
  }

  onStdout(chunk) {
    this.stdout += chunk
    if (this.stdout.length > 4_000_000) { this.child?.kill(); return }
    for (let index; (index = this.stdout.indexOf('\n')) >= 0;) {
      const line = this.stdout.slice(0, index).trim()
      this.stdout = this.stdout.slice(index + 1)
      if (!line) continue
      try { this.onMessage(JSON.parse(line)) } catch {}
    }
  }

  onMessage(message) {
    if (message && 'method' in message) {
      if ('id' in message) this.onRequest(message)
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

  actorForThread(threadId) {
    for (const project of this.store.state.projects) {
      for (const agent of project.agents) {
        const session = agent.sessions.find(item => item.threadId === threadId)
        if (session) return { project, agent, session }
      }
    }
    return null
  }

  onRequest(message) {
    const { id, method, params = {} } = message
    const actor = this.actorForThread(params.threadId)
    const approval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(method)
    const question = method === 'item/tool/requestUserInput'
    if (!actor || (!approval && !question) || (approval && actor.agent.role === 'lead')) {
      this.write(approval
        ? { id, result: method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' } : { decision: 'decline' } }
        : { id, error: { code: -32601, message: 'Unsupported request.' } })
      return
    }
    const requestId = randomUUID()
    const details = [params.reason, params.command, params.cwd, params.grantRoot,
      ...(Array.isArray(params.changes) ? params.changes.map(item => item.path) : [])].filter(Boolean).join('\n').slice(0, 6000)
    const request = { id: requestId, projectId: actor.project.id, agentId: actor.agent.id,
      kind: question ? 'question' : 'approval', method, title: question ? 'Answer needed' : 'Permission needed',
      details, questions: question ? params.questions || [] : [] }
    this.pendingRequests.set(requestId, { rpcId: id, method, agentId: actor.agent.id, sessionId: actor.session.id, questions: params.questions || [], permissions: params.permissions })
    this.requests.push(request)
    actor.session.status = 'needs-you'
    this.store.save()
    this.emitState()
  }

  answerRequest(requestId, response) {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) throw new Error('This request is no longer open.')
    let result
    if (pending.method === 'item/tool/requestUserInput') {
      const answers = {}
      for (const question of pending.questions) {
        const answer = response?.answers?.[question.id]
        if (typeof answer !== 'string' || !answer.trim() || answer.length > 10000) throw new Error('Answer every question before sending.')
        answers[question.id] = { answers: [answer.trim()] }
      }
      result = { answers }
    } else {
      if (!['accept', 'decline'].includes(response?.decision)) throw new Error('Choose allow or decline.')
      result = pending.method === 'item/permissions/requestApproval'
        ? { permissions: response.decision === 'accept' ? pending.permissions : {}, scope: 'turn' }
        : { decision: response.decision }
    }
    this.write({ id: pending.rpcId, result })
    this.pendingRequests.delete(requestId)
    this.requests = this.requests.filter(item => item.id !== requestId)
    for (const project of this.store.state.projects) for (const agent of project.agents) {
      const session = agent.sessions.find(item => item.id === pending.sessionId)
      if (session) { session.status = 'working'; this.store.addActivity(session, 'decision', 'You answered a Codex request.'); break }
    }
    this.emitState()
  }

  onNotification(method, params) {
    if (method === 'serverRequest/resolved') {
      for (const [requestId, pending] of this.pendingRequests) {
        if (pending.rpcId !== params.requestId) continue
        this.pendingRequests.delete(requestId)
        this.requests = this.requests.filter(item => item.id !== requestId)
        for (const project of this.store.state.projects) for (const agent of project.agents) {
          const session = agent.sessions.find(item => item.id === pending.sessionId)
          if (session?.status === 'needs-you' && session.turnId) session.status = 'working'
        }
        this.store.save(); this.emitState()
        break
      }
      return
    }
    const actor = this.actorForThread(params.threadId)
    if (!actor) return
    const { project, agent, session } = actor
    if (method === 'item/agentMessage/delta') {
      const id = params.itemId || randomUUID()
      let message = session.messages.find(item => item.id === id)
      if (!message) { message = { id, role: 'agent', text: '', images: [], at: new Date().toISOString() }; session.messages.push(message) }
      message.text += String(params.delta || '')
      this.store.updateActivity(session, 'message', message.text, id)
      session.updatedAt = new Date().toISOString()
      this.store.save(); this.emitState()
    } else if (method === 'item/completed') {
      const item = params.item || {}
      if (item.type === 'agentMessage') {
        let message = session.messages.find(entry => entry.id === item.id)
        if (!message) { message = { id: item.id || randomUUID(), role: 'agent', text: '', images: [], at: new Date().toISOString() }; session.messages.push(message) }
        message.text = String(item.text || '')
        this.store.updateActivity(session, 'message', message.text, item.id)
        session.updatedAt = new Date().toISOString()
        this.store.save(); this.emitState()
      } else if (item.type === 'reasoning') {
        const summaries = Array.isArray(item.summary) ? item.summary.filter(Boolean).join('\n') : ''
        if (summaries) this.store.updateActivity(session, 'reasoning', summaries, item.id)
        this.emitState()
      } else {
        const kind = item.type === 'commandExecution' ? 'command' : item.type === 'fileChange' ? 'file' : item.type === 'error' ? 'error' : 'tool'
        const description = describeItem(item, true)
        if (description) this.store.updateActivity(session, kind, description, item.id)
        if (item.type === 'commandExecution' && item.aggregatedOutput && !session.activity.some(entry => entry.kind === 'output' && entry.itemId === item.id))
          this.store.addActivity(session, 'output', item.aggregatedOutput, item.id)
        if (description) this.emitState()
      }
    } else if (method === 'item/commandExecution/outputDelta') {
      this.store.addActivity(session, 'output', params.delta || '', params.itemId)
      this.emitState()
    } else if (method === 'item/reasoning/summaryTextDelta') {
      this.store.updateActivity(session, 'reasoning', params.delta || '', params.itemId, true)
      this.emitState()
    } else if (method === 'turn/plan/updated') {
      const steps = Array.isArray(params.plan) ? params.plan.map(step => `${step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '→' : '○'} ${step.step}`).join('\n') : ''
      if (steps) this.store.updateActivity(session, 'plan', [params.explanation, steps].filter(Boolean).join('\n'), params.turnId)
      this.emitState()
    } else if (method === 'item/started') {
      const item = params.item || {}
      const kind = item.type === 'commandExecution' ? 'command' : item.type === 'fileChange' ? 'file' : item.type === 'error' ? 'error' : 'tool'
      const description = describeItem(item)
      if (!description) return
      this.store.updateActivity(session, kind, description, item.id)
      this.emitState()
    } else if (method === 'turn/completed' || method === 'turn/interrupted' || method === 'turn/failed') {
      const turnId = params.turn?.id
      if (turnId && this.completedTurns.has(turnId)) return
      if (turnId) { this.completedTurns.add(turnId); if (this.completedTurns.size > 300) this.completedTurns.delete(this.completedTurns.values().next().value) }
      for (const [requestId, pending] of this.pendingRequests) {
        if (pending.sessionId !== session.id) continue
        this.pendingRequests.delete(requestId)
        this.requests = this.requests.filter(item => item.id !== requestId)
      }
      session.turnId = null
      const last = session.messages.filter(item => item.role === 'agent').at(-1)
      if (method !== 'turn/completed' || params.turn?.status === 'failed' || params.turn?.status === 'interrupted') session.status = 'interrupted'
      else session.status = last?.text.trimEnd().endsWith('[BOSS_OFFICE_BLOCKED]') ? 'needs-you' : 'available'
      if (last && session.status !== 'interrupted') {
        if (session.status === 'needs-you') last.text = last.text.replace(/\[BOSS_OFFICE_BLOCKED\]\s*$/, '').trimEnd()
        else this.processAgentResult(project, agent, session, last)
      }
      this.store.addActivity(session, 'turn', session.status === 'available' ? 'Turn completed' : session.status === 'needs-you' ? 'Waiting for your decision' : 'Turn interrupted')
      const note = this.pendingTaskNotes.get(session.id)
      if (note && session.status !== 'working') {
        this.pendingTaskNotes.delete(session.id)
        queueMicrotask(() => this.sendMessage(project.id, agent.id, session.id, note).catch(error => this.store.addActivity(session, 'error', error.message)))
      }
      this.emitState()
    }
  }

  processAgentResult(project, agent, session, last) {
    if (agent.role === 'lead') {
      const create = last.text.match(/\[BOSS_OFFICE_TASK_CREATE\]\s*([\s\S]*?)\s*\[\/BOSS_OFFICE_TASK_CREATE\]/)
      const update = last.text.match(/\[BOSS_OFFICE_TASK_UPDATE id=([0-9a-f-]{36})\]\s*([\s\S]*?)\s*\[\/BOSS_OFFICE_TASK_UPDATE\]/i)
      if (create || update) {
        try {
          const task = create ? this.store.createTask(project.id, create[1]) : this.store.updateTask(project.id, update[1], update[2])
          last.text = last.text.replace(create?.[0] || update[0], `Task ${create ? 'created' : 'updated'}: ${task.title}`).trim()
          if (update) this.notifyTaskUpdated(project, task)
        } catch (error) {
          last.text += `\n\nTask file could not be saved: ${error.message}`
          this.store.addActivity(session, 'error', error.message)
        }
      }
    } else if (last.text.trimEnd().endsWith('[BOSS_OFFICE_TASK_DONE]') && session.taskId) {
      last.text = last.text.replace(/\[BOSS_OFFICE_TASK_DONE\]\s*$/, '').trimEnd()
      const task = project.tasks.find(item => item.id === session.taskId)
      const run = task?.runs.find(item => item.id === task.currentRunId)
      if (task && task.assignedAgentId === agent.id && taskCommitReady(run)) this.store.completeTask(project.id, task.id)
      else last.text += '\n\nTask remains ongoing: commit your task changes before marking it done.'
    }
    this.store.save()
  }

  notifyTaskUpdated(project, task) {
    if (!task.assignedAgentId || task.status === 'done') return
    const agent = project.agents.find(item => item.id === task.assignedAgentId)
    const session = agent?.sessions.find(item => item.taskId === task.id && item.turnId) ||
      agent?.sessions.find(item => item.id === agent.activeSessionId && item.taskId === task.id) ||
      agent?.sessions.find(item => item.taskId === task.id)
    if (!agent || !session) return
    const note = `The tech lead updated your assigned task (${task.title}). Reread this Markdown, assess whether your completed work is affected, and align the remaining work to it:\n\n${fs.readFileSync(this.store.taskPath(project, task.id), 'utf8')}`
    if (session.turnId && session.threadId) {
      this.rpc('turn/steer', { threadId: session.threadId, expectedTurnId: session.turnId,
        input: [{ type: 'text', text: note }] }).then(() => {
        this.store.addMessage(session, 'user', note, [], task.id); this.emitState()
      }).catch(() => this.pendingTaskNotes.set(session.id, note))
    } else this.sendMessage(project.id, agent.id, session.id, note).catch(error => this.store.addActivity(session, 'error', error.message))
  }

  async ensureThread(project, agent, session) {
    const cwd = session.workspacePath || project.root
    const gitMetadata = session.workspacePath && session.workspacePath !== project.root ? path.join(project.root, '.git') : null
    const params = { cwd, runtimeWorkspaceRoots: gitMetadata ? [cwd, gitMetadata] : [cwd],
      sandbox: agent.role === 'lead' ? 'read-only' : 'workspace-write',
      approvalPolicy: agent.role === 'lead' ? 'never' : 'on-request',
      baseInstructions: agent.role === 'lead' ? LEAD_INSTRUCTIONS : INTERN_INSTRUCTIONS }
    if (session.threadId) {
      await this.rpc('thread/resume', { threadId: session.threadId, ...params })
      return session.threadId
    }
    const started = await this.rpc('thread/start', params)
    const id = started?.thread?.id
    if (!id) throw new Error('Codex did not create a thread.')
    session.threadId = id
    this.store.save(); this.emitState()
    return id
  }

  async sendMessage(projectId, agentId, sessionId, rawText, images = [], taskId = null, baseTaskId = null, files = []) {
    const { project, agent, session } = this.store.getSession(projectId, agentId, sessionId)
    if (session.locked) throw new Error('This past chat is read-only because its task was removed. Start a new chat to work again.')
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if ((!text && images.length === 0 && files.length === 0 && !taskId) || text.length > 30000) throw new Error('Write a message of at most 30,000 characters, or attach a task or file.')
    if (session.status === 'working' || session.turnId || this.startingAgents.has(agent.id) ||
      agent.sessions.some(other => other.id !== session.id && (other.turnId || other.status === 'working')) ||
      this.requests.some(item => item.agentId === agent.id)) throw new Error('This employee is working or needs your answer.')
    this.startingAgents.add(agent.id)
    try {
      if (agent.role === 'intern') {
        let selected = taskId ? project.tasks.find(item => item.id === taskId) : null
        if (taskId && !selected) throw new Error('Selected task was not found.')
        if (!selected && !session.taskId && (text || images.length || files.length)) {
          const title = text.split(/[\r\n.!?]/)[0].slice(0, 60).trim() || 'File assignment'
          selected = this.store.createTask(projectId, `# ${title}\n\n${text || 'Complete the task described by the attached file.'}`)
        }
        if (!selected && session.taskId) selected = project.tasks.find(item => item.id === session.taskId)
        if (selected) {
          if (session.taskId && session.taskId !== selected.id) {
            const prior = project.tasks.find(item => item.id === session.taskId)
            if (prior?.status !== 'done') throw new Error('Finish or remove the current task before attaching another.')
          }
          if (selected.assignedAgentId && selected.assignedAgentId !== agent.id) throw new Error('This task belongs to another intern. Remove its assignment first.')
          let run = selected.runs.find(item => item.id === selected.currentRunId)
          if (!selected.assignedAgentId) {
            run = createTaskRun(this.store, project, selected, agent.id, baseTaskId)
            this.store.assignTask(projectId, selected.id, agent.id, run)
          }
          session.taskId = selected.id
          session.workspacePath = run.workspacePath
          this.store.save(); this.emitState()
        }
      }
      await this.start()
      const threadId = await this.ensureThread(project, agent, session)
      const input = []
      if (agent.role === 'lead') {
        const inventory = project.tasks.map(task => `ID: ${task.id}\nStatus: ${task.status}\n${fs.readFileSync(this.store.taskPath(project, task.id), 'utf8')}`).join('\n---\n')
        input.push({ type: 'text', text: `Project task Markdown files (${project.plansPath}):\n${inventory || '(none yet)'}\n\nHuman message:\n${text}` })
      } else if (session.taskId) {
        input.push({ type: 'text', text: `Assigned task Markdown:\n${fs.readFileSync(this.store.taskPath(project, session.taskId), 'utf8')}\n\nHuman message:\n${text}` })
      } else if (text) input.push({ type: 'text', text })
      for (const image of images) input.push({ type: 'localImage', path: image.path })
      if (files.length) input.push({ type: 'text', text: `Attached files stored by Boss Office:\n${files.map(item => `${item.name}: ${item.path}`).join('\n')}\nRead these files as needed for the task.` })
      const visibleText = text + (files.length ? `\n\nAttached files: ${files.map(item => item.name).join(', ')}` : '')
      this.store.addMessage(session, 'user', visibleText.trim(), images.map(item => item.name), session.taskId, files.map(item => item.name))
      session.status = 'working'
      this.store.save(); this.emitState()
      const cwd = session.workspacePath || project.root
      const gitMetadata = session.workspacePath && session.workspacePath !== project.root ? path.join(project.root, '.git') : null
      const result = await this.rpc('turn/start', { threadId, input, cwd,
        runtimeWorkspaceRoots: gitMetadata ? [cwd, gitMetadata] : [cwd], approvalPolicy: agent.role === 'lead' ? 'never' : 'on-request',
        sandboxPolicy: agent.role === 'lead'
          ? { type: 'readOnly', networkAccess: true }
          : { type: 'workspaceWrite', writableRoots: gitMetadata ? [gitMetadata] : [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
      }, 30000)
      if (!result?.turn?.id) throw new Error('Codex did not start the turn.')
      if (!this.completedTurns.delete(result.turn.id)) session.turnId = result.turn.id
      this.store.save(); this.emitState()
      return { turnId: result.turn.id }
    } catch (error) {
      if (session.status === 'working') session.status = 'interrupted'
      this.store.addActivity(session, 'error', error.message)
      this.emitState()
      throw error
    } finally { this.startingAgents.delete(agent.id) }
  }

  async interrupt(projectId, agentId, sessionId) {
    const { session } = this.store.getSession(projectId, agentId, sessionId)
    if (!session.turnId || !session.threadId) throw new Error('No running turn to stop.')
    await this.rpc('turn/interrupt', { threadId: session.threadId, turnId: session.turnId }, 10000)
  }

  async compact(projectId, agentId, sessionId) {
    const { project, agent, session } = this.store.getSession(projectId, agentId, sessionId)
    if (session.turnId || session.status === 'working' || agent.sessions.some(other => other.id !== session.id && (other.turnId || other.status === 'working'))) {
      throw new Error('Stop or finish the current work before compacting.')
    }
    if (!session.threadId) throw new Error('This chat has no context to compact yet.')
    await this.start()
    await this.ensureThread(project, agent, session)
    session.status = 'working'
    this.store.save(); this.emitState()
    try { await this.rpc('thread/compact/start', { threadId: session.threadId }) }
    catch (error) { session.status = 'interrupted'; this.store.save(); this.emitState(); throw error }
  }

  closeIdleSessions() {
    const cutoff = Date.now() - 10 * 60 * 1000
    let changed = false
    let allIdle = true
    for (const project of this.store.state.projects) for (const agent of project.agents) for (const session of agent.sessions) {
      if (session.turnId || session.status === 'working' || session.status === 'needs-you') { allIdle = false; continue }
      if (Date.parse(session.updatedAt || session.createdAt) > cutoff) { allIdle = false; continue }
      if (session.status !== 'closed') {
        session.status = 'closed'; changed = true
        if (this.connection === 'ready' && session.threadId) this.rpc('thread/unsubscribe', { threadId: session.threadId }).catch(() => {})
      }
    }
    if (changed) { this.store.save(); this.emitState() }
    if (allIdle && this.child) this.stop()
  }

  stop() {
    this.stopping = true
    for (const pending of this.pendingRequests.values()) {
      try { this.write({ id: pending.rpcId, error: { code: -32000, message: 'Office closed.' } }) } catch {}
    }
    this.child?.kill()
  }
}

module.exports = { CodexSessions }
