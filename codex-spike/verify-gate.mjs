import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.dirname(fileURLToPath(import.meta.url))
const runtime = path.join(base, '.runtime')
const names = (await readdir(runtime)).filter(name => name.endsWith('-gate-summary.json')).sort()
if (!names.length) throw new Error('No gate summary found')
const summary = JSON.parse(await readFile(path.join(runtime, names.at(-1)), 'utf8'))
if (summary.error) throw new Error(summary.error)
const { outcomes, serverRequests, markerExistsAfterCleanup } = summary
if (!outcomes.collaborationModes.data.some(item => item.mode === 'plan')) throw new Error('Plan mode was not listed')
if (outcomes.planTurn?.status !== 'completed') throw new Error('Plan turn did not complete')
if (outcomes.approvalTurn?.status !== 'completed') throw new Error('Approval turn did not complete')
const question = serverRequests.find(item => item.method === 'item/tool/requestUserInput')
const approval = serverRequests.find(item => item.method === 'item/commandExecution/requestApproval')
if (!question?.response?.answers || !approval || approval.response?.decision !== 'decline') throw new Error('Expected in-turn question and declined approval')
const probes = Object.fromEntries(outcomes.fileProbes.map(item => [item.name, item]))
if (probes.readOnlyInsideFixture?.exitCode === 0 || probes.workspaceWriteInsideFixture?.exitCode !== 0 || probes.workspaceWriteSiblingDenied?.exitCode === 0) throw new Error('File boundary outcome mismatch')
const before = outcomes.markerExistsBeforeCleanup
if (before.readOnly || !before.allowed || before.sibling || before.approval) throw new Error('Marker state before cleanup mismatch')
if (Object.values(markerExistsAfterCleanup).some(Boolean)) throw new Error('A marker remained after cleanup')
const network = Object.fromEntries(outcomes.networkProbes.map(item => [item.name, item]))
if (network.networkOff?.exitCode === 0 || !/HTTP_STATUS=000/.test(network.networkOff?.stdout ?? '')) throw new Error('Network-off probe unexpectedly connected')
if (network.networkOn?.exitCode !== 0 || !/HTTP_STATUS=3\d\d/.test(network.networkOn?.stdout ?? '')) throw new Error('Network-on probe did not reach the official host')
const events = (await readFile(path.join(base, summary.logFile), 'utf8')).trim().split('\n').map(JSON.parse)
for (const request of [question, approval]) {
  const start = events.findIndex(entry => entry.message.method === request.method && entry.message.id === request.id)
  const resolved = events.findIndex((entry, index) => index > start && entry.message.method === 'serverRequest/resolved' && entry.message.params?.requestId === request.id)
  const completed = events.findIndex((entry, index) => index > resolved && entry.message.method === 'turn/completed' && entry.message.params?.turn?.id === request.params.turnId)
  if (start < 0 || resolved < start || completed < resolved) throw new Error(`${request.method} did not resolve within its turn`)
}
console.log('Verified in-turn Plan question, denied approval, Windows file boundaries, network switch, and marker cleanup.')
