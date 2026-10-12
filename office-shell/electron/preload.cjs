const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('officeApi', Object.freeze({
  getState: () => ipcRenderer.invoke('office:get-state'),
  updateControls: patch => ipcRenderer.invoke('office:update-controls', patch),
  refreshUsage: () => ipcRenderer.invoke('office:refresh-usage'),
  subscribe: callback => {
    if (typeof callback !== 'function') throw new TypeError('subscribe needs a callback')
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('office:state', listener)
    return () => ipcRenderer.removeListener('office:state', listener)
  },
  sendMessage: (role, text) => ipcRenderer.invoke('office:send-message', role, text),
  resolveRequest: (id, response) => ipcRenderer.invoke('office:resolve-request', id, response),
  approvePlan: text => ipcRenderer.invoke('office:approve-plan', text),
  revokePlanApproval: () => ipcRenderer.invoke('office:revoke-plan-approval'),
  savePlan: text => ipcRenderer.invoke('office:save-plan', text),
  addDecision: value => ipcRenderer.invoke('office:add-decision', value),
  addQuestion: value => ipcRenderer.invoke('office:add-question', value),
  resolveQuestion: (id, answer) => ipcRenderer.invoke('office:resolve-question', id, answer),
  createTask: value => ipcRenderer.invoke('office:create-task', value),
  dispatchTask: id => ipcRenderer.invoke('office:dispatch-task', id),
  pauseTask: id => ipcRenderer.invoke('office:pause-task', id),
  resumeTask: id => ipcRenderer.invoke('office:resume-task', id),
  answerEscalation: (id, answer) => ipcRenderer.invoke('office:answer-escalation', id, answer),
  requestRevision: (id, value) => ipcRenderer.invoke('office:request-revision', id, value),
  acceptTask: id => ipcRenderer.invoke('office:accept-task', id),
  createProject: idea => ipcRenderer.invoke('office:create-project', idea),
  getProject: () => ipcRenderer.invoke('office:get-project'),
  getPreviewState: () => ipcRenderer.invoke('office:preview:get-state'),
  runPreview: () => ipcRenderer.invoke('office:preview:run'),
  stopPreview: () => ipcRenderer.invoke('office:preview:stop'),
  refreshPreview: () => ipcRenderer.invoke('office:preview:refresh'),
  setPreviewBounds: bounds => ipcRenderer.invoke('office:preview:set-bounds', bounds),
  subscribePreview: callback => {
    if (typeof callback !== 'function') throw new TypeError('subscribePreview needs a callback')
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('office:preview-state', listener)
    return () => ipcRenderer.removeListener('office:preview-state', listener)
  },
  listProjectChanges: () => ipcRenderer.invoke('office:review:list'),
  readProjectChange: relativePath => ipcRenderer.invoke('office:review:read', relativePath),
}))
