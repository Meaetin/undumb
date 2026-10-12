import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const runtime = path.join(base, '.runtime')
const summaries = (await readdir(runtime)).filter(name => name.endsWith('-app-server-summary.json')).sort()
if (!summaries.length) throw new Error('No app-server run summary found')
const summary = JSON.parse(await readFile(path.join(runtime, summaries.at(-1)), 'utf8'))
const { outcomes, threadIds, requests, notificationCounts, changedFiles } = summary
if (summary.error) throw new Error(summary.error)
if (!outcomes.initialize?.ok) throw new Error('Initialize did not succeed')
if (!threadIds.lead || !threadIds.intern || threadIds.lead === threadIds.intern) throw new Error('Role threads are not distinct')
if (outcomes.threads.lead.sandbox.type !== 'readOnly') throw new Error('Lead thread is not read-only')
if (outcomes.threads.intern.sandbox.type !== 'workspaceWrite') throw new Error('Intern thread is not workspace-write')
for (const turn of ['leadTurn', 'internTurn', 'probeTurn']) {
  if (outcomes[turn]?.status !== 'completed') throw new Error(`${turn} did not complete`)
}
if (!notificationCounts['item/agentMessage/delta']) throw new Error('No streamed agent message deltas')
if (!notificationCounts['item/commandExecution/outputDelta']) throw new Error('No streamed command output')
if (!requests.some(request => request.method === 'item/commandExecution/requestApproval' && request.decision === 'decline')) throw new Error('No declined in-turn approval request')
if (changedFiles.length) throw new Error(`Fixture files changed: ${changedFiles.join(', ')}`)
const events = (await readFile(path.join(base, summary.logFile), 'utf8')).trim().split('\n').map(JSON.parse)
const approvalIndex = events.findIndex(entry => entry.message.method === 'item/commandExecution/requestApproval')
const resolvedIndex = events.findIndex((entry, index) => index > approvalIndex && entry.message.method === 'serverRequest/resolved')
const completedIndex = events.findIndex((entry, index) => index > approvalIndex && entry.message.method === 'turn/completed' && entry.message.params?.turn?.id === requests.find(request => request.method === 'item/commandExecution/requestApproval')?.turnId)
if (approvalIndex < 0 || resolvedIndex < approvalIndex || completedIndex < resolvedIndex) throw new Error('Approval did not resolve during the turn')
console.log('Verified app-server role threads, streamed events, a declined in-turn approval, and no fixture edits.')
