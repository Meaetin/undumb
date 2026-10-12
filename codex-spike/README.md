# Codex process spike

This is a narrow integration test for *The Boss's Office*. `harness.mjs` uses Node's `spawn()` with `windowsHide: true`, the same boundary an Electron main process can own. It starts independent local Codex CLI sessions for a read-only tech lead and a workspace-write intern. The renderer, 3D office, preview, and persistence design for the product are outside this spike.

## Run

Requires a signed-in local `codex` CLI on `PATH` and Node 22 or newer. From this folder:

```powershell
node harness.mjs lead:start
node harness.mjs lead:resume "For this disposable test only, keep tasks in React component state; tasks reset on reload."
node harness.mjs intern:start
node harness.mjs intern:resume "For this disposable test only, keep tasks in React component state; tasks reset on reload."
node verify.mjs
node app-server-harness.mjs
node verify-app-server.mjs
node gate-harness.mjs
node verify-gate.mjs
cd fixture
npm install
npm run build
```

The resume answers above are simulated test input. They are not a product choice about persistence. To run the sequence again from scratch, use a fresh copy of this folder or remove this spike's `.runtime` directory and restore only the disposable `fixture` files. Do not delete Codex's global session files; those are owned by the CLI.

`harness.mjs` persists role session IDs and a run index in `.runtime/state.json`, JSONL event streams per turn, the schema-constrained final message, and stderr. It records a before/after hash inventory of the fixture to catch edits during a planning or blocked turn. The website is contained in `fixture/`, which is a Vite + React + TypeScript starter. Dependencies and build output remain under that folder and are ignored by `.gitignore`.

## Observed on this machine (Codex CLI 0.162.0-alpha.2)

| Check | Result |
| --- | --- |
| ChatGPT sign-in | `codex login status` reported `Logged in using ChatGPT`. |
| Tech lead | Started with `--sandbox read-only`; returned a structured persistence question and no changed files. Resumed in a later process using the same session ID; still no changed files. |
| Intern | Started with `--sandbox workspace-write` and `--cd fixture`; returned a structured persistence question and stopped with no changed files. |
| Intern resume | `codex exec resume` used the saved intern ID and a simulated answer; edited only `fixture/index.html`, `fixture/src/App.tsx`, and `fixture/src/style.css`. |
| Structured activity | `--json` emitted `thread.started`, `turn.started`, item events for commands and file changes, and `turn.completed`. `--output-schema` produced machine-readable final status, question, changed files, and checks. |
| Verification | `node verify.mjs` passed. After `npm install`, `npm run build` passed (TypeScript and Vite). |

The two role session IDs differed, and each resume returned its role's original ID. Each harness command is a separate host process, so this demonstrates persistence across host process exits. The first attempt to launch Codex from the restricted task shell failed with `Access is denied` while Codex tried to use its global session storage. Running the authorized spike with elevated tool permissions allowed the signed-in CLI to write its normal session files. A first Vite build in that restricted shell similarly hit an `EPERM` on an in-workspace `realpath`; the authorized rerun passed. These are properties of this development task's outer sandbox, not evidence of a Codex CLI bug.

## Protocol finding and limits

`codex exec` works for an **end-of-turn escalation**: prompt the intern to stop, require a schema-constrained `blocked` result, save the session ID, then start a new `resume` turn after the user's answer. The model cooperated in this test, and the file inventory verified that it made no edits before the answer. A `blocked` result is a completed CLI turn; it is not a live user-input request while that turn remains open. The host must store the question and wait, and should validate that the answer is associated with the blocked task before resuming.

This spike did not test enforcement against attempted out-of-workspace writes, network permissions, command approvals, cancellation, or safe rendering of an agent-edited website. `approval_policy="never"` keeps this noninteractive test from waiting on a terminal approval prompt, so it cannot implement the proposed office approval control. The working directory plus `workspace-write` flag are a useful first boundary, but the app should not describe them as proven containment until it exercises escape attempts and validates the actual Windows sandbox behavior. The activity log can include source text and commands, so the full log should stay in host-owned storage and only be exposed through a controlled UI.

Official OpenAI documentation describes app-server's thread, turn, event, and approval protocol: [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform), [Codex app-server sign-in and thread flow](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).

## Local app-server comparison (same CLI version)

`app-server-harness.mjs` launched `codex app-server --listen stdio://` as a hidden child of Node. It exchanged newline-delimited JSON-RPC messages: `initialize`, `initialized`, two `thread/start` calls, and `turn/start` calls. The server returned distinct tech-lead and intern thread IDs. Its effective settings reported `readOnly` for the lead, `workspaceWrite` for the intern, and `networkAccess: false` for both. These returned settings do not by themselves prove filesystem or network enforcement. This probe made no network request and did not test the MVP's intended default intern network access.

