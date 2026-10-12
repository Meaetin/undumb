# The Boss's Office — MVP completion plan

**Status date:** 2026-10-08  
**Scope:** One Windows desktop app, one active frontend website project, one tech lead, one intern. The boss chooses the idea and consequential decisions. No levels, scores, or multiplayer.

This file tracks implementation against [MVP_SPEC.md](MVP_SPEC.md). **Implemented** means code and focused checks exist. **Partial** means the feature works in a narrow path but does not yet meet the full MVP acceptance scenario. **Missing** means no usable implementation yet.

## Where we are

| Capability | Status | Evidence / gap |
| --- | --- | --- |
| 3D office and navigation | Implemented | Electron + React Three Fiber room, first-person walking, four work areas and readable panels. |
| One website project | Implemented | User idea creates a Vite + React + TypeScript starter outside the office source; a starter baseline is retained for review. |
| Local Codex team | Implemented | Separate tech lead and intern app-server threads, streamed messages/activity, user-routed requests, and a main-process gate requiring a project and approved plan before intern work. Live lead and bounded intern turns passed. |
| Planning and delegation records | Implemented, awaiting full workflow check | Versioned plan save and approval, decisions with reasons, questions, tasks with criteria and state, revision history, reports, and explicit assign/accept/revise actions are stored in project work records. The user confirmed the agents work; the complete revision cycle still needs an office walkthrough. |
| Intern escalation | Implemented, awaiting full workflow check | In-turn requests and ordinary blocked replies create task-linked escalation records. The boss can answer a blocker. A disposable live Codex turn confirmed Pause; the complete escalation/resume cycle still needs verification in the office. |
| Website preview and code review | Implemented | Boss-clicked Run/Stop/Refresh uses an isolated `WebContentsView`; changed text files can be compared with the starter. Focused tests and a disposable Electron preview smoke passed, and the user confirmed the generated website was viewable in the office. Revision and re-review remain to be checked. |
| Continuity | Implemented, awaiting restart check | One active project's plan versions, decisions, questions, task states, escalations, reports, and history are saved under Electron user data, separate from intern-editable files. A running turn becomes interrupted on restart; an in-turn request cannot be resumed automatically. Focused state tests pass; a manual blocked/review restart walkthrough remains. |
| Office controls | Implemented for chosen MVP scope; boundary checks remain | The boss can toggle intern website edits; a disposable live probe denied a write with edits off and allowed it with edits on. The boss can select Ask me or Codex Auto-review for eligible tool permissions without changing global Codex settings. A real disposable Auto-review turn crossed the sandbox boundary without sending an approval prompt to the office. Plan approval and intern questions stay with the boss. Command internet and hosted research stay available. Terminal-off and project-only privacy switches remain unavailable by choice. Broader Windows path and HTTPS package probes remain for release verification. |
| Usage | Implemented | The boss's desk reads signed-in app-server rate-limit and token usage endpoints, shows unavailable fields clearly, and warns at 80% of any reported window. A live endpoint probe and focused parser tests passed. The display does not cap subscription use. |
| Windows distribution | Partial | A portable Electron folder with the renderer, trusted preview runtime, and starter files builds on Windows. The packaged executable launched and the packaged trusted preview served the starter. Startup now identifies a missing CLI or ChatGPT sign-in. A full project cycle in the package still needs verification. |

## Remaining milestones, in order

### 1. Finish the complete visual work-cycle check

- The user has confirmed that the agents work and the generated website was viewable. Continue the same office journey through a requested revision and re-review of changed files.
- Exercise a real ambiguous task. Confirm the intern stops, shows a specific question, and resumes only after the boss answers.
- A disposable live Codex turn confirmed that Pause interrupts work and saves the task as paused without changing files. Check its office controls during the walkthrough. Fix any stale review data, server restart, or error-display problems found there. Keep the preview off until the boss clicks Run.

**Exit check:** The whole path works in one Windows Electron session with a disposable project, and the preview has no office API or Node access.

### 2. Verify durable decisions, tasks, and escalations

- Implemented: saved plan versions with approval tied to the exact version; decisions and reasons; open and answered questions; task states and criteria; task-linked escalations, reports, turns, and revision history. Actions include separate create/assign, pause/resume, answer blocker, request revision, and accept work.
- Work records are stored under Electron user data outside the website sandbox. Earlier approved-plan text is imported once into a first plan version while existing conversations remain available.
- Manually restart at a blocked task and a review-ready task. Check that the decision trail remains clear and that a live in-turn request is marked interrupted rather than shown as resumable.

**Exit check:** Restart at both a blocked task and a review-ready task without losing the decision trail or confusing the intern's next instruction.

### 3. Finish office controls and boundary checks

- Implemented: the boss's desk shows an intern website-edit switch. The bridge saves it outside the website and applies the corresponding read-only or workspace-write policy to each turn, including resumed threads. A disposable Windows live probe confirmed a denied edit with the switch off and a successful edit with it on.
- Implemented: Ask me mode displays available command/path/host details and requires an explicit boss choice for tool permissions. Approve for me mode sends eligible permission requests to Codex Auto-review while keeping the same sandbox; changing mode restarts the hidden app-server when idle. A real disposable turn first hit a sandbox denial, then completed an approved sibling-file write with no office approval request. Plan approval and intern questions always remain with the boss. Keep checking that incomplete requests fail closed.
- The user chose to leave command internet and hosted web research available; no network restriction switch is needed for this MVP. The office shows their availability without implying command network policy controls hosted search.
- The boss chose to keep terminal-off and project-only privacy switches unavailable in this Windows MVP. A disposable sibling-file probe confirmed the current read-only policy can read outside the website project. An attempted project-only permission profile failed closed because this machine's native Windows unelevated sandbox cannot enforce the split read rules. Validate broader Windows path escapes and HTTPS package access before release; offer either switch in a later version only after proving enforcement.
- Keep the preview's website process separate from privileged office controls; do not run intern-editable npm scripts or Vite/Babel/PostCSS config in the app's trusted Node context.

**Exit check:** The website-edit switch changes the result of the same safe probe; terminal and read-scope controls are offered only when their enforcement is proven. Declined out-of-scope actions leave no marker behind.

### 4. Show Codex usage and warnings

- Implemented: read account rate-limit windows and token activity through the local app-server. Label unavailable data honestly.
- Implemented: show usage at the boss's desk and warn at a stated 80% threshold. This does not cap subscription spending.

**Exit check:** The displayed data matches its source, warnings trigger at the configured threshold, and an unavailable source produces a clear state.

### 5. Package and verify the Windows MVP

- Implemented: produce a portable Windows folder that includes the office renderer, trusted preview runtime, and starter files. Startup detects a missing CLI or ChatGPT sign-in with actionable setup guidance. The packaged executable launched and the packaged preview served the starter from its own files.
- Run the MVP acceptance scenarios from [MVP_SPEC.md](MVP_SPEC.md): planning, real escalation, review/revision, restart continuity, and enforced controls.
- Verify the boss can identify which decisions they made, what the intern changed, how the website works, and what remains unresolved. This is a qualitative check, not a score.

**Exit check:** The packaged app completes one project cycle on Windows without requiring the source checkout or a developer terminal.

## Next action

Run the pending revision, escalation, and restart walkthroughs in the packaged office when ready. Keep the preview off until the boss clicks Run. Broader Windows path and HTTPS package probes remain part of release verification. Speech input is a later feature outside this MVP. The [office-shell README](office-shell/README.md) explains how to run the current app.
