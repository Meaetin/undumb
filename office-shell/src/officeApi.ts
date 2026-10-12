export type Role = 'lead' | 'intern'
export type Project = { projectRoot: string; metadata: { id: string; idea: string; createdAt: string; starter: string } }
export type PreviewState = { status: 'stopped' | 'starting' | 'running' | 'error'; url?: string; error?: string }
export type PreviewBounds = { x: number; y: number; width: number; height: number }
export type ProjectChanges = { files: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>; truncated: boolean }
export type ProjectChange = { path: string; status: 'added' | 'modified' | 'deleted'; before: string | null; after: string | null }
export type PlanVersion = { version: number; text: string; at: string }
export type DecisionRecord = { id: string; choice: string; reason: string; at: string }
export type QuestionRecord = { id: string; question: string; context?: string; answer?: string; status: 'open' | 'answered'; createdAt: string; answeredAt?: string }
export type TaskRecord = { id: string; title: string; instructions: string; acceptanceCriteria: string; status: 'ready' | 'working' | 'blocked' | 'review' | 'accepted' | 'paused'; planVersion: number; turnIds: string[]; revisionCount: number; revisions?: Array<{ version: number; instructions: string; acceptanceCriteria: string; at: string }>; interrupted: boolean; createdAt: string; updatedAt: string }
export type EscalationRecord = { id: string; taskId: string; question: string; evidence?: string; sourceRequestId?: string; answer?: string; status: 'open' | 'answered' | 'interrupted'; createdAt: string; answeredAt?: string }
export type WorkReport = { id: string; taskId: string; turnId?: string; outcome: string; filesChanged: string[]; checks: string[]; unresolved: string[]; at: string }
export type WorkHistory = { id: string; kind: string; summary: string; at: string }
export type WorkRecords = {
  version: 1; projectId: string
  plan: { versions: PlanVersion[]; approvedVersion: number | null }
  decisions: DecisionRecord[]; questions: QuestionRecord[]
  tasks: TaskRecord[]; escalations: EscalationRecord[]; workReports: WorkReport[]; history: WorkHistory[]
}
export type OfficeControlSettings = { leadNetwork: boolean; internNetwork: boolean; internFileEdits: boolean; terminalCommands: boolean; approvalReviewer: 'user' | 'auto_review' }
export type OfficeControls = {
  settings: OfficeControlSettings | null
  capabilities: { leadNetwork: boolean; internNetwork: boolean; internFileEdits: boolean; terminalCommands: boolean; approvalReviewer: boolean }
  error?: string
}
export type UsageState = {
  status: 'loading' | 'ready' | 'unavailable'
  source: string
  fetchedAt?: string
  thresholdPercent: number
  buckets: Array<{ id: string; name: string; reached: boolean; windows: Array<{
    kind: 'primary' | 'secondary'; usedPercent: number; windowDurationMins: number | null; resetsAt: number | null
  }> }>
  tokenActivity: { lifetimeTokens: number | null; latestDay: { date: string; tokens: number } | null } | null
  warnings: Array<{ bucketId: string; name: string; kind: string; usedPercent: number | null }>
  rateError?: string | null
  tokenError?: string | null
}
export type RequestContext = { command?: string; cwd?: string; reason?: string; host?: string; protocol?: string; port?: number; files?: string[]; grantRoot?: string; permissions?: Record<string, unknown>; additionalPermissions?: Record<string, unknown> }
export type OfficeState = {
  connection: 'starting' | 'ready' | 'error' | 'stopped'
  error?: string
  planApproved: boolean
  approvedPlanText?: string
  project: Project | null
  workRecords?: WorkRecords | null
  controls?: OfficeControls
  usage?: UsageState
  roles: Record<Role, {
    threadId?: string; turnId?: string; status: 'idle' | 'working' | 'blocked' | 'error'
    messages: Array<{ id: string; role: 'user' | 'agent'; text: string; at: string }>
  }>
  requests: Array<{ id: string; role: Role; kind: 'approval' | 'question'; method: string; title: string; details?: string; context?: RequestContext; questions?: Array<{ id: string; header?: string; question: string; options?: Array<{ label: string; description?: string }> }> }>
  activity: Array<{ id: string; role: Role; kind: string; summary: string; at: string }>
}
export type OfficeApi = {
  getState(): Promise<OfficeState>
  subscribe(callback: (state: OfficeState) => void): () => void
  sendMessage(role: Role, text: string): Promise<{ turnId: string }>
  resolveRequest(requestId: string, response: { decision: 'accept' | 'decline' } | { answers: Record<string, { answers: string[] }> }): Promise<void>
  updateControls(patch: Partial<OfficeControlSettings>): Promise<OfficeControls>
  refreshUsage(): Promise<UsageState>
  savePlan(planText: string): Promise<PlanVersion>
  approvePlan(version: number): Promise<void>
  revokePlanApproval(): Promise<void>
  addDecision(input: { choice: string; reason: string }): Promise<DecisionRecord>
  addQuestion(input: { question: string; context?: string }): Promise<QuestionRecord>
  resolveQuestion(id: string, answer: string): Promise<void>
  createTask(input: { title: string; instructions: string; acceptanceCriteria: string }): Promise<TaskRecord>
  dispatchTask(taskId: string): Promise<void>
  pauseTask(taskId: string): Promise<void>
  resumeTask(taskId: string): Promise<void>
  answerEscalation(id: string, answer: string): Promise<void>
  requestRevision(taskId: string, input: { instructions: string; acceptanceCriteria?: string }): Promise<void>
  acceptTask(taskId: string): Promise<void>
  createProject(idea: string): Promise<Project>
  getProject(): Promise<Project | null>
  getPreviewState(): Promise<PreviewState>
  subscribePreview(callback: (state: PreviewState) => void): () => void
  runPreview(): Promise<PreviewState>
  stopPreview(): Promise<PreviewState>
  refreshPreview(): Promise<PreviewState>
  setPreviewBounds(bounds: PreviewBounds | null): Promise<void>
  listProjectChanges(): Promise<ProjectChanges>
  readProjectChange(relativePath: string): Promise<ProjectChange>
}
declare global { interface Window { officeApi?: OfficeApi } }
