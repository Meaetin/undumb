export type SessionStatus = 'available' | 'working' | 'needs-you' | 'interrupted' | 'closed'
export type Message = { id: string; role: 'user' | 'agent'; text: string; images: string[]; files?: string[]; taskId?: string | null; at: string }
export type Activity = { id: string; kind: string; summary: string; at: string; itemId?: string }
export type ChatSession = { id: string; title: string; threadId: string | null; turnId?: string | null; status: SessionStatus; taskId: string | null; workspacePath: string | null; locked?: boolean; messages: Message[]; activity: Activity[]; createdAt: string; updatedAt: string }
export type Agent = { id: string; name: string; role: 'lead' | 'intern'; activeSessionId: string; sessions: ChatSession[] }
export type TaskRun = { id: string; agentId: string; branch: string | null; workspacePath: string; baseRef: string | null; createdAt: string }
export type Task = { id: string; title: string; markdown: string; status: 'open' | 'assigned' | 'done'; assignedAgentId: string | null; currentRunId: string | null; baseRef: string | null; runs: TaskRun[]; createdAt: string; updatedAt: string }
export type Project = { id: string; name: string; root: string; plansPath: string; createdAt: string; agents: Agent[]; tasks: Task[] }
export type OfficeRequest = { id: string; projectId: string; agentId: string; kind: 'approval' | 'question'; method: string; title: string; details: string; questions: Array<{ id: string; header?: string; question: string; options?: Array<{ label: string; description?: string }> }> }
export type OfficeState = { connection: 'stopped' | 'starting' | 'ready' | 'error'; error: string | null; requests: OfficeRequest[]; projects: Project[] }
export type PickedImage = { id: string; name: string; dataUrl: string }
export type PickedFile = { id: string; name: string }
export type GitStatus = { initialized: boolean; hasCommit: boolean }
export type OfficeApi = {
  getState(): Promise<OfficeState>
  createProject(name: string): Promise<Project>
  hireIntern(projectId: string, name: string): Promise<Agent>
  createSession(projectId: string, agentId: string, carryTask: boolean): Promise<ChatSession>
  selectSession(projectId: string, agentId: string, sessionId: string): Promise<ChatSession>
  gitStatus(projectId: string): Promise<GitStatus>
  initializeGit(projectId: string): Promise<GitStatus>
  unassignTask(projectId: string, taskId: string): Promise<Task>
  openProjectFolder(projectId: string): Promise<void>
  pickImages(): Promise<PickedImage[]>
  pickFiles(): Promise<PickedFile[]>
  sendMessage(projectId: string, agentId: string, sessionId: string, text: string, imageIds: string[], fileIds: string[], taskId: string | null, baseTaskId: string | null): Promise<{ turnId: string }>
  answerRequest(requestId: string, response: { decision: 'accept' | 'decline' } | { answers: Record<string, string> }): Promise<void>
  interrupt(projectId: string, agentId: string, sessionId: string): Promise<void>
  compact(projectId: string, agentId: string, sessionId: string): Promise<void>
  reconnect(): Promise<void>
  subscribe(callback: (state: OfficeState) => void): () => void
}
declare global { interface Window { officeApi?: OfficeApi } }
