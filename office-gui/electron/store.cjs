const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const STARTER_FILES = ['.gitignore', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'src/App.tsx', 'src/main.tsx', 'src/style.css']
const now = () => new Date().toISOString()

function readableName(value) {
  if (typeof value !== 'string') throw new Error('Enter a name.')
  const name = value.trim()
  if (!name || name.length > 60 || /[\u0000-\u001f]/u.test(name)) throw new Error('Use a name of 1–60 readable characters.')
  return name
}

function taskParts(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 100000) throw new Error('Task Markdown is too long.')
  const match = markdown.trim().match(/^#\s+([^\r\n]+)\r?\n+([\s\S]+)$/)
  if (!match || !match[2].trim()) throw new Error('A task needs a # heading and an implementation body.')
  const title = readableName(match[1])
  return { title, markdown: `# ${title}\n\n${match[2].trim()}\n` }
}

function makeSession(title = 'New chat', taskId = null, workspacePath = null) {
  const at = now()
  return { id: randomUUID(), title, threadId: null, turnId: null, status: 'available', taskId,
    workspacePath, messages: [], activity: [], createdAt: at, updatedAt: at }
}

class OfficeStore {
  constructor({ userDataPath, templateRoot = path.join(__dirname, '../project-starter') }) {
    if (!path.isAbsolute(userDataPath)) throw new Error('User data path must be absolute.')
    this.userDataPath = userDataPath
    this.templateRoot = templateRoot
    this.statePath = path.join(userDataPath, 'gui-workspace.json')
    this.projectsRoot = path.join(userDataPath, 'projects')
    this.projectDataRoot = path.join(userDataPath, 'project-data')
    this.worktreesRoot = path.join(userDataPath, 'task-worktrees')
    this.state = { version: 2, projects: [] }
    if (fs.existsSync(this.statePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
        if (![1, 2].includes(saved?.version) || !Array.isArray(saved.projects)) throw new Error('Unsupported workspace data.')
        this.state = saved
        this.state.version = 2
        for (const project of this.state.projects) {
          if (typeof project.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(project.id) || !Array.isArray(project.agents)) throw new Error('Invalid saved project.')
          project.root = path.join(this.projectsRoot, project.id)
          project.plansPath = path.join(this.projectDataRoot, project.id, 'plans')
          if (!fs.statSync(project.root).isDirectory()) throw new Error(`Project folder is missing: ${project.name}`)
          fs.mkdirSync(project.plansPath, { recursive: true })
          project.tasks ||= []
          for (const agent of project.agents) {
            if (!Array.isArray(agent.sessions)) {
              const session = makeSession(agent.messages?.[0]?.text?.slice(0, 50) || 'Previous chat')
              session.threadId = agent.threadId || null
              session.status = ['working', 'needs-you'].includes(agent.status) ? 'interrupted' : agent.status || 'available'
              session.messages = agent.messages || []
              session.activity = agent.activity || []
              agent.sessions = [session]
              agent.activeSessionId = session.id
              delete agent.threadId; delete agent.turnId; delete agent.messages; delete agent.activity
            }
            for (const session of agent.sessions) {
              if (['working', 'needs-you'].includes(session.status)) session.status = 'interrupted'
              session.turnId = null
              session.messages ||= []
              session.activity ||= []
              session.updatedAt ||= session.createdAt || now()
            }
            agent.activeSessionId ||= agent.sessions[0]?.id
          }
        }
      } catch (error) { throw new Error(`Could not load GUI workspace: ${error.message}`) }
    }
  }

  snapshot() {
    const state = structuredClone(this.state)
    for (const project of state.projects) for (const task of project.tasks) {
      try { task.markdown = fs.readFileSync(this.taskPath(project, task.id), 'utf8') }
      catch { task.markdown = '# Missing task file\n\nThe Markdown file could not be read.\n' }
    }
    return state
  }