The lead and intern turns completed while the server streamed 139 `item/agentMessage/delta` notifications, command output deltas, item events, and turn lifecycle events. The intern was told to call `request_user_input` about task persistence. It replied that `request_user_input` was unavailable in this mode and asked in a normal agent message, so this run **did not** demonstrate a live in-turn decision question.

A separate read-only approval probe attempted to create `app-server-approval-probe.txt` **inside the disposable fixture**. The server sent an actual `item/commandExecution/requestApproval` request during the active turn. The harness always replies `decline` to approval requests. The server then emitted `serverRequest/resolved` and `turn/completed`; the probe file was absent, and before/after hashes showed no fixture changes. `node verify-app-server.mjs` checks those event relationships. Raw events and a summary are in `.runtime/*-app-server.jsonl` and `.runtime/*-app-server-summary.json`, which are ignored by Git.

| Capability | `codex exec` observation | Local app-server observation |
| --- | --- | --- |
| Separate roles | Distinct persisted session IDs; one process per turn. | Distinct thread IDs within one background server process. |
| Activity | JSONL item and turn events. | Live JSON-RPC item, text delta, command output, and turn notifications. |
| Ambiguous task | Schema-constrained `blocked` final response, then a later resume turn. | Ordinary agent message asking the question; no `request_user_input` request in the tested mode. |
| Approval | Not exercised; `approval_policy="never"` in the exec test. | In-turn command approval request observed, declined, and resolved before turn completion. |

## Protocol and Windows boundary gate

`gate-harness.mjs` uses the same local stdio app-server and only the disposable `fixture/` and `sibling-probe/` folders inside `codex-spike`. It automatically declines approvals. Every generated marker has a unique name and is removed after its observed state is recorded. The latest run is saved as `.runtime/*-gate-summary.json` plus its JSONL event log. `node verify-gate.mjs` checks the request/event ordering and boundary outcomes.

The [current official app-server reference](https://learn.chatgpt.com/docs/app-server) documents experimental `tool/requestUserInput`, `collaborationMode`, `command/exec` under a sandbox policy, approval requests, and `workspaceWrite.networkAccess`. This installed CLI's generated schema lists `plan` and `default` collaboration modes and accepts boolean network access on Windows. A default-mode intern turn in the earlier comparison said `request_user_input` was unavailable. In this gate, a read-only **Plan-mode** turn emitted a real `item/tool/requestUserInput` server request. The harness returned a clearly simulated answer, `serverRequest/resolved` arrived, and the **same turn** completed with a summary of that answer and no file edits. This proves the Plan-mode path on this version; it does not prove that a default-mode intern can use the same tool.

| Probe | Policy and target | Observed result |
| --- | --- | --- |
| Read-only write | `readOnly`, marker in `fixture/` | `Set-Content` denied; no marker. |
| Allowed project write | `workspaceWrite`, `cwd=fixture`, marker in `fixture/` | Exit 0; marker existed before cleanup. |
| Sibling write | Same workspace-write policy, marker in `sibling-probe/` | `Set-Content` denied; no marker. |
| Intern-style approval | Workspace-write thread with `on-request`, sibling marker | In-turn `item/commandExecution/requestApproval`; harness declined it; `serverRequest/resolved` arrived and no marker appeared. |
| Network off | Workspace-write `networkAccess:false`, curl HEAD to `http://developers.openai.com/` | Connection denied through the sandbox's dead proxy, curl exit 7, HTTP status `000`. |
| Network on | Same probe with `networkAccess:true` | curl exit 0, HTTP `308` redirect to HTTPS from the official host. |

The host baseline for the same official HTTP endpoint returned `308`. Earlier HTTPS probes inside the Windows sandbox reached a Schannel credential error with network on, so this gate uses a no-content HTTP HEAD only to test reachability. It does **not** establish that HTTPS package fetches work inside the sandbox. The local Windows `command/exec` rejected a custom `outputBytesCap`; the harness omits it. The first restricted task-shell runs needed authorized escalation for Codex's ordinary session storage, as noted above; no approval review rejected the later gate runs.

These are narrow checks, not a general escape audit. They do not test links/junctions, other path forms, other network clients or destinations, or access to files outside `codex-spike`. Official documentation says read-only can allow broad reads by default; this gate intentionally did not inspect any path outside the workspace. The app must make actual read scope, write scope, network permission, and approval decisions visible before claiming those controls work for a real user project.

**Recommendation for the user's protocol choice:** Prefer app-server as the MVP integration candidate because it has now demonstrated both live Plan-mode user input and live approval requests while preserving the chosen local Codex/Electron direction. Keep an end-of-turn blocked state for default-mode intern ambiguity until that role's in-turn input capability is proven or deliberately configured. `codex exec` remains a simpler verified fallback for stop-and-resume tasks. Before committing the choice, validate HTTPS/package access, read-scope restrictions, and approval policy with the exact shipping configuration. The website preview still needs isolation from Electron privileges. No final product protocol choice is made by this spike.

**Product decision after the spike:** The user selected local Codex app-server for the MVP. The remaining validation items above still apply before shipping.
