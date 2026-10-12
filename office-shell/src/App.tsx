import { useEffect, useRef, useState } from 'react'
import { Area, AREAS, OfficeScene } from './OfficeScene'
import { PreviewPane } from './PreviewPane'
import type { OfficeControlSettings, OfficeControls, OfficeState, Project, Role, TaskRecord, UsageState, WorkRecords } from './officeApi'

type Draft = { project: string; goal: string; plan: string; choice: string; reason: string; question: string; questionContext: string; taskTitle: string; task: string; criteria: string; revision: string }
const empty: Draft = { project: '', goal: '', plan: '', choice: '', reason: '', question: '', questionContext: '', taskTitle: '', task: '', criteria: '', revision: '' }
const labels: Record<Area | 'preview', string> = { boss: "Boss's desk", meeting: 'Meeting area', intern: 'Intern desk', board: 'Project board', preview: 'Website preview' }
const initialOffice: OfficeState = { connection: 'starting', project: null, planApproved: false, roles: { lead: { status: 'idle', messages: [] }, intern: { status: 'idle', messages: [] } }, requests: [], activity: [] }
const currentPlan = (records?: WorkRecords | null) => records?.plan.versions.at(-1)
const approvedPlan = (records?: WorkRecords | null) => records?.plan.versions.find(version => version.version === records.plan.approvedVersion)
const currentTask = (records?: WorkRecords | null) => records?.tasks.slice().reverse().find(task => task.status !== 'accepted')
const contextText = (draft: Draft, records?: WorkRecords | null) => `Project: ${draft.project.trim()}\nGoal: ${draft.goal.trim()}\nCurrent plan draft: ${draft.plan.trim() || currentPlan(records)?.text || '(not yet drafted)'}\nApproved plan version: ${approvedPlan(records)?.version ?? '(none)'}\nBoss decisions: ${records?.decisions.map(item => `${item.choice} — ${item.reason}`).join('; ') || '(none recorded)'}`

function loadDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem('boss-office-shell-draft') || '{}') as Partial<Draft>
    const draft = Object.fromEntries(Object.keys(empty).map(key => [key, typeof saved[key as keyof Draft] === 'string' ? saved[key as keyof Draft] : ''])) as Draft
    // Keep older notes visible for projects created before work records existed.
    if (!draft.choice && typeof (saved as Record<string, unknown>).decisions === 'string') draft.choice = (saved as Record<string, string>).decisions
    if (!draft.question && typeof (saved as Record<string, unknown>).questions === 'string') draft.question = (saved as Record<string, string>).questions
    return draft
  } catch { return empty }
}
function timeLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }

function RequestCard({ request, busy, resolve }: { request: OfficeState['requests'][number]; busy: boolean; resolve: (id: string, response: { decision: 'accept' | 'decline' } | { answers: Record<string, { answers: string[] }> }) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const questions = request.questions || []
  return <article className="request-card">
    <span className="eyebrow">{request.kind === 'approval' ? 'PERMISSION REQUEST' : 'DECISION NEEDED'}</span>
    <h3>{request.title}</h3>
    {request.kind === 'approval' && request.context ? <div className="request-context">
      {request.context.reason && <p>{request.context.reason}</p>}
      {request.context.command && <div><strong>Command</strong><pre>{request.context.command}</pre></div>}
      {request.context.cwd && <div><strong>Working directory</strong><code>{request.context.cwd}</code></div>}
      {request.context.host && <div><strong>Network host</strong><code>{request.context.host}{request.context.port ? `:${request.context.port}` : ''}</code></div>}
      {request.context.protocol && <div><strong>Protocol</strong><code>{request.context.protocol}</code></div>}
      {request.context.grantRoot && <div><strong>Requested file access</strong><code>{request.context.grantRoot}</code></div>}
      {request.context.files?.length ? <div><strong>Files</strong><ul>{request.context.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></div> : null}
      {request.context.permissions && <div><strong>Requested permissions</strong><pre>{JSON.stringify(request.context.permissions, null, 2)}</pre></div>}
      {request.context.additionalPermissions && <div><strong>Additional permissions</strong><pre>{JSON.stringify(request.context.additionalPermissions, null, 2)}</pre></div>}
    </div> : request.details && <p>{request.details}</p>}
    {request.kind === 'approval' ? <div className="request-actions">
      <button className="secondary-button" disabled={busy} onClick={() => resolve(request.id, { decision: 'decline' })}>Decline</button>
      <button className="primary-button" disabled={busy} onClick={() => resolve(request.id, { decision: 'accept' })}>Allow this request</button>
    </div> : <>
      {questions.map(question => <fieldset className="question-set" key={question.id}>
        <legend>{question.header || question.question}</legend>{question.header && <p>{question.question}</p>}
        {question.options?.map(option => <label className="option" key={option.label}><input type="radio" name={`${request.id}-${question.id}`} checked={answers[question.id] === option.label} onChange={() => setAnswers(current => ({ ...current, [question.id]: option.label }))} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>)}
        <textarea aria-label={`Answer: ${question.question}`} value={answers[question.id] || ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))} placeholder="Your answer" rows={2} />
      </fieldset>)}
      {questions.length === 0 && <p>The agent requested input without a readable question. Review its activity before responding.</p>}
      <button className="primary-button" disabled={busy || questions.length === 0 || questions.some(q => !answers[q.id]?.trim())} onClick={() => resolve(request.id, { answers: Object.fromEntries(questions.map(q => [q.id, { answers: [answers[q.id].trim()] }])) })}>Send answer</button>
    </>}
  </article>
}

