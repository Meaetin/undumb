const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('officeApi', Object.freeze({
  getState: () => ipcRenderer.invoke('gui:get-state'),
  createProject: name => ipcRenderer.invoke('gui:create-project', name),
  hireIntern: (projectId, name) => ipcRenderer.invoke('gui:hire-intern', projectId, name),
  createSession: (projectId, agentId, carryTask) => ipcRenderer.invoke('gui:create-session', projectId, agentId, carryTask),
  selectSession: (projectId, agentId, sessionId) => ipcRenderer.invoke('gui:select-session', projectId, agentId, sessionId),
  gitStatus: projectId => ipcRenderer.invoke('gui:git-status', projectId),
  initializeGit: projectId => ipcRenderer.invoke('gui:init-git', projectId),
  unassignTask: (projectId, taskId) => ipcRenderer.invoke('gui:unassign-task', projectId, taskId),
  openProjectFolder: projectId => ipcRenderer.invoke('gui:open-project-folder', projectId),
  pickImages: () => ipcRenderer.invoke('gui:pick-images'),
  pickFiles: () => ipcRenderer.invoke('gui:pick-files'),
  sendMessage: (projectId, agentId, sessionId, text, imageIds, fileIds, taskId, baseTaskId) => ipcRenderer.invoke('gui:send-message', projectId, agentId, sessionId, text, imageIds, fileIds, taskId, baseTaskId),
  answerRequest: (requestId, response) => ipcRenderer.invoke('gui:answer-request', requestId, response),
  interrupt: (projectId, agentId, sessionId) => ipcRenderer.invoke('gui:interrupt', projectId, agentId, sessionId),
  compact: (projectId, agentId, sessionId) => ipcRenderer.invoke('gui:compact', projectId, agentId, sessionId),
  reconnect: () => ipcRenderer.invoke('gui:reconnect'),
  subscribe: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.')
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('gui:state', listener)
    return () => ipcRenderer.removeListener('gui:state', listener)
  },
}))
