# The Boss's Office — MVP Specification

**Status:** Living MVP specification, updated 2026-10-08. Remaining choices are called out below.

## Decisions made so far

| Topic | Decision |
| --- | --- |
| Platform | Windows desktop app built with Electron. |
| Office | Simple rectangular space, first-person free walking, React Three Fiber over Three.js. |
| Project | One active project, user-chosen frontend website idea, Vite + React + TypeScript starter. |
| Agents | A hidden local Codex app-server process using the user's ChatGPT sign-in, with separate tech-lead and intern threads and live activity in the office. |
| Permissions | Tech lead may research on the web. Intern may edit the website and run sandboxed commands by default; the boss can turn website edits off for the next turn. Command internet and hosted research remain available. The boss can choose Ask me or Codex Auto-review for eligible tool permission requests. Plan approval and intern questions remain the boss's decisions. |
| Review | Boss-clicked Run starts an isolated in-app website preview; changed text files can be compared with the starter. Versioned work records and explicit accept/revise actions are implemented. |
| Input | Typed messages in the MVP. Push-to-talk speech is deferred to a later release. |
| Usage | Show Codex usage and warn the user; do not claim to impose an account spending cap. |

## 1. Purpose

Build a small, usable 3D office where an experienced web developer can direct AI agents while working through a website idea of their own. The first release should prove the complete work cycle: define a goal, reason with a tech lead, decide, delegate to an intern, resolve an escalation, review the result, and see the website run.

The office has a game-like feel, but users come here to work. There are no levels, scores, or win conditions.

## 2. MVP success condition

In one session, the user can:

1. Enter the office and describe any website idea within the MVP's supported technical scope.
2. Discuss the goal with a tech lead through text.
3. Reach and approve a plan containing the user's decisions and open questions.
4. Assign a bounded task to one intern.
5. Receive and answer an intern question or blocker when one genuinely arises; the app must never invent a blocker just to complete a scripted sequence.
6. Inspect the files the intern actually edited and run the resulting website.
7. Request a change or accept the work, while retaining a record of the decisions and task history.

The user should be able to explain why the website works as it does and identify which choices they made. This is a qualitative outcome, not a score the product must calculate.

## 3. First user and environment