function OfficeControlsPanel({ controls, disabledReason, update }: { controls?: OfficeControls; disabledReason: string; update: (patch: Partial<OfficeControlSettings>) => void }) {
  const rows: Array<{ key: 'internFileEdits' | 'terminalCommands'; title: string; description: string }> = [
    { key: 'internFileEdits', title: 'Intern website edits', description: 'Allow the intern to edit files in this website project. Off uses a read-only Codex sandbox for the next turn.' },
    { key: 'terminalCommands', title: 'Intern terminal commands', description: 'Command blocking is unavailable until Codex exposes an enforceable command policy.' },
  ]
  return <section className="office-controls" aria-label="Agent controls">
    <div className="controls-heading"><div><span className="eyebrow">AGENT ACCESS</span><h3>Office controls</h3></div><span className="control-timing">Saved changes apply to the next agent turn</span></div>
    <p className="control-intro">Website edit changes apply to the next Codex turn. With edits off, the intern uses a read-only sandbox and approvals are disabled.</p>
    {controls?.settings && <label className="control-row reviewer-row">
      <span className="control-copy"><strong>Permission review</strong><small>Auto-review asks Codex's separate reviewer to decide eligible tool permission requests. Your plan approvals and the intern's questions still come to you. If review denies an action, the intern may still need your guidance.</small></span>
      <select aria-label="Permission review" value={controls.settings.approvalReviewer} disabled={Boolean(disabledReason || controls.error || !controls.capabilities.approvalReviewer)} onChange={event => update({ approvalReviewer: event.target.value as OfficeControlSettings['approvalReviewer'] })}>
        <option value="user">Ask me</option><option value="auto_review">Approve for me</option>
      </select>
    </label>}
    <div className="control-info"><strong>Internet access</strong><p>Tech lead command internet: {controls?.settings ? controls.settings.leadNetwork ? 'on' : 'off' : 'unknown'} · Intern command internet: {controls?.settings ? controls.settings.internNetwork ? 'on' : 'off' : 'unknown'}. Hosted web research remains available. Internet restrictions are not shown as office controls in this MVP.</p></div>
    {!controls && <p className="interrupt-note">Controls are unavailable. Restart the desktop app to load the updated bridge.</p>}
    {controls?.error && <p className="interrupt-note" role="alert">Controls could not be loaded: {controls.error}</p>}
    {controls?.settings && <div className="control-list">{rows.map(row => {
      const supported = controls.capabilities[row.key]
      const disabled = Boolean(disabledReason || !supported || controls.error)
      return <label className={`control-row ${!supported ? 'unsupported' : ''}`} key={row.key}>
        <span className="control-copy"><strong>{row.title}</strong><small>{row.description}</small>{!supported && <em>Unavailable in this MVP</em>}</span>
        <span className="control-action"><span>{controls.settings![row.key] ? 'On' : 'Off'}</span><input type="checkbox" checked={controls.settings![row.key]} disabled={disabled} onChange={event => update({ [row.key]: event.target.checked })} aria-label={row.title} /></span>
      </label>
    })}</div>}
    {disabledReason && controls && <p className="control-lock" role="status">{disabledReason}</p>}
    <div className="read-scope"><strong>File read scope</strong><p>Agents start in the website project, but this Windows sandbox can still read outside it. A project-only read profile was refused by Codex on this machine, so the privacy switch is unavailable.</p></div>
  </section>
}

