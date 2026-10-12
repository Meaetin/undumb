import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.join(base, '.runtime', 'state.json')
if (!existsSync(statePath)) throw new Error('No run state; run the harness first')
const state = JSON.parse(await readFile(statePath, 'utf8'))
for (const role of ['lead', 'intern']) {
  if (!state.roles[role]?.sessionId) throw new Error(`Missing ${role} session ID`)
}
const required = ['lead:start', 'lead:resume', 'intern:start', 'intern:resume']
for (const action of required) {
  const run = state.runs.find(run => run.action === action && run.exitCode === 0 && run.completed)
  if (!run) throw new Error(`Missing successful ${action}`)
  if (action.endsWith(':start') && run.status !== 'blocked') throw new Error(`${action} did not block`)
  if (action.endsWith(':resume') && run.status !== 'completed') throw new Error(`${action} did not complete`)
  if ((action.startsWith('lead:') || action === 'intern:start') && run.changedFiles.length) throw new Error(`${action} edited files`)
  const events = (await readFile(path.join(base, run.eventsFile), 'utf8')).trim().split('\n').map(JSON.parse)
  if (!events.some(event => event.type === 'thread.started' && event.thread_id === run.sessionId) && !action.endsWith(':resume')) throw new Error(`${action} missing thread.started`)
}
const internRuns = state.runs.filter(run => run.action.startsWith('intern:'))
if (internRuns[0]?.sessionId !== internRuns.at(-1)?.sessionId) throw new Error('Intern session changed on resume')
if (!internRuns.at(-1)?.changedFiles.includes('src/App.tsx')) throw new Error('Intern did not edit App.tsx')
console.log('Verified separate session IDs, blocked turns without edits, intern resume, and edited website files.')