  save() {
    fs.mkdirSync(this.userDataPath, { recursive: true })
    const temp = `${this.statePath}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    fs.renameSync(temp, this.statePath)
  }

  getProject(id) {
    const project = this.state.projects.find(item => item.id === id)
    if (!project) throw new Error('Project not found.')
    return project
  }

  getAgent(projectId, agentId) {
    const project = this.getProject(projectId)
    const agent = project.agents.find(item => item.id === agentId)
    if (!agent) throw new Error('Employee not found in this project.')
    return { project, agent }
  }

  getSession(projectId, agentId, sessionId) {
    const { project, agent } = this.getAgent(projectId, agentId)
    const session = agent.sessions.find(item => item.id === sessionId)
    if (!session) throw new Error('Chat not found for this employee.')
    return { project, agent, session }
  }

  createProject(rawName) {
    const name = readableName(rawName)
    const id = randomUUID()
    const root = path.join(this.projectsRoot, id)
    const plansPath = path.join(this.projectDataRoot, id, 'plans')
    fs.mkdirSync(root, { recursive: true })
    try {
      for (const relative of STARTER_FILES) {
        const target = path.join(root, relative)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.copyFileSync(path.join(this.templateRoot, relative), target)
      }
      fs.mkdirSync(plansPath, { recursive: true })
      const first = makeSession()
      const project = { id, name, root, plansPath, createdAt: now(), tasks: [],
        agents: [{ id: randomUUID(), name: 'Tech Lead', role: 'lead', activeSessionId: first.id, sessions: [first] }] }
      this.state.projects.push(project)
      this.save()
      return structuredClone(project)
    } catch (error) {
      this.state.projects = this.state.projects.filter(item => item.id !== id)
      const safeRoot = path.resolve(root)
      if (!safeRoot.startsWith(path.resolve(this.projectsRoot) + path.sep)) throw new Error('Refusing to remove a project folder outside the app project directory.')
      fs.rmSync(safeRoot, { recursive: true, force: true })
      throw error
    }
  }

  hireIntern(projectId, rawName) {
    const project = this.getProject(projectId)
    const first = makeSession()
    const agent = { id: randomUUID(), name: readableName(rawName), role: 'intern', activeSessionId: first.id, sessions: [first] }
    project.agents.push(agent)
    this.save()
    return structuredClone(agent)
  }

  createSession(projectId, agentId, { carryTask = false } = {}) {
    const { project, agent } = this.getAgent(projectId, agentId)
    const prior = agent.sessions.find(item => item.id === agent.activeSessionId)
    if (prior?.turnId || prior?.status === 'working') throw new Error('Stop or finish the current work before starting another chat.')
    if (carryTask && prior?.locked) throw new Error('This task was removed. Start a new chat instead.')
    if (!carryTask && agent.role === 'intern' && project.tasks.some(task => task.assignedAgentId === agent.id && task.status !== 'done')) {
      throw new Error('Finish or remove the ongoing task before starting unrelated work. Use Clear context to keep its files.')
    }
    const session = makeSession(carryTask ? 'Fresh context' : 'New chat', carryTask ? prior?.taskId || null : null,
      carryTask ? prior?.workspacePath || null : null)
    agent.sessions.unshift(session)
    agent.activeSessionId = session.id
    this.save()
    return structuredClone(session)
  }

  selectSession(projectId, agentId, sessionId) {
    const { agent, session } = this.getSession(projectId, agentId, sessionId)
    agent.activeSessionId = session.id
    this.save()
    return structuredClone(session)
  }

  taskPath(project, taskId) {
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error('Invalid task ID.')
    return path.join(project.plansPath, `${taskId}.md`)
  }

  createTask(projectId, markdown) {
    const project = this.getProject(projectId)
    const { title, markdown: clean } = taskParts(markdown)
    const id = randomUUID()
    fs.mkdirSync(project.plansPath, { recursive: true })
    fs.writeFileSync(this.taskPath(project, id), clean, { flag: 'wx', mode: 0o600 })
    const task = { id, title, status: 'open', assignedAgentId: null, currentRunId: null,
      baseRef: null, runs: [], createdAt: now(), updatedAt: now() }
    project.tasks.push(task)
    this.save()
    return { ...structuredClone(task), markdown: clean }
  }

  updateTask(projectId, taskId, markdown) {
    const project = this.getProject(projectId)
    const task = project.tasks.find(item => item.id === taskId)
    if (!task) throw new Error('Task not found.')
    const { title, markdown: clean } = taskParts(markdown)
    const target = this.taskPath(project, taskId)
    const temp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temp, clean, { mode: 0o600 })
    fs.renameSync(temp, target)
    task.title = title
    task.updatedAt = now()
    this.save()
    return { ...structuredClone(task), markdown: clean }
  }

  task(projectId, taskId) {
    const project = this.getProject(projectId)
    const task = project.tasks.find(item => item.id === taskId)
    if (!task) throw new Error('Task not found.')
    return { project, task }
  }

  assignTask(projectId, taskId, agentId, run) {
    const { task } = this.task(projectId, taskId)
    const { agent } = this.getAgent(projectId, agentId)
    if (agent.role !== 'intern') throw new Error('Only interns can take tasks.')
    if (task.assignedAgentId && task.assignedAgentId !== agentId) throw new Error('This task belongs to another intern. Remove that assignment first.')
    if (task.status === 'done') throw new Error('This task is complete. Start a new task.')
    if (!task.assignedAgentId) {
      task.assignedAgentId = agentId
      task.currentRunId = run.id
      task.baseRef ||= run.baseRef || null
      task.runs.push(run)
    }
    task.status = 'assigned'
    task.updatedAt = now()
    this.save()
    return structuredClone(task)
  }

  unassignTask(projectId, taskId) {
    const { project, task } = this.task(projectId, taskId)
    if (project.agents.some(agent => agent.sessions.some(session => session.taskId === taskId && session.turnId))) {
      throw new Error('Stop the intern before removing this task.')
    }
    for (const agent of project.agents) for (const session of agent.sessions) {
      if (session.taskId === taskId) session.locked = true
    }
    task.assignedAgentId = null
    task.currentRunId = null
    if (task.status !== 'done') task.status = 'open'
    task.updatedAt = now()
    this.save()
    return structuredClone(task)
  }

  completeTask(projectId, taskId) {
    const { task } = this.task(projectId, taskId)
    task.status = 'done'
    task.updatedAt = now()
    this.save()
  }

  addMessage(session, role, text, images = [], taskId = null, files = []) {
    const message = { id: randomUUID(), role, text: String(text).slice(0, 30000), images, files, taskId, at: now() }
    session.messages.push(message)
    session.updatedAt = message.at
    if (session.title === 'New chat' && role === 'user' && text.trim()) session.title = text.trim().slice(0, 54)
    this.save()
    return message
  }

  addActivity(session, kind, summary, itemId) {
    const text = String(summary)
    const last = session.activity.at(-1)
    if (kind === 'output' && last?.kind === 'output' && last.itemId === itemId && last.summary.length < 100000) last.summary += text
    else session.activity.push({ id: randomUUID(), kind, summary: text, itemId, at: now() })
    session.updatedAt = now()
    this.save()
  }

  updateActivity(session, kind, summary, itemId, append = false) {
    const entry = itemId && [...session.activity].reverse().find(item => item.kind === kind && item.itemId === itemId)
    if (!entry) return this.addActivity(session, kind, summary, itemId)
    entry.summary = append ? entry.summary + String(summary) : String(summary)
    session.updatedAt = now()
    this.save()
  }
}

module.exports = { OfficeStore, taskParts }