function UsagePanel({ usage, refresh, disabled }: { usage?: UsageState; refresh: () => void; disabled: boolean }) {
  const number = (value: number) => new Intl.NumberFormat().format(value)
  return <section className="usage-panel" aria-label="Codex usage">
    <div className="usage-heading"><div><span className="eyebrow">ACCOUNT ACTIVITY</span><h3>Codex usage</h3></div><button className="secondary-button" disabled={disabled || usage?.status === 'loading'} onClick={refresh}>Refresh</button></div>
    <p className="usage-intro">Shared Codex account data, including work outside this office. A warning appears when any reported limit window reaches {usage?.thresholdPercent ?? 80}% used. This is not a spending cap.</p>
    {usage?.status === 'loading' && <p className="usage-note">Updating account usage…</p>}
    {(!usage || usage.status === 'unavailable') && <p className="usage-note">Usage unavailable{usage?.rateError ? `: ${usage.rateError}` : '.'}</p>}
    {usage?.status === 'ready' && <>
      {usage.warnings.length > 0 && <div className="usage-warning"><strong>Usage warning</strong><p>{usage.warnings.map(item => `${item.name} ${item.kind}${item.usedPercent === null ? ' limit reached' : ` ${item.usedPercent}% used`}`).join(' · ')}</p></div>}
      {usage.buckets.length ? <div className="usage-buckets">{usage.buckets.map(bucket => <article key={bucket.id}><strong>{bucket.name}</strong>{bucket.windows.map(window => <div className="usage-window" key={window.kind}><span>{window.kind === 'primary' ? 'Primary' : 'Secondary'} window{window.windowDurationMins !== null ? ` · ${window.windowDurationMins} min` : ''}</span><b>{window.usedPercent}% used</b>{window.resetsAt !== null && <small>Resets {new Date(window.resetsAt * 1000).toLocaleString()}</small>}</div>)}{bucket.reached && <small>Limit reached</small>}</article>)}</div> : <p className="usage-note">No rate-limit windows were returned.</p>}
      {usage.tokenActivity && <div className="usage-tokens"><strong>Token activity</strong>{usage.tokenActivity.lifetimeTokens !== null && <span>Lifetime: {number(usage.tokenActivity.lifetimeTokens)} tokens</span>}{usage.tokenActivity.latestDay && <span>{usage.tokenActivity.latestDay.date}: {number(usage.tokenActivity.latestDay.tokens)} tokens</span>}</div>}
      {usage.rateError && <p className="usage-note">Rate limits: {usage.rateError}</p>}{usage.tokenError && <p className="usage-note">Token activity: {usage.tokenError}</p>}
      {usage.fetchedAt && <small className="usage-fetched">Updated {new Date(usage.fetchedAt).toLocaleString()}</small>}
    </>}
  </section>
}

function Conversation({ role, office, busy, canSend, send, resolve }: { role: Role; office: OfficeState; busy: boolean; canSend: boolean; send: (role: Role, text: string) => Promise<boolean>; resolve: (id: string, response: { decision: 'accept' | 'decline' } | { answers: Record<string, { answers: string[] }> }) => void }) {
  const [message, setMessage] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const session = office.roles[role]
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }) }, [session.messages.length])
  const waitingForRequest = office.requests.some(request => request.role === role)
  const submit = async () => { const value = message.trim(); if (value && canSend && !busy && !waitingForRequest && office.connection === 'ready' && session.status !== 'working' && await send(role, value)) setMessage('') }
  return <section className="conversation" aria-label={role === 'lead' ? 'Tech lead conversation' : 'Intern conversation'}>
    <div className="conversation-title"><strong>{role === 'lead' ? 'Tech lead' : 'Intern'}</strong><span className={`agent-state ${session.status}`}>{session.status}</span></div>
    <div className="messages" aria-live="polite">
      {session.messages.length === 0 && <p className="empty-message">{role === 'lead' ? 'Ask the tech lead to challenge your plan or research options.' : 'The intern conversation appears after you assign work.'}</p>}
      {session.messages.map(item => <article className={`message ${item.role}`} key={item.id}><div><strong>{item.role === 'user' ? 'You' : role === 'lead' ? 'Tech lead' : 'Intern'}</strong><time>{timeLabel(item.at)}</time></div><p>{item.text}</p></article>)}
      <div ref={bottom} />
    </div>
    {office.requests.filter(request => request.role === role).map(request => <RequestCard key={request.id} request={request} busy={busy || office.connection !== 'ready'} resolve={resolve} />)}
    {role === 'lead' ? <><label className="composer"><span>Your message to the tech lead</span><textarea rows={3} value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit() } }} placeholder="What decision should we examine?" /></label><div className="composer-actions"><small>Ctrl + Enter to send</small><button className="primary-button" disabled={busy || !canSend || waitingForRequest || office.connection !== 'ready' || session.status === 'working' || !message.trim()} onClick={() => void submit()}>Send message</button></div></> : <p className="review-note" style={{ padding: '0 17px 15px' }}>Use the task actions above to assign work, answer a blocker, or request a revision.</p>}
  </section>
}

