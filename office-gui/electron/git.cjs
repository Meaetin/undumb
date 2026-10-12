const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { execFileSync } = require('node:child_process')

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function gitStatus(root) {
  try {
    const top = git(root, 'rev-parse', '--show-toplevel')
    if (path.resolve(top).toLowerCase() !== path.resolve(root).toLowerCase()) return { initialized: false, hasCommit: false }
    try { git(root, 'rev-parse', '--verify', 'HEAD'); return { initialized: true, hasCommit: true } }
    catch { return { initialized: true, hasCommit: false } }
  } catch { return { initialized: false, hasCommit: false } }
}

function initializeGit(root) {
  const status = gitStatus(root)
  if (!status.initialized) git(root, 'init')
  if (!gitStatus(root).hasCommit) {
    git(root, 'add', '-A')
    git(root, '-c', 'user.name=Boss Office', '-c', 'user.email=boss-office@local.invalid',
      'commit', '--allow-empty', '-m', 'Initial project snapshot')
  }
  return gitStatus(root)
}

function createTaskRun(store, project, task, agentId, baseTaskId = null) {
  const id = randomUUID()
  const at = new Date().toISOString()
  if (!gitStatus(project.root).hasCommit) {
    return { id, agentId, branch: null, workspacePath: project.root, baseRef: null, createdAt: at }
  }
  let startingPoint = task.baseRef || 'HEAD'
  if (!task.baseRef && baseTaskId) {
    const source = project.tasks.find(item => item.id === baseTaskId)
    if (!source || source.status !== 'done') throw new Error('Choose a completed task as the branch starting point.')
    const sourceRun = source.runs.find(item => item.id === source.currentRunId) || source.runs.at(-1)
    if (!sourceRun?.branch) throw new Error('The selected task has no Git branch to build on.')
    startingPoint = sourceRun.branch
  }
  const baseRef = git(project.root, 'rev-parse', '--verify', startingPoint)
  const branch = `boss-office/task-${task.id.slice(0, 8)}-${id.slice(0, 8)}`
  const workspacePath = path.join(store.worktreesRoot, project.id, id)
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true })
  git(project.root, 'worktree', 'add', '-b', branch, workspacePath, baseRef)
  return { id, agentId, branch, workspacePath, baseRef, createdAt: at }
}

function taskCommitReady(run) {
  if (!run?.branch) return true
  try {
    return git(run.workspacePath, 'status', '--porcelain') === '' &&
      git(run.workspacePath, 'rev-parse', 'HEAD') !== run.baseRef
  } catch { return false }
}

module.exports = { gitStatus, initializeGit, createTaskRun, taskCommitReady }
