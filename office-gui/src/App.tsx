import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Activity, Agent, ChatSession, GitStatus, OfficeRequest, OfficeState, PickedFile, PickedImage, Project, Task } from './officeApi'

const initial: OfficeState = { connection: 'stopped', error: null, requests: [], projects: [] }
const statusText: Record<string, string> = { available: 'Available', working: 'Working', 'needs-you': 'Needs you', interrupted: 'Interrupted', closed: 'Closed' }
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function RequestCard({ request, act, busy }: { request: OfficeRequest; act: (response: { decision: 'accept' | 'decline' } | { answers: Record<string, string> }) => void; busy: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return <section className="request-card" aria-label={request.title}>
    <div className="request-heading"><strong>{request.title}</strong><span>{request.kind === 'approval' ? 'Codex permission' : 'Agent question'}</span></div>
    {request.details && <pre>{request.details}</pre>}
    {request.kind === 'question' ? <>
      {request.questions.map(question => <label className="field" key={question.id}><span>{question.question}</span><textarea rows={2} value={answers[question.id] || ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} /></label>)}
      <button disabled={busy || request.questions.some(question => !answers[question.id]?.trim())} onClick={() => act({ answers })}>Send answer</button>
    </> : <div className="request-actions"><button disabled={busy} onClick={() => act({ decision: 'decline' })}>Decline</button><button disabled={busy} onClick={() => act({ decision: 'accept' })}>Allow</button></div>}
  </section>
}

function ActivityLog({ activity }: { activity: Activity[] }) {
  const labels: Record<string, string> = { command: 'Command', output: 'Output', file: 'Files', reasoning: 'Reasoning summary', plan: 'Plan', message: 'Agent update', tool: 'Tool', turn: 'Turn', error: 'Error', decision: 'Decision' }
  return <div className="terminal-log">{activity.map(item => {
    const long = item.kind === 'output' || (item.kind === 'file' && item.summary.length > 600)
    const lines = item.summary.split('\n')
    return <article className={`activity-entry activity-${item.kind}`} key={item.id}>
      <div className="activity-heading"><strong>{labels[item.kind] || item.kind}</strong><time>{time(item.at)}</time></div>
      {long ? <details><summary>{item.kind === 'output' ? `${lines.length} lines of command output` : lines[0]}</summary><pre>{item.summary}</pre></details> : <pre>{item.summary}</pre>}
    </article>
  })}</div>
}

export function App() {
  const [state, setState] = useState<OfficeState>(initial)
  const [projectId, setProjectId] = useState<string | null>(localStorage.getItem('gui-project'))
  const [agentId, setAgentId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [view, setView] = useState<'chats' | 'whiteboard' | 'office'>('chats')
  const [inspector, setInspector] = useState<'chat' | 'terminal'>('chat')
  const [wideInspector, setWideInspector] = useState(false)
  const [modal, setModal] = useState<'project' | 'hire' | null>(null)
  const [newName, setNewName] = useState('')
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<PickedImage[]>([])
  const [files, setFiles] = useState<PickedFile[]>([])
  const [attachedTaskId, setAttachedTaskId] = useState<string | null>(null)
  const [baseTaskId, setBaseTaskId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [gitState, setGitState] = useState<GitStatus | null>(null)
  const [gitAlert, setGitAlert] = useState(false)
  const [reassignTaskId, setReassignTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const api = window.officeApi
    if (!api) { setError('Open this app in Electron to connect to projects and agents.'); return }
    const unsubscribe = api.subscribe(setState)
    api.getState().then(setState).catch(reason => setError(String(reason.message || reason)))
    return unsubscribe
  }, [])

  const project: Project | undefined = state.projects.find(item => item.id === projectId) || state.projects[0]
  const agent: Agent | undefined = project?.agents.find(item => item.id === agentId) || project?.agents[0]
  const session: ChatSession | undefined = agent?.sessions.find(item => item.id === sessionId) || agent?.sessions.find(item => item.id === agent.activeSessionId) || agent?.sessions[0]
  const selectedTask: Task | undefined = project?.tasks.find(item => item.id === selectedTaskId) || project?.tasks[0]
  const activeTask = project?.tasks.find(item => item.id === session?.taskId)
  const requests = state.requests.filter(item => item.projectId === project?.id && item.agentId === agent?.id)
  const doneBranches = project?.tasks.filter(item => item.status === 'done' && item.runs.some(run => run.branch)) || []

  useEffect(() => { if (project) localStorage.setItem('gui-project', project.id) }, [project?.id])
  useEffect(() => {
    if (!project || !window.officeApi) return
    setGitState(null)
    window.officeApi.gitStatus(project.id).then(setGitState).catch(reason => setError(String(reason.message || reason)))
  }, [project?.id])
  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: 'end' }) }, [session?.id, session?.messages.length, view])

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await action(); return true }
    catch (reason) { setError(String((reason as Error).message || reason)); return false }
    finally { setBusy(false) }
  }

  function clearComposer() { setDraft(''); setImages([]); setFiles([]); setAttachedTaskId(null); setBaseTaskId(null) }
  function selectProject(next: Project) {
    setProjectId(next.id); setAgentId(next.agents[0]?.id || null); setSessionId(next.agents[0]?.activeSessionId || null)
    setSelectedTaskId(null); clearComposer()
  }
  function selectAgent(next: Agent) { setAgentId(next.id); setSessionId(next.activeSessionId); clearComposer() }

  async function selectSession(next: ChatSession) {
    if (!project || !agent) return
    setSessionId(next.id); clearComposer()
    await run(() => window.officeApi!.selectSession(project.id, agent.id, next.id))
  }

  async function createSession(carryTask: boolean) {
    if (!project || !agent) return
    let created: ChatSession | null = null
    if (await run(async () => { created = await window.officeApi!.createSession(project.id, agent.id, carryTask) })) {
      setSessionId((created as ChatSession | null)?.id || null); clearComposer(); setView('chats')
    }
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault()
    if (!window.officeApi) return
    if (modal === 'project') {
      let created: Project | null = null
      if (await run(async () => { created = await window.officeApi!.createProject(newName) })) {
        setProjectId((created as Project | null)?.id || null); setAgentId(null); setSessionId(null); setModal(null); setNewName(''); setView('chats')
      }
    } else if (modal === 'hire' && project) {
      let hired: Agent | null = null
      if (await run(async () => { hired = await window.officeApi!.hireIntern(project.id, newName) })) {
        setAgentId((hired as Agent | null)?.id || null); setSessionId((hired as Agent | null)?.activeSessionId || null)
        setModal(null); setNewName(''); setView('chats')
      }
    }
  }

  async function deliver() {
    if (!window.officeApi || !project || !agent || !session) return
    const ok = await run(() => window.officeApi!.sendMessage(project.id, agent.id, session.id, draft, images.map(item => item.id), files.map(item => item.id), attachedTaskId, baseTaskId))
    if (ok) clearComposer()
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!project || !agent || !session || (!draft.trim() && images.length === 0 && files.length === 0 && !attachedTaskId)) return
    const attached = project.tasks.find(item => item.id === attachedTaskId)
    if (attached?.assignedAgentId && attached.assignedAgentId !== agent.id) { setReassignTaskId(attached.id); return }
    if (agent.role === 'intern' && gitState && !gitState.hasCommit && localStorage.getItem(`gui-nogit-${project.id}`) !== 'yes') {
      setGitAlert(true); return
    }
    await deliver()
  }

  async function removeTask(taskId: string) {
    if (!project || !agent) return
    if (await run(() => window.officeApi!.unassignTask(project.id, taskId))) {
      setAttachedTaskId(null)
      if (session?.taskId === taskId) await createSession(false)
    }
  }

  const canSend = Boolean(agent && session && session.status !== 'working' && !session.locked &&
    !agent.sessions.some(other => other.id !== session.id && (other.turnId || other.status === 'working')) && requests.length === 0 && !busy)
  const currentStatus = session?.status || 'available'

  return <div className="app">
    <aside className="sidebar" aria-label="Projects, employees, and chats">
      <div className="brand">Boss Office <small>Projects and team</small></div>
      <div className="side-section"><div className="section-head"><span>Projects</span><button aria-label="Create project" onClick={() => { setModal('project'); setNewName('') }}>+</button></div>
        <nav className="nav-list" aria-label="Projects">{state.projects.map(item => <button key={item.id} className={`nav-item ${item.id === project?.id ? 'active' : ''}`} onClick={() => selectProject(item)}><span>{item.name}</span><small>{item.agents.length}</small></button>)}</nav>
        {!state.projects.length && <p className="sidebar-empty">Create a project to start.</p>}
      </div>
      {project && <div className="side-section"><div className="section-head"><span>Employees</span><button aria-label="Hire intern" onClick={() => { setModal('hire'); setNewName(`Intern ${project.agents.filter(item => item.role === 'intern').length + 1}`) }}>+</button></div>
        <nav className="nav-list" aria-label="Employees">{project.agents.map(item => {
          const current = item.sessions.find(chat => chat.id === item.activeSessionId) || item.sessions[0]
          return <button key={item.id} className={`nav-item ${item.id === agent?.id ? 'active' : ''}`} onClick={() => selectAgent(item)}><span>{item.name}</span><small>{current?.status === 'needs-you' ? '!' : statusText[current?.status || 'available']}</small></button>
        })}</nav>
      </div>}
      {agent && <div className="side-section recent-section"><div className="section-head"><span>Recent chats</span><button aria-label="Start new chat" title="Start new chat" onClick={() => void createSession(false)}>+</button></div>
        <nav className="nav-list" aria-label="Recent chats">{agent.sessions.map(chat => <button key={chat.id} className={`nav-item session-link ${chat.id === session?.id ? 'active' : ''}`} onClick={() => void selectSession(chat)}><span>{chat.title}</span><small>{chat.status === 'closed' ? 'Closed' : time(chat.updatedAt)}</small></button>)}</nav>
      </div>}
      <div className="sidebar-foot"><span className={`connection ${state.connection}`}></span>Codex: {state.connection}{state.connection === 'error' && <button onClick={() => void run(() => window.officeApi!.reconnect())}>Reconnect</button>}</div>
    </aside>

    <main className="main">
      <header className="topbar"><div><div className="crumb">Projects / {project?.name || 'None selected'}</div><h1>{project?.name || 'Your workspace'}</h1></div><div className="tabs" role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={view === 'chats'} onClick={() => setView('chats')}>Chats</button><button role="tab" aria-selected={view === 'whiteboard'} onClick={() => setView('whiteboard')}>Whiteboard</button><button role="tab" aria-selected={view === 'office'} onClick={() => setView('office')}>Office</button></div></header>
      {(error || state.error) && <div className="error-banner" role="alert">{error || state.error}{error && <button aria-label="Dismiss error" onClick={() => setError('')}>×</button>}</div>}
      {!project ? <div className="empty-screen"><h2>Create your first project</h2><p>Each project gets a folder, tech lead, and interns.</p><button onClick={() => { setModal('project'); setNewName('') }}>+ Create project</button></div> : view === 'whiteboard' ?
        <div className="whiteboard-view"><div className="task-list"><div className="panel-heading"><h2>Tasks</h2><span>{project.tasks.length}</span></div>{project.tasks.length ? project.tasks.map(task => <button key={task.id} className={`task-row ${task.id === selectedTask?.id ? 'active' : ''}`} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{task.status === 'assigned' ? `Assigned to ${project.agents.find(item => item.id === task.assignedAgentId)?.name || 'intern'}` : task.status}</span></button>) : <p className="muted">Tasks from the tech lead will appear here.</p>}</div>
          <div className="task-detail">{selectedTask ? <><div className="panel-heading"><div><h2>{selectedTask.title}</h2><p className="muted">{selectedTask.status === 'assigned' ? `Assigned to ${project.agents.find(item => item.id === selectedTask.assignedAgentId)?.name || 'intern'}` : selectedTask.status}</p></div>{selectedTask.status === 'assigned' && <button disabled={busy} onClick={() => void removeTask(selectedTask.id)}>Remove assignment</button>}</div><pre className="task-markdown">{selectedTask.markdown}</pre>{selectedTask.runs.length > 0 && <div className="task-history"><h3>Workspaces</h3>{selectedTask.runs.map(run => <p key={run.id}>{run.branch || 'Shared folder'} · {project.agents.find(item => item.id === run.agentId)?.name || 'Intern'}<small>{run.workspacePath}</small></p>)}</div>}</> : <p className="muted">Select a task to read its instructions.</p>}</div></div> : view === 'chats' ?
        <div className="chat-view"><div className="chat-main"><div className="chat-header"><div><strong>{agent?.name}</strong><span>{agent?.role === 'lead' ? 'Tech lead' : 'Intern'} · {statusText[currentStatus]} · {session?.title}</span></div><div className="header-actions">{session?.turnId && <button disabled={busy} onClick={() => void run(() => window.officeApi!.interrupt(project.id, agent!.id, session.id))}>Stop</button>}<button disabled={busy || !session?.threadId || session?.status === 'working'} onClick={() => void run(() => window.officeApi!.compact(project.id, agent!.id, session!.id))}>Compact</button><button disabled={busy || session?.status === 'working'} onClick={() => void createSession(true)}>Clear context</button><button onClick={() => setView('office')}>View in office</button></div></div>
          {activeTask && <div className="task-banner"><span>Ongoing task: <button className="text-button" onClick={() => { setSelectedTaskId(activeTask.id); setView('whiteboard') }}>{activeTask.title}</button> · {activeTask.status}</span>{activeTask.status !== 'done' && !session?.locked && <button disabled={busy} onClick={() => void removeTask(activeTask.id)}>Remove task</button>}</div>}
          <div className="messages">{!session?.messages.length && <div className="welcome"><h2>Chat with {agent?.name}</h2><p>{agent?.role === 'lead' ? 'Discuss the project. The tech lead creates task files when the plan is clear.' : 'Attach a task, add context or images, and press Send to start work.'}</p></div>}{session?.messages.map(message => <article key={message.id} className={`message ${message.role === 'user' ? 'mine' : ''}`}><div className="message-head"><strong>{message.role === 'user' ? 'You' : agent?.name}</strong><time>{time(message.at)}</time></div><p>{message.text}</p>{message.taskId && <div className="message-attachments"><span>Task: {project.tasks.find(item => item.id === message.taskId)?.title || 'Past task'}</span></div>}{message.images?.length > 0 && <div className="message-attachments">{message.images.map((name, index) => <span key={`${name}-${index}`}>▧ {name}</span>)}</div>}</article>)}{session?.status === 'working' && <div className="working-line">{agent?.name} is working…</div>}{requests.map(request => <RequestCard key={request.id} request={request} busy={busy} act={response => void run(() => window.officeApi!.answerRequest(request.id, response))} />)}<div ref={messagesEnd} /></div>
          <form className="composer" onSubmit={event => void send(event)}>
            <div className="composer-box">
              {agent?.role === 'intern' && <div className="task-picker"><label htmlFor="attach-task">Attach task</label><select id="attach-task" value={attachedTaskId || ''} disabled={!canSend || Boolean(activeTask && activeTask.status !== 'done')} onChange={event => { setAttachedTaskId(event.target.value || null); setBaseTaskId(null) }}><option value="">{activeTask ? 'Current task stays attached' : 'No saved task'}</option>{project.tasks.filter(item => item.status !== 'done').map(task => <option key={task.id} value={task.id}>{task.title}{task.assignedAgentId ? ` · ${project.agents.find(item => item.id === task.assignedAgentId)?.name}` : ''}</option>)}</select>{attachedTaskId && doneBranches.length > 0 && <><label htmlFor="base-task">Start from</label><select id="base-task" value={baseTaskId || ''} disabled={!canSend} onChange={event => setBaseTaskId(event.target.value || null)}><option value="">Project's current branch</option>{doneBranches.map(task => <option value={task.id} key={task.id}>{task.title}</option>)}</select></>}</div>}
              {(images.length > 0 || files.length > 0) && <div className="picked-images">{images.map(item => <div key={item.id} className="picked-image"><img src={item.dataUrl} alt="" /><span>{item.name}</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setImages(current => current.filter(image => image.id !== item.id))}>×</button></div>)}{files.map(item => <div key={item.id} className="picked-image"><span>▤ {item.name}</span><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setFiles(current => current.filter(file => file.id !== item.id))}>×</button></div>)}</div>}
              <textarea aria-label={`Message ${agent?.name}`} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Write a message or attach a task…" rows={3} disabled={!canSend} />
              <div className="composer-actions"><button type="button" disabled={!canSend || images.length >= 4} onClick={() => void run(async () => { const selected = await window.officeApi!.pickImages(); setImages(current => [...current, ...selected].slice(0, 4)) })}>+ Add images</button><button type="button" disabled={!canSend || files.length >= 4} onClick={() => void run(async () => { const selected = await window.officeApi!.pickFiles(); setFiles(current => [...current, ...selected].slice(0, 4)) })}>+ Add files</button><span>Ctrl + Enter to send</span><button type="submit" disabled={!canSend || (!draft.trim() && images.length === 0 && files.length === 0 && !attachedTaskId)}>Send ↗</button></div>
            </div>
          </form>
        </div><aside className="context-panel" aria-label="Project context"><section><h2>Project context</h2><div className="info-row"><span>Folder</span><strong>Local workspace</strong></div><div className="info-row"><span>Employees</span><strong>{project.agents.length}</strong></div><div className="info-row"><span>Tasks</span><strong>{project.tasks.length}</strong></div></section><section><h2>Current work</h2>{activeTask ? <><p>{activeTask.title}</p><p className="path">{session?.workspacePath || project.root}</p></> : <p className="muted">No task in this chat.</p>}</section><section><h2>Project folder</h2><p className="path">{project.root}</p><button onClick={() => void run(() => window.officeApi!.openProjectFolder(project.id))}>Open folder</button></section></aside></div> :
        <div className={`office-view ${wideInspector ? "wide-inspector" : ""}`}><div className="office-floor"><div className="office-intro"><div><h2>Office</h2><p>Choose an employee to inspect their chat and coding activity.</p></div><button onClick={() => { setModal('hire'); setNewName(`Intern ${project.agents.filter(item => item.role === 'intern').length + 1}`) }}>+ Hire intern</button></div><div className="office-grid">{project.agents.map(item => {
          const current = item.sessions.find(chat => chat.id === item.activeSessionId) || item.sessions[0]
          return <button className={`person ${item.id === agent?.id ? 'selected' : ''}`} key={item.id} onClick={() => selectAgent(item)}><span className="avatar">{item.role === 'lead' ? 'TL' : item.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span><span className="person-name">{item.name}</span><span className="person-role">{item.role === 'lead' ? 'Tech lead' : 'Intern'}</span><span className="status-pill">{statusText[current?.status || 'available']}</span></button>
        })}</div></div><aside className="inspector" aria-label="Selected employee"><div className="inspector-head"><strong>{agent?.name}</strong><span>{agent?.role === 'lead' ? 'Tech lead' : 'Intern'} · {statusText[currentStatus]}</span></div><div className="inspector-tabs"><button className={inspector === 'chat' ? 'active' : ''} onClick={() => setInspector('chat')}>Chat</button><button className={inspector === 'terminal' ? 'active' : ''} onClick={() => setInspector('terminal')}>Work log</button></div><div className="inspector-body">{inspector === 'chat' ? session?.messages.length ? session.messages.map(message => <div className="mini-message" key={message.id}><strong>{message.role === 'user' ? 'You' : agent?.name}</strong><p>{message.text || message.images?.join(', ')}</p></div>) : <p className="muted">No messages yet.</p> : session?.activity.length ? <ActivityLog activity={session.activity} /> : <p className="muted">No work activity yet. Progress and command output appear here.</p>}</div><div className="inspector-foot"><button onClick={() => setWideInspector(value => !value)}>{wideInspector ? "Narrow view" : "Expand work log"}</button><button onClick={() => setView('chats')}>Open full chat →</button></div></aside></div>}
    </main>

    {modal && <div className="modal-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null) }}><form className="modal" onSubmit={event => void submitNew(event)} aria-label={modal === 'project' ? 'Create project' : 'Hire intern'}><h2>{modal === 'project' ? 'Create project' : 'Hire intern'}</h2><p>{modal === 'project' ? 'Create a project folder and tech lead chat.' : `Add an independent intern to ${project?.name}.`}</p><label htmlFor="new-name">{modal === 'project' ? 'Project name' : 'Intern name'}</label><input id="new-name" autoFocus required maxLength={60} value={newName} onChange={event => setNewName(event.target.value)} /><div className="modal-actions"><button type="button" onClick={() => setModal(null)}>Cancel</button><button type="submit" disabled={busy || !newName.trim()}>{modal === 'project' ? 'Create project' : 'Hire intern'}</button></div></form></div>}
    {gitAlert && project && <div className="modal-layer"><div className="modal" role="alertdialog" aria-modal="true" aria-label="Git is not ready"><h2>Git is not ready</h2><p>This project has no Git branch to isolate tasks. You can initialize Git and make an initial snapshot, or let interns work directly in the shared project folder.</p><div className="modal-actions"><button disabled={busy} onClick={() => { localStorage.setItem(`gui-nogit-${project.id}`, 'yes'); setGitAlert(false); void deliver() }}>Use shared folder</button><button disabled={busy} onClick={() => void run(async () => { const next = await window.officeApi!.initializeGit(project.id); setGitState(next); setGitAlert(false); await window.officeApi!.sendMessage(project.id, agent!.id, session!.id, draft, images.map(item => item.id), files.map(item => item.id), attachedTaskId, baseTaskId); clearComposer() })}>Initialize Git & send</button></div></div></div>}
    {reassignTaskId && project && <div className="modal-layer"><div className="modal" role="alertdialog" aria-modal="true" aria-label="Reassign task"><h2>Task already assigned</h2><p>{project.tasks.find(item => item.id === reassignTaskId)?.title} is assigned to {project.agents.find(item => item.id === project.tasks.find(task => task.id === reassignTaskId)?.assignedAgentId)?.name}. Remove that assignment and start fresh here? The earlier chat and workspace stay available as history.{!gitState?.hasCommit && ' Without Git, the code files remain shared.'}</p><div className="modal-actions"><button onClick={() => setReassignTaskId(null)}>Cancel</button><button disabled={busy} onClick={() => void run(async () => { await window.officeApi!.unassignTask(project.id, reassignTaskId); setReassignTaskId(null); if (gitState && !gitState.hasCommit && localStorage.getItem(`gui-nogit-${project.id}`) !== 'yes') setGitAlert(true); else await deliver() })}>Remove and start fresh</button></div></div></div>}
  </div>
}