export function App() {
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [office, setOffice] = useState<OfficeState>(initialOffice)
  const [project, setProject] = useState<Project | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [bridgeMissing, setBridgeMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<Area | 'preview' | null>(null)
  const [nearby, setNearby] = useState<Area | null>(null)
  const [locked, setLocked] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const roamRef = useRef<HTMLButtonElement>(null)
  const records = office.workRecords
  const latestPlan = currentPlan(records)
  const approvalVersion = records?.plan.approvedVersion
  const approved = Boolean(project && latestPlan && approvalVersion === latestPlan.version && office.planApproved && draft.plan.trim() === latestPlan.text)
  const selectedTask = records?.tasks.find(task => task.id === selectedTaskId) || currentTask(records)
  const liveInternTurn = office.roles.intern.status === 'working' || office.requests.some(request => request.role === 'intern')
  const controlsLocked = office.requests.length > 0 || Object.values(office.roles).some(role => Boolean(role.turnId) || role.status === 'working')
  const controlsDisabledReason = controlsLocked ? 'Finish the active agent turn or answer the pending request before changing controls.' : busy || office.connection === 'starting' ? 'Finish the current office action before changing controls.' : bridgeMissing ? 'Open the desktop app to change controls.' : ''
  const online = office.connection === 'ready' && !bridgeMissing
  const localReady = Boolean(!bridgeMissing && project && records)
  const livePauseNeedsConnection = selectedTask?.status === 'working' || (selectedTask?.status === 'blocked' && liveInternTurn)
  const canPauseTask = Boolean(selectedTask && ['ready', 'working', 'blocked'].includes(selectedTask.status) && (!livePauseNeedsConnection || online))

  useEffect(() => { localStorage.setItem('boss-office-shell-draft', JSON.stringify(draft)) }, [draft])
  useEffect(() => {
    const api = window.officeApi
    if (!api) { setBridgeMissing(true); return }
    let mounted = true
    void Promise.all([api.getState(), api.getProject()]).then(([state, active]) => {
      if (!mounted) return
      setOffice(state)
      setProject(active)
      if (active) {
        const [name, ...goalParts] = active.metadata.idea.split('\n\n')
        setDraft(current => ({ ...current, project: name, goal: goalParts.join('\n\n'), plan: currentPlan(state.workRecords)?.text || state.approvedPlanText || current.plan }))
      }
    }).catch(cause => { if (mounted) setError(String(cause)) })
    const unsubscribe = api.subscribe(state => { if (mounted) setOffice(state) })
    return () => { mounted = false; unsubscribe() }
  }, [])
  useEffect(() => { if (panel) closeRef.current?.focus() }, [panel])
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel) { setPanel(null); roamRef.current?.focus() } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [panel])

  const act = async (callback: () => Promise<unknown>): Promise<boolean> => { setError(''); setBusy(true); try { await callback(); return true } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false } finally { setBusy(false) } }
  const change = (key: keyof Draft, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const open = (area: Area | 'preview') => { if (document.pointerLockElement) document.exitPointerLock(); setPanel(area); setError('') }
  const close = () => { setPanel(null); roamRef.current?.focus() }
  const field = (key: keyof Draft, label: string, rows = 3, hint?: string) => <label className="field" htmlFor={key} key={key}><span>{label}</span><textarea id={key} rows={rows} value={draft[key]} onChange={event => change(key, event.target.value)} placeholder={hint} disabled={Boolean(project && (key === 'project' || key === 'goal'))} /></label>
  const send = async (role: Role, text: string): Promise<boolean> => {
    const api = window.officeApi
    if (!api) { setError('Agent bridge unavailable. Launch the desktop app.'); return false }
    if (role === 'intern') { setError('Use the task actions to direct the intern. This keeps every turn tied to a task.'); return false }
    const context = `Current project context (boss decides):\n${contextText(draft, records)}\nOpen questions: ${records?.questions.filter(item => item.status === 'open').map(item => item.question).join('; ') || '(none)'}`
    return act(() => api.sendMessage(role, `${context}\n\nBoss message: ${text}`))
  }
  const resolve = (id: string, response: { decision: 'accept' | 'decline' } | { answers: Record<string, { answers: string[] }> }) => { const api = window.officeApi; if (api) void act(() => api.resolveRequest(id, response)) }
  const updateControls = (patch: Partial<OfficeControlSettings>) => { const api = window.officeApi; if (api) void act(() => api.updateControls(patch)) }
  const refreshUsage = () => { const api = window.officeApi; if (api) void act(() => api.refreshUsage()) }
  const savePlan = async () => { const api = window.officeApi; if (api && project && draft.plan.trim() && draft.plan.trim() !== latestPlan?.text) await act(() => api.savePlan(draft.plan.trim())) }
  const approve = async () => { const api = window.officeApi; if (api && project && latestPlan && draft.plan.trim() === latestPlan.text) await act(() => api.approvePlan(latestPlan.version)) }
  const addDecision = async () => { const api = window.officeApi; if (api && draft.choice.trim() && draft.reason.trim() && await act(() => api.addDecision({ choice: draft.choice.trim(), reason: draft.reason.trim() }))) setDraft(current => ({ ...current, choice: '', reason: '' })) }
  const addQuestion = async () => { const api = window.officeApi; if (api && draft.question.trim() && await act(() => api.addQuestion({ question: draft.question.trim(), context: draft.questionContext.trim() || undefined }))) setDraft(current => ({ ...current, question: '', questionContext: '' })) }
  const resolveQuestion = async (id: string) => { const api = window.officeApi; const answer = answers[id]?.trim(); if (api && answer && await act(() => api.resolveQuestion(id, answer))) setAnswers(current => ({ ...current, [id]: '' })) }
  const createProject = async () => { const api = window.officeApi; if (api && draft.project.trim() && draft.goal.trim()) { let created: Project | null = null; if (await act(async () => { created = await api.createProject(`${draft.project.trim()}\n\n${draft.goal.trim()}`) })) setProject(created) } }
  const createTask = async () => { const api = window.officeApi; if (api && approved && draft.taskTitle.trim() && draft.task.trim() && draft.criteria.trim()) { let task: TaskRecord | undefined; if (await act(async () => { task = await api.createTask({ title: draft.taskTitle.trim(), instructions: draft.task.trim(), acceptanceCriteria: draft.criteria.trim() }) })) { setSelectedTaskId(task?.id || ''); setDraft(current => ({ ...current, taskTitle: '', task: '', criteria: '' })) } } }
  const taskAction = async (action: 'dispatchTask' | 'pauseTask' | 'resumeTask' | 'acceptTask', taskId: string) => { const api = window.officeApi; if (api) await act(() => api[action](taskId)) }
  const answerEscalation = async (id: string) => { const api = window.officeApi; const answer = answers[id]?.trim(); if (api && answer && await act(() => api.answerEscalation(id, answer))) setAnswers(current => ({ ...current, [id]: '' })) }
  const requestRevision = async (taskId: string) => { const api = window.officeApi; const task = records?.tasks.find(item => item.id === taskId); if (api && task && draft.revision.trim() && await act(() => api.requestRevision(taskId, { instructions: `${task.instructions}\n\nBoss revision request:\n${draft.revision.trim()}` }))) setDraft(current => ({ ...current, revision: '' })) }

  return <main className="app">
    <header className="topbar"><div className="brand"><span className="brand-mark">B</span><div><strong>The Boss's Office</strong><small>One project · local Codex</small></div></div><div className="top-status"><span className={`status-dot ${online ? 'online' : ''}`} /> {bridgeMissing ? 'Desktop bridge unavailable' : `Agents ${office.connection}`} <span className="divider" /> {office.requests.length ? `${office.requests.length} request${office.requests.length === 1 ? '' : 's'} need you` : office.usage?.warnings.length ? 'Codex usage warning · boss desk' : 'One active project'}</div></header>
    <div className="workspace">
      <section className="scene-wrap" aria-label="3D office"><OfficeScene panelOpen={panel !== null} onOpen={open} onNearby={setNearby} onLocked={setLocked} /><div className="scene-vignette" aria-hidden="true" />{locked && !panel && <div className="crosshair" aria-hidden="true">+</div>}<div className="scene-caption"><span className="eyebrow">THE OFFICE</span><h1>Take the lead.</h1><p>Walk to a work area, then press <kbd>E</kbd> to open it.</p></div><div className="agent-presence"><span>Tech lead <strong>{office.roles.lead.status}</strong></span><span>Intern <strong>{office.roles.intern.status}</strong></span>{office.requests.length > 0 && <button onClick={() => open(office.requests[0].role === 'lead' ? 'meeting' : 'intern')}>{office.requests.length} request{office.requests.length === 1 ? '' : 's'} need you</button>}</div><div className="scene-bottom"><div className="movement"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span><span>Mouse look</span><span><kbd>E</kbd> interact</span><span><kbd>Esc</kbd> release</span></div><button ref={roamRef} className="primary-button" onClick={() => { setPanel(null); const canvas = document.querySelector<HTMLCanvasElement>('.scene-wrap canvas'); if (canvas) void canvas.requestPointerLock() }}>{locked ? 'Walking in office' : 'Enter / resume walking'}</button></div>{nearby && !panel && <button className="nearby" onClick={() => open(nearby)}>Press E · {labels[nearby]}</button>}</section>
      <aside className="sidebar" aria-label="Office navigation"><div className="sidebar-head"><span className="eyebrow">WORK AREAS</span><p>Choose a space to work. You can also walk to it in the room.</p></div><nav className="area-list">{AREAS.map((area, index) => <button key={area.id} className={panel === area.id ? 'area active' : 'area'} onClick={() => open(area.id)}><span className="area-num">0{index + 1}</span><span><strong>{area.title}</strong><small>{['Project and status', 'Tech lead and plan', 'Intern and assignment', 'Work overview'][index]}</small></span><span className="area-arrow">↗</span></button>)}</nav><button className="preview-link" onClick={() => open('preview')}><span>◫</span><span><strong>Website preview</strong><small>Run and review your site</small></span><span>↗</span></button><div className="sidebar-foot"><span className="eyebrow">CURRENT PROJECT</span><strong>{draft.project.trim() || 'No project named yet'}</strong><small>{project ? approved ? 'Plan approved by you' : 'Project created · plan pending' : 'Create project at boss’s desk'}</small></div></aside>
    </div>
    {panel && <div className="panel-layer" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><section className="work-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><div className="panel-header"><div><span className="eyebrow">WORKSPACE / {panel === 'preview' ? 'PREVIEW' : panel.toUpperCase()}</span><h2 id="panel-title">{labels[panel]}</h2></div><button ref={closeRef} className="icon-button" aria-label="Close panel" onClick={close}>×</button></div><div className="panel-body">
      {error && <div className="error-notice" role="alert">{error}</div>}{office.error && <div className="error-notice" role="alert">Codex: {office.error}</div>}
      {panel === 'boss' && <><p className="intro">Name your website idea and outcome. Creating it provisions one contained Vite, React, and TypeScript project. The brief is fixed for this one-project MVP.</p>{field('project', 'Project name', 2, 'Your website idea')}{field('goal', 'Desired outcome', 5, 'What should the website do for its user?')}<div className="assignment"><div><strong>{project ? 'Website project created' : 'No website project yet'}</strong><p>{project ? project.projectRoot : 'Create the project before assigning code work.'}</p></div><button className="primary-button" disabled={busy || bridgeMissing || Boolean(project) || !draft.project.trim() || !draft.goal.trim()} onClick={() => void createProject()}>Create project</button></div><div className="notice"><strong>Agents</strong><span>Tech lead: {office.roles.lead.status} · Intern: {office.roles.intern.status}</span><span>Pending requests: {office.requests.length}</span><span>{bridgeMissing ? 'Agent bridge unavailable in this browser. Run Electron.' : `Codex app-server: ${office.connection}`}</span></div><OfficeControlsPanel controls={office.controls} disabledReason={controlsDisabledReason} update={updateControls} /><UsagePanel usage={office.usage} refresh={refreshUsage} disabled={busy || !online} /></>}
      {panel === 'meeting' && <>
        <p className="intro">Use the tech lead to examine options. Record your own decision and reason before handing work to the intern.</p>
        <Conversation role="lead" office={office} busy={busy} canSend={Boolean(project)} send={send} resolve={resolve} />
        <h3 className="section-title">Plan versions</h3>
        {field('plan', 'Plan outline', 7, 'Scope, approach, dependencies, and definition of done')}
        <div className="record-actions"><button className="secondary-button" disabled={busy || !localReady || liveInternTurn || !draft.plan.trim() || draft.plan.trim() === latestPlan?.text} onClick={() => void savePlan()}>Save new plan version</button><span>{liveInternTurn ? 'Wait for the current intern turn before changing the plan.' : latestPlan ? `Saved version ${latestPlan.version}${approvalVersion === latestPlan.version ? ' · approved' : ''}` : 'No plan saved yet'}</span></div>
        {latestPlan?.version === 1 && records?.history.some(item => item.kind === 'plan-imported') && <p className="interrupt-note">This plan was imported from the earlier office prototype. It may include the project brief and decision notes in one block. You can edit it and explicitly save a cleaner version; that version will need your approval.</p>}
        {draft.plan.trim() !== latestPlan?.text && latestPlan && <p className="review-note">Your editor differs from the saved plan. Save a new version before approving it.</p>}
        <div className="plan-approval"><div><strong>{approved ? 'Current plan approved' : 'Plan needs your approval'}</strong><p>{approved ? 'The intern can work from this exact version.' : 'Approval applies only to the latest saved version.'}</p></div><button className="primary-button" disabled={busy || !localReady || !latestPlan || approved || draft.plan.trim() !== latestPlan.text} onClick={() => void approve()}>Approve version {latestPlan?.version || ''}</button></div>
        <h3 className="section-title">Decisions you made</h3>
        {records?.decisions.length ? <div className="record-list">{records.decisions.map(item => <article key={item.id}><strong>{item.choice}</strong><p>{item.reason}</p><small>{timeLabel(item.at)}</small></article>)}</div> : <p className="review-empty">No decisions recorded yet.</p>}
        {field('choice', 'Your choice', 2, 'What did you decide?')}{field('reason', 'Why you chose it', 3, 'What evidence or trade-off mattered?')}
        <button className="secondary-button" disabled={busy || !project || !draft.choice.trim() || !draft.reason.trim()} onClick={() => void addDecision()}>Record decision</button>
        <h3 className="section-title">Open questions</h3>
        {records?.questions.length ? <div className="record-list">{records.questions.map(item => <article key={item.id}><strong>{item.question}</strong><p>{item.context}</p><small>{item.status}{item.answer ? ` · ${item.answer}` : ''}</small>{item.status === 'open' && <div className="answer-row"><textarea aria-label={`Answer ${item.question}`} value={answers[item.id] || ''} onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Your answer" rows={2} /><button className="secondary-button" disabled={busy || !answers[item.id]?.trim()} onClick={() => void resolveQuestion(item.id)}>Resolve</button></div>}</article>)}</div> : <p className="review-empty">No open questions recorded yet.</p>}
        {field('question', 'Question to track', 2, 'What needs an answer?')}{field('questionContext', 'Context (optional)', 2, 'Why does it matter?')}
        <button className="secondary-button" disabled={busy || !project || !draft.question.trim()} onClick={() => void addQuestion()}>Track question</button>
      </>}
      {panel === 'intern' && <>
        <p className="intro">Define a task and how you will judge it. The intern works only after you assign the saved task.</p>
        {field('taskTitle', 'Task title', 2, 'A short name for the work')}{field('task', 'Instructions', 5, 'What should the intern build?')}{field('criteria', 'Acceptance criteria', 4, 'What must be true before you accept it?')}
        <div className="assignment"><div><strong>{approved ? 'Approved plan available' : 'Approve the saved plan first'}</strong><p>Creating a task saves its instructions and criteria. Assignment is a separate action.</p></div><button className="primary-button" disabled={busy || !localReady || !approved || !draft.taskTitle.trim() || !draft.task.trim() || !draft.criteria.trim()} onClick={() => void createTask()}>Create task</button></div>
        <h3 className="section-title">Tasks</h3>
        {records?.tasks.length === 0 && office.roles.intern.messages.length > 0 && <p className="interrupt-note">Earlier intern work predates task records. Its conversation and changed files remain available, but no task was automatically marked accepted. Your previous task draft stays in the fields above.</p>}
        {records?.tasks.length ? <div className="task-list">{records.tasks.map(task => <button key={task.id} className={selectedTask?.id === task.id ? 'task-option active' : 'task-option'} onClick={() => setSelectedTaskId(task.id)}><strong>{task.title}</strong><span>{task.status}{task.interrupted ? ' · interrupted at restart' : ''}</span></button>)}</div> : <p className="review-empty">No task saved yet.</p>}
        {selectedTask && <article className="task-detail"><div className="task-detail-head"><div><span className="eyebrow">TASK · {selectedTask.status.toUpperCase()}</span><h3>{selectedTask.title}</h3></div><small>Plan v{selectedTask.planVersion} · {selectedTask.revisionCount} revision{selectedTask.revisionCount === 1 ? '' : 's'}</small></div><p>{selectedTask.instructions}</p><strong>Acceptance criteria</strong><p>{selectedTask.acceptanceCriteria}</p>{selectedTask.interrupted && <p className="interrupt-note">This turn was interrupted by an app restart. Review the task and assign it again when ready.</p>}{selectedTask.planVersion !== approvalVersion && selectedTask.status === 'ready' && <p className="interrupt-note">This task belongs to an older plan version. Create a new task under the current approved plan.</p>}<div className="request-actions">
          {selectedTask.status === 'ready' && <button className="primary-button" disabled={busy || !online || !approved || selectedTask.planVersion !== approvalVersion || liveInternTurn || records?.escalations.some(item => item.taskId === selectedTask.id && item.status === 'open')} onClick={() => void taskAction('dispatchTask', selectedTask.id)}>Assign to intern</button>}
          {selectedTask.status === 'paused' && <button className="primary-button" disabled={busy || !localReady} onClick={() => void taskAction('resumeTask', selectedTask.id)}>Resume task</button>}
          {['ready', 'working', 'blocked'].includes(selectedTask.status) && <button className="secondary-button" disabled={busy || !localReady || !canPauseTask} onClick={() => void taskAction('pauseTask', selectedTask.id)}>Pause task</button>}
          {selectedTask.status === 'review' && <><button className="secondary-button" onClick={() => open('preview')}>Review website and files</button><button className="primary-button" disabled={busy || !localReady} onClick={() => void taskAction('acceptTask', selectedTask.id)}>Accept work</button></>}
        </div>{selectedTask.status === 'review' && <div className="revision-box"><label className="field"><span>Request a revision</span><textarea rows={3} value={draft.revision} onChange={event => change('revision', event.target.value)} placeholder="What needs to change, and why?" /></label><button className="secondary-button" disabled={busy || !localReady || !draft.revision.trim()} onClick={() => void requestRevision(selectedTask.id)}>Request revision</button></div>}</article>}
        {!!records?.escalations.length && <><h3 className="section-title">Escalations</h3><div className="record-list">{records.escalations.filter(item => !selectedTask || item.taskId === selectedTask.id).map(item => <article key={item.id}><span className="eyebrow">{item.status.toUpperCase()}</span><strong>{item.question}</strong>{item.evidence && <p>{item.evidence}</p>}{item.answer && <p><b>Your answer:</b> {item.answer}</p>}{item.status === 'interrupted' && <p className="interrupt-note">The live request ended when the app restarted. Reassign the task to continue.</p>}{item.status === 'open' && item.sourceRequestId ? <p>{office.requests.some(request => request.id === item.sourceRequestId) ? 'Answer the live request in the intern conversation below.' : 'Waiting for the live Codex request. Reconnect before answering.'}</p> : item.status === 'open' && <div className="answer-row"><textarea aria-label={`Answer escalation ${item.question}`} rows={3} value={answers[item.id] || ''} onChange={event => setAnswers(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Your decision or instruction" /><button className="primary-button" disabled={busy || !answers[item.id]?.trim()} onClick={() => void answerEscalation(item.id)}>Answer blocker</button></div>}</article>)}</div></>}
        <h3 className="section-title">Work reports</h3>{records?.workReports.filter(item => !selectedTask || item.taskId === selectedTask.id).length ? <div className="record-list">{records.workReports.filter(item => !selectedTask || item.taskId === selectedTask.id).map(item => <article key={item.id}><strong>{item.outcome}</strong><p>Files: {item.filesChanged.join(', ') || 'not separately itemized; see intern report above'}</p><p>Checks: {item.checks.join('; ') || 'not separately itemized; see intern report above'}</p><p>Unresolved: {item.unresolved.join('; ') || 'not separately itemized; see intern report above'}</p><small>{timeLabel(item.at)}</small></article>)}</div> : <p className="review-empty">No work report yet.</p>}
        <Conversation role="intern" office={office} busy={busy} canSend={false} send={send} resolve={resolve} />
      </>}
      {panel === 'board' && <><p className="intro">The saved project trail: your decisions, unresolved questions, task state, and work reports.</p><div className="board-grid"><article><span className="eyebrow">PROJECT</span><h3>{draft.project.trim() || 'Unnamed project'}</h3><p>{draft.goal.trim() || 'No goal recorded.'}</p></article><article><span className="eyebrow">PLAN</span><h3>{latestPlan ? `Version ${latestPlan.version} · ${approved ? 'approved' : 'pending approval'}` : 'No saved plan'}</h3><p>{latestPlan?.text || draft.plan.trim() || 'No plan outline yet.'}</p></article><article><span className="eyebrow">CURRENT TASK</span><h3>{selectedTask?.title || 'No task yet'}</h3><p>{selectedTask ? `${selectedTask.status.toUpperCase()}${selectedTask.interrupted ? ' · interrupted' : ''}\n${selectedTask.acceptanceCriteria}` : 'Create a task at the intern desk.'}</p></article><article><span className="eyebrow">ESCALATIONS</span><h3>{records?.escalations.filter(item => item.status === 'open').length || 0} need an answer</h3><p>{records?.escalations.filter(item => item.status === 'open').map(item => item.question).join('\n') || 'No unresolved blocker.'}</p></article><article><span className="eyebrow">DECISIONS</span><h3>{records?.decisions.length || 0} recorded</h3><p>{records?.decisions.map(item => `${item.choice} — ${item.reason}`).join('\n') || (draft.choice ? `Unsaved note: ${draft.choice}` : 'No decisions recorded.')}</p></article><article><span className="eyebrow">OPEN QUESTIONS</span><h3>{records?.questions.filter(item => item.status === 'open').length || 0} remaining</h3><p>{records?.questions.filter(item => item.status === 'open').map(item => item.question).join('\n') || (draft.question ? `Unsaved note: ${draft.question}` : 'None recorded.')}</p></article></div>{selectedTask && <section className="board-actions"><h3 className="section-title">Boss action · {selectedTask.title}</h3><div className="request-actions">{selectedTask.status === 'review' && <><button className="secondary-button" onClick={() => open('preview')}>Review website and files</button><button className="primary-button" disabled={busy || !localReady} onClick={() => void taskAction('acceptTask', selectedTask.id)}>Accept work</button></>}{['ready', 'working', 'blocked', 'paused'].includes(selectedTask.status) && <button className="secondary-button" onClick={() => open('intern')}>Open intern desk</button>}{['ready', 'working', 'blocked'].includes(selectedTask.status) && <button className="secondary-button" disabled={busy || !localReady || !canPauseTask} onClick={() => void taskAction('pauseTask', selectedTask.id)}>Pause task</button>}</div>{selectedTask.status === 'review' && <div className="revision-box"><label className="field"><span>Revision instructions</span><textarea rows={3} value={draft.revision} onChange={event => change('revision', event.target.value)} placeholder="What should be corrected?" /></label><button className="secondary-button" disabled={busy || !localReady || !draft.revision.trim()} onClick={() => void requestRevision(selectedTask.id)}>Request revision</button></div>}{records?.escalations.some(item => item.taskId === selectedTask.id && item.status === 'open') && <p><button className="secondary-button" onClick={() => open('intern')}>Answer blocker at intern desk</button></p>}</section>}<h3 className="section-title">Work history</h3><div className="activity-log">{records?.history.length ? records.history.slice().reverse().map(item => <div className="activity" key={item.id}><time>{timeLabel(item.at)}</time><strong>{item.kind}</strong><span>{item.summary}</span></div>) : <p>No saved work history yet.</p>}</div><h3 className="section-title">Live agent activity</h3><div className="activity-log">{office.activity.length ? office.activity.slice(-30).reverse().map(item => <div className="activity" key={item.id}><time>{timeLabel(item.at)}</time><strong>{item.role === 'lead' ? 'Tech lead' : 'Intern'}</strong><span>{item.summary}</span></div>) : <p>No live agent activity yet.</p>}</div></>}
      {panel === 'preview' && <PreviewPane project={project} internStatus={office.roles.intern.status} task={selectedTask} reports={records?.workReports} />}
    </div><footer className="panel-footer"><span>{panel === 'preview' ? 'Preview runs only when you click Run' : 'Notes saved on this computer'}</span><button className="secondary-button" onClick={close}>Return to office</button></footer></section></div>}
  </main>
}