- **User:** The creator, an experienced web developer.
- **Project type:** A frontend-only website idea chosen by the user, built in a sandboxed project workspace from one fixed [Vite + React + TypeScript starter](https://vite.dev/guide/). Backend services and databases are outside the first MVP.
- **App format:** A Windows desktop application built with Electron. The office UI uses React and React Three Fiber over Three.js for its 3D scene.
- **Movement:** The user walks freely through the 3D office in first person to reach work areas.
- **Office:** One simple rectangular 3D space with a boss's desk, meeting area, intern desk, and project board. Exact dimensions and visual style are open.
- **Agent team:** One tech lead and one intern in the first version. The design should not prevent adding more interns later.
- **Agent runtime:** The desktop app launches a local Codex app-server process in the background, using the user's existing ChatGPT sign-in and Codex plan allowance. The tech lead and intern have separate threads. Their activity appears in the office rather than separate CMD windows.
- **Project library:** One active website project at a time in the MVP.
- **Input:** Typed messages. Push-to-talk speech and transcription are outside this MVP.
- **Output:** Actual frontend files edited by the intern and a running website preview in a panel inside the office app.

## 4. Work areas and required actions

| Area | MVP actions |
| --- | --- |
| Boss's desk | Start/open a website project; inspect project status; open controls for agent permissions and limits. |
| Meeting area | Converse with the tech lead; ask for hints, research, pros and cons; review and approve the plan. |
| Intern desk | Assign a task; see its status; answer escalations; inspect completed work. |
| Project board | See the plan, decisions, unresolved questions, tasks, blockers, and completed work. |
| Website preview | Open an in-app panel showing the running site, inspect the result, then return to the office to request changes. |

The user moves in first person through the 3D office to reach these areas. Detailed writing, code review, and the website preview use readable panels over the scene. When a panel has focus, walking controls pause so typing and clicking in it work normally.

## 5. Agent behavior

### Tech lead

- Ask questions that reveal missing requirements, dependencies, trade-offs, and failure cases.
- Offer a hint or topic to research when the user is stuck.
- On request, research or explain options, including pros and cons and sources when applicable.
- Use web research by default when the user asks for current or external information, and show the sources behind the comparison.
- Ask the user to choose and explain consequential decisions. Record the choice as the user's.
- Produce a plan summary for user approval. Do not treat a suggestion as approved until the user confirms it.
- Use a read-only view of the project for planning and research; do not edit website files.

### Intern

- Work only from the approved task and project context.
- Edit the sandboxed website project files to implement the assigned task, subject to the user's permissions.
- Follow explicit instructions and established conventions for routine details.
- Pause and ask when instructions are unclear, something fails, or a new decision is needed.
- Present the problem, relevant evidence, and the choice needed from the user.
- After work, report changes and checks in a form the user can inspect.

### Codex app-server integration

Electron's main process should launch and monitor `codex app-server --listen stdio://` without opening a visible CMD window. It should initialize the local JSON-RPC connection, maintain a separate thread ID for each role, stream activity into the office, and route tool approval requests according to the boss's reviewer setting. The tech lead runs with read-only file access. The intern runs with write access limited to the sandboxed website project unless a reviewed request grants more. The app supplies each role's instructions and current approved context. If an intern asks a question in an ordinary message, the host records a blocked state and waits for the user's answer before starting the next turn. The office shows each role's current activity, progress events, blocker, and completed report; a detailed activity log should be available when the user wants to inspect it.

Electron's main process owns Codex process launching, project files, and the website preview lifecycle. The renderer uses React Three Fiber over Three.js for the first-person 3D office alongside readable React work panels. The preview now uses an isolated `WebContentsView` with no office preload or Node access. The boss explicitly clicks Run; a trusted Vite configuration serves the active website without loading intern-editable Vite, Babel, PostCSS, or npm scripts.

This is the chosen MVP protocol. The [local process spike](codex-spike/README.md) verified a signed-in Codex CLI and compared `codex exec` with app-server. The [office prototype](office-shell/README.md) implements a local app-server bridge for conversations, approval routing, intern dispatch, a boss-run website preview, structured work records, and an enforced website-edit switch. The boss chose to leave terminal-off and project-only read controls unavailable in the Windows MVP. Official [app-server documentation](https://learn.chatgpt.com/docs/app-server) describes the local thread, turn, event, and approval protocol. [ChatGPT pricing documentation](https://learn.chatgpt.com/docs/pricing) confirms that eligible ChatGPT plans can cover Codex usage, subject to plan limits.

**Spike and gate findings:** `codex exec` supported an end-of-turn blocker: both roles asked a structured persistence question without editing files, and the intern resumed after a simulated answer to edit only the disposable website. The fixture build passed. A local [Codex app-server](https://learn.chatgpt.com/docs/app-server) streamed events, produced an in-turn approval request, and produced an in-turn user-input request in Plan mode. A default-mode intern turn asked its question in an ordinary message. Narrow Windows probes inside the disposable spike folder denied read-only and sibling writes, allowed a write inside the fixture, and routed a sibling write to approval, which the host declined. Network off blocked a harmless HTTP HEAD; network on reached the official OpenAI docs host. HTTPS package access, read scope, and broader escape boundaries remain unverified. See the [comparison and limits](codex-spike/README.md).

## 6. Project records and states

The MVP needs these visible records:

| Record | Minimum contents |
| --- | --- |
| Project | Goal, current status, website preview/output reference. |
| Plan | Scope, approach, decisions, reasons, remaining questions, definition of done, approval state. |
| Decision | Question, options or context, user's choice, reason, time, related task. |
| Task | Goal, instructions, acceptance criteria, assigned intern, status. |
| Escalation | Blocker or ambiguity, evidence, question for user, answer, resolution state. |
| Work report | Changed items, checks performed, result, unresolved issues. |

Implemented task states are **ready → working → blocked → review → accepted**, with **paused** available before completion. Creating a task makes it ready; assignment is a separate boss action. Answering an ordinary blocker returns the task to ready for a fresh intern turn. Requesting a revision from review saves new instructions and returns the task to ready. A plan change requires approval of the new saved version before a new assignment.

The active website files, conversations, and Codex thread IDs persist under Electron's user data. A separate versioned work-record file there stores plan versions and approval, the boss's decisions and reasons, questions, tasks, escalations, work reports, and history outside intern-editable website files. An earlier approved plan is imported into a first version once. After restart, an unfinished turn is marked interrupted for the boss to review and reassign; an in-turn Codex request is not treated as still resumable. Focused storage tests pass, while a manual blocked/review restart walkthrough remains to be done.

## 7. Office controls

The intern may edit the website workspace, run commands inside its sandbox, and use the network there by default, including fetching frontend packages or resources. Access beyond the sandbox can require review. The tech lead may use web research by default. The user chose to keep command internet and hosted research available, so the office shows their status without a network restriction switch. The boss can turn intern website edits off; this applies a read-only Codex policy on the next turn, including a resumed thread. A disposable live probe confirmed that edits were denied when off and allowed when on. In Ask me mode, command, file-change, and built-in permission requests show their available action details for the boss to allow or decline. In Approve for me mode, Codex Auto-review decides eligible tool permission requests within the same sandbox boundary; a denial can still lead to a question for the boss. Changing modes restarts the hidden app-server while idle. The office does not change the user's global Codex config.

The current native Windows unelevated sandbox does not provide a verified project-only file-read boundary through this bridge. A disposable sibling-file probe was readable even under the read-only policy. An experimental custom permission profile for project-only reads was refused by Codex rather than run without enforcement. Terminal-off is also not offered as an enforceable switch because disabling the default shell tool does not rule out other configured tool paths. The boss chose to leave both switches unavailable for this Windows MVP. The office displays these limits instead of presenting inactive controls as protection.

The MVP office shows the signed-in Codex app-server's rate-limit windows and token activity at the boss's desk, with an 80% used warning for any reported window and a clear unavailable state for missing data. It does not cap subscription spending or override account limits. In Ask me mode, out-of-sandbox approval requests show the available action details and require an explicit boss choice; accepted built-in permission grants last one turn. In Approve for me mode, eligible requests go through Codex Auto-review and may still be denied or returned for guidance.

## 8. MVP boundaries

The first release focuses on one complete work cycle and one sandboxed frontend website project. The user supplies the idea; no fixed assignment is required. If an idea requires a backend or database, the tech lead should make that limitation visible and help the user choose a frontend-only slice. The MVP does not need a multi-project library, multiple office layouts, character progression, points, achievements, or multiplayer. Direct work on the user's existing repositories can follow after the contained workflow is proven.

## 9. Acceptance scenarios

1. **Planning:** The user describes a website feature. The tech lead identifies an important missing decision, offers options when asked, and records the user's chosen approach in an approvable plan.
2. **Escalation:** In a test task containing a real ambiguity or failure, an intern pauses, asks a specific question, and proceeds only after the user answers.
3. **Review:** The user can identify which files changed, inspect the website running, and request a revision tied to the original task.
4. **Continuity:** Closing and reopening the desktop app preserves the project files, plan, decisions, task, and escalation history.
5. **Control:** Changing an office permission or limit changes what an agent can actually do, and the current setting remains visible.
6. **Interaction:** The user can type and edit a message before sending it to either agent; no agent acts on an unsent draft.

## 10. Remaining decisions and implemented choices

### Immediate product decisions

1. **Preview isolation — implemented:** A separate in-memory `WebContentsView` with no office preload or Node access hosts the site. The user confirmed the generated website was viewable; revision and re-review still need an office walkthrough.

### Recorded design and technical decisions

2. **Implemented for the prototype:** WASD or arrow keys move within the rectangular office; mouse looks around, and work panels pause movement. Further collision polish can follow user testing.
3. **Implemented:** The one active project's files and separate work records live under Electron user data. The website runs only when the boss clicks Run, through a trusted preview server and isolated view.
4. **Implemented for this MVP:** The website-edit switch maps to per-turn Codex sandbox and approval settings. The permission reviewer choice maps to a process-local Codex override; a real disposable Auto-review turn crossed the sandbox boundary without an office approval prompt. Terminal-off and project-only privacy switches remain unavailable by the boss's choice.
5. **Implemented:** The app-server reports account rate-limit windows and token activity; the office warns at 80% used in a reported window.

The [MVP completion plan](MVP_COMPLETION_PLAN.md) tracks the remaining verification work.

### Desktop stack decision

| Option | Useful fit | Main cost |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/docs/latest/tutorial/process-model) + [web 3D](https://r3f.docs.pmnd.rs/getting-started/your-first-scene) | JavaScript app with a browser renderer and a Node-capable main process for local Codex processes. | Ships a Chromium-based runtime; the website preview must be isolated from privileged app code. |
| [Tauri](https://v2.tauri.app/start/) + web 3D | Web UI in a Windows WebView2 app with a Rust host and a smaller bundle. | Requires Rust and Windows build tooling; Codex process control crosses the web UI/native boundary. |
| [Godot](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_windows.html) + companion service | Dedicated 3D engine for free walking and scene interaction. | Text-heavy planning, code review, website preview, and Codex process integration need extra design. |

**Selected:** Electron with web-rendered 3D, because the user is an experienced web developer and the MVP needs local Codex process control alongside text-heavy work panels. Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security/) is especially relevant because the MVP displays a website whose files an agent can edit.

## 11. Proposed implementation sequence

1. **Codex process spike — completed:** A Node harness using the same process boundary as Electron's main process launched separate signed-in Codex sessions, captured JSON activity, stopped for a decision, resumed the intern, and built the disposable website. See [spike findings](codex-spike/README.md).
2. **Protocol and boundary gate — completed:** A local app-server comparison verified streamed events, a live Plan-mode user-input request, an in-turn approval request, and narrow Windows file and network boundaries against safe probes within `codex-spike`. The user selected app-server for the MVP. Default-mode intern ambiguity can use an end-of-turn blocked state; HTTPS package access, read scope, and broader escape behavior need validation in the shipping configuration.
3. **Office shell — completed:** The standalone [office-shell](office-shell/README.md) Electron app renders the simple room with React Three Fiber, bounded first-person walking, four interactable work areas, and readable panels. The Windows renderer build and Electron window were verified.
4. **Planning and delegation — implemented, full office cycle pending:** The office provisions one Vite + React + TypeScript website project, starts a hidden local Codex app-server, streams separate tech lead and intern conversations, saves plan versions and boss decisions, requires approval of the current plan before intern dispatch, and routes in-turn requests to the user. A live tech lead turn and bounded real intern turn passed; the user confirmed the agents work.
5. **Website work and review — implemented, revision check pending:** Boss-clicked Run starts a trusted Vite server and isolated `WebContentsView`; Stop and Refresh are available. A starter snapshot supports changed-text-file review. A disposable Electron smoke rendered the starter without office API or Node globals, and focused tests verified untrusted project config and npm scripts were not run. The user confirmed the generated website was viewable. Request revision, inspect the next result, and accept work still need an office walkthrough.
6. **Work records — implemented, restart check pending:** Versioned plan approval, decisions and reasons, questions, task states, escalations, reports, revision history, and explicit boss actions persist under Electron user data. Focused state tests cover blocked and review restart, interruption, and pause/resume. A disposable live Codex turn confirmed Pause. A manual blocked/review restart check remains.
7. **Office controls — implemented for the chosen MVP scope:** The website-edit switch applies a real per-turn sandbox change, including resumed threads. Ask me prompts for tool permission requests; Approve for me configures Codex Auto-review for eligible requests. A live disposable off/on edit probe, local reviewer-config smoke, and real boundary-crossing Auto-review turn passed. The boss chose to leave terminal-off and project-only file-read switches unavailable and command internet and hosted research available. Broader Windows path and HTTPS package checks remain for release verification.
8. **Usage — implemented:** The boss's desk shows available app-server account rate-limit windows and token activity, a refresh action, and warnings at 80% used. Focused parser tests and a live endpoint probe passed.
9. **Windows distribution — partial:** A portable Electron folder builds with the renderer, trusted preview runtime, and starter files. The packaged executable launched and its trusted preview served the starter. Startup checks for a missing CLI or ChatGPT sign-in. A packaged project-cycle walkthrough remains.

Speech input and transcription are deferred to a later release by the user's choice.
