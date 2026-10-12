# The Boss's Office — character interaction redesign

**Status:** Planning draft, updated 2026-10-08 with the boss's first scope decisions. Items marked **Open** need a product decision before implementation. No redesign code has been built from this document yet.

## Intent

Replace the current work-area panel UI with a game-like office where the boss walks up to visible AI coworkers and talks to them as characters. The office is viewed in third person, with the feel of moving around a Pokémon or Animal Crossing space. The conversations still drive real project planning, implementation, approvals, review, and records. The visual layer must show the actual state of the underlying work.

The existing product rule still applies: the boss owns product and engineering decisions. Agents ask, explain, implement delegated work, and surface blockers. A friendly dialogue line must never imply a project, plan, permission, or merge was chosen without the boss doing so.

## What the boss should experience

### Entering and moving around the office

- See the boss's character from a third-person camera and walk through the office.
- See animated 3D characters for the tech lead, intern(s), and eventually a code reviewer. Free character assets with usable animations will be sourced and checked before integration.
- Approach a character and interact within range. The interaction should make the intended target clear and prevent accidentally opening another character's conversation.
- Movement pauses or changes appropriately while a dialogue or focused input is open. Keyboard control moves to the dialogue choices or text field; it returns to movement on close.
- Use a fixed-angle follow camera for walking. Movement follows the screen, and entering dialogue keeps the walking view. The exact angle, interaction key, visual style, and character placement are **Open**.

| Camera style considered | Movement of the view | Effect in the office |
| --- | --- | --- |
| **Fixed-angle follow — chosen** | Tracks the boss while facing the same direction | Keeps the room layout stable; furniture may hide the boss. |
| Rotating follow | Tracks behind the boss as the boss turns | Emphasizes walking as a character; the view may swing often near desks. |
| Free orbit | Tracks the boss while a separate control rotates the view | Allows inspection of the space; asks the player to manage another control. |
| Room-based framing | Moves to a composed angle for each work area | Keeps conversations and desks visible; camera transitions need care. |

Movement is **screen-relative**: a directional input moves the boss in that direction on the screen under the fixed camera. Dialogue keeps the same walking view while the bottom box opens; it does not switch to a close-up camera.

### A shared dialogue language

- Interaction opens a dialogue box at the bottom of the screen. Longer text, permissions, file changes, and code will need a readable expanded view. Image content is planned after the MVP.
- Use a dialogue box at the bottom of the screen. It shows who is speaking, the current message, and the current action or response choices. The boss can move backward and forward through agent messages without losing the active conversation position. New messages remain visibly marked when viewing earlier ones. A small character bubble may still be used as an ambient cue, but the bottom box is the chosen conversation surface.
- Choices support keyboard navigation with up/down and Enter as a secondary input, as well as mouse interaction. The action being confirmed must be explicit.
- In the MVP, the freeform input field supports typed and pasted text. Pasted images and dictation remain on the full roadmap after the MVP. The eventual image and speech flows should feed the same conversation record.
- While an agent turn is running, show a thinking/loading state tied to real turn activity. A finished message, blocker, failure, and interrupted turn must look different.
- Conversation history should survive app restart and stay linked to the correct project, agent, task, and plan version.
- Dialogue copy can vary in personality, but status, permission, and review labels must remain precise. Intro lines are examples, not fixed scripts.

### Tech lead interaction

1. On approach, the tech lead opens with a project question, such as “What project are we working on today?”
2. In the MVP, show a project picker containing registered projects plus **Start new** and **Skip**. The app's default base path is an app-owned dot directory, like the directory conventions of `.codex` and `.claude`; its exact name and placement are **Open**. The boss can add external paths in Settings so they appear in the picker. Start new creates a project folder under the app base directory. Skip selects no project and uses a scratch folder there as the CLI working directory. Selecting a project authorizes the agent to work within that selected project; actions outside the active project or scratch location ask permission. The current Windows read-boundary limitation is noted below.
3. After a choice, move into a conversational prompt such as “What shall we work on today?” Vary the greeting so repeat visits feel natural.
4. Accept the boss's prompt through the shared text/input flow, show live thinking/activity, and continue the conversation.
5. Preserve user-owned decisions, reasons, open questions, and saved plan versions. The boss can send a raw message to an intern and start work immediately without first saving and approving a plan or filling out a task form. That message creates a board item in **WIP** without requiring an existing approved plan.

### Hiring interns

1. Open a **Hire intern** UI. Hiring provisions an independent CLI-backed agent session and makes that intern's 3D character available in the office. Whether this means a dedicated CLI process per intern or separate sessions on one app-server is **Open**.
2. Select the project the intern will work on. The selected project and actual working path remain visible in the hire UI.
3. Choose **Direct** or **Worktree**. Worktree mode is disabled if the selected folder is not a usable Git repository; it does not silently initialize Git. Each hired intern in Worktree mode gets a separate worktree, even when several interns work on the same project.
4. Optionally attach an unassigned item from the board. The boss then clicks **Hire** to create the intern and start that work. If no item is attached, the intern waits for a raw message and becomes idle after five minutes without work. The desired behavior is to keep its saved context available: a dedicated interactive CLI could be closed and reopened with its session ID; a shared app-server could leave that intern's thread idle and resume it. The process model remains **Open**.
5. The boss can walk up to a hired intern, interact, and send a raw message. Sending it starts work immediately and creates a WIP board item, without requiring an approved plan.

| Intern state | Visible behavior | Entry |
| --- | --- | --- |
| Vacant | Seat has no hired intern | Before Hire. |
| Hired, waiting | Character is present and can be spoken to | Hire without an attached item. |
| Idle | Character remains interactable; no work is running | Five minutes pass without assigned work. |
| Working | Character works at the desk; assigned board item is WIP | Hire with an item, or a raw message to a waiting/idle intern. |
| Needs boss | Character walks to the office queue with `!` | A genuine blocker, permission request, or decision. |
| Review ready | Character walks to the office queue with completion feedback | Real work finishes and a report is saved. |

The visible state must follow the actual agent/task state. Going idle must not discard the intern's conversation or make a pending request disappear.

### Intern interaction and work

1. Approaching a hired intern opens a role-specific greeting, for example “What can I do for you, boss?” An idle intern can be given new work through this interaction.
2. The boss can send a raw message to an intern or choose an unassigned work item from the project board. A raw message starts the intern immediately, with no separate plan approval or task form; it creates a WIP board item from the boss's message. An existing approved plan is not required.
3. The intern starts from the boss's raw message or selected board item and any applicable project context. The seat has a PC. The preferred visual is the exact live TUI on its monitor, if a faithful and legible feed is technically possible. If that is unsuitable, show a status or progress indicator above the character. The fallback must not invent a percentage or time remaining when the runtime does not provide one.
4. For a blocker, permission request, or needed decision, the intern comes to the boss's office with a persistent **!** marker. Interacting shows the obstruction, evidence, and available responses. Up/down and Enter can choose a response; the boss can also type an answer when needed.
5. The intern waits at the boss's office until the boss interacts. After the answer is recorded and the work can resume, the intern returns to the desk. Denial, pause, failure, and unresolved blockers need distinct outcomes rather than an automatic return-to-work animation.
6. On completion, show an available happy/sparkly reaction and have the intern visit the boss. It waits there until the boss interacts. Interaction opens the real work report: what changed, checks run, unresolved items, and links to inspect the result, as the existing documents require.
7. The boss can then choose a next action such as **Continue with new task** or **Skip**. **Send to code review** becomes an actionable choice when the later reviewer milestone exists. “Continue” must not silently accept or merge the completed work.

### Code reviewer / DevOps character

- A separate role is intended for creating pull requests, reviewing changes, handling merge conflicts, and merging to the main branch. It is a later milestone, outside the redesigned MVP.
- The handoff begins after the boss has reviewed the intern's report. The reviewer must have access to the exact change set and project/branch identity, and its findings must be inspectable before a merge.
- The reviewer may create PRs and review code as its routine actions. Conflict resolution and merge require the boss's decision. Branch strategy, remote hosting, and the exact review handoff remain **Open**.
- The current contained Vite starter has no defined Git remote or PR workflow, so a real PR path needs a project/repository milestone. The reviewer can first be introduced through a local review handoff if the boss chooses that scope.
- The reviewer is a proposed addition to the existing tech-lead and intern roles; its exact personality and location in the office are **Open**.

### Project board and office controls

- The board is durable storage for work that needs doing. Items can come from a plan made with the tech lead and not yet assigned, a bug found by the later code reviewer and not yet fixed, or an item the boss asks an agent to add. Each item needs its source and current status visible.
- The board has a **WIP** section. When the boss attaches an unassigned item during hiring or gives it to an existing intern, it shows the assigned intern and moves to WIP when work starts. A raw message to an intern creates a new item directly in WIP, tied to the exact message, project, and intern. Blocked, review-ready, and completed states come from the same task record used by dialogue and agent dispatch. A suggestion does not become assigned merely because an agent made it.
- Characters surface urgent events, while the board lets the boss find work, blockers, decisions, and reports later. Start with three interns, subject to the office layout. Interns with blockers or completion reports walk to a designated waiting area, form a queue, and wait for individual interaction. The pathing and queue spacing are part of the scene implementation; exact layout is **Open**.
- Settings shows the app-owned dot directory as the base path and lets the boss **Add paths** outside it to the MVP project picker. Selecting a registered path authorizes work within that project; other paths still require permission. A hire-time toggle chooses direct work in the selected folder or a Git worktree. Worktree mode is disabled for a folder without usable Git history; each intern choosing Worktree gets its own checkout. Whether the app base path itself can be moved is **Open**.
- Keep the current distinction between user decisions, agent suggestions, and unresolved questions. A dialogue choice should update the same durable records the board displays.
- Agent permissions, Codex usage, and warnings still need a clear office location. Existing Ask me / Auto-review behavior applies to eligible tool permission requests only; plan and product decisions still belong to the boss.
- The website preview and changed-file inspection still need a readable focused view. Their exact entrance from the new dialogue is **Open**.

## Existing baseline and change impact

The current Windows prototype uses Electron, React, React Three Fiber, and a hidden local Codex app-server. It has first-person walking and clickable work areas, one active sandboxed frontend project, separate tech-lead and intern threads, streamed activity, a board, work records, an isolated website preview, file comparison, and approval routing. Its project, plan, task, escalation, report, and permission behavior should be reused where it matches the new experience.

| Current implementation | Redesign impact |
| --- | --- |
| First-person camera and geometric work-area markers | Third-person boss avatar, camera, character proximity, and animation states. |
| Large area panels for boss, lead, intern, board | Character dialogue plus focused views for long or structured content. |
| One active Vite starter project in an app-owned fixed folder | App-owned dot directory, added external paths, direct/worktree hire mode, and no-project scratch conversation require new project state and boundaries. |
| Two role threads: lead and intern | Hire-time independent intern sessions, up to three initial characters, and the later reviewer require agent identity beyond the current two-role type. |
| Saved plan, tasks, escalations, reports | Dialogue and board must read and update the same durable records; raw messages create WIP items without plan approval. |
| Activity summaries from Codex app-server | TUI monitor feasibility must be checked against the actual data/terminal surface available. |
| Isolated website preview and file comparison | Need a clear handoff from character dialogue to readable review. |

The previous [product concept](PRODUCT_CONCEPT.md), [MVP specification](MVP_SPEC.md), and [completion plan](MVP_COMPLETION_PLAN.md) describe the existing first-person, panel-based prototype. This document supersedes their **interaction and camera direction** for the redesign. It does not claim the earlier MVP acceptance checks have been completed.

### Current task gate and Skip choices

Today the app stores an approved plan version, then a task with a title, instructions, and acceptance criteria. The boss creates the task and separately assigns it; only then can the intern's Codex turn start. Raw messages to the intern are rejected. The redesign removes that gate for raw messages: a boss message starts work immediately and creates a WIP board record tied to the intern and project. It does not need an approved plan. The work record may retain the original text without inventing acceptance criteria.

Today every agent turn needs an active project root as its working directory. **Skip** instead uses a persistent scratch folder within the app-owned dot directory, without presenting it as a selected project. Interns may work there rather than being limited to planning chat. A selected project, including an added external path, is the intern's authorized work location. The boss allows working actions within it; actions elsewhere ask permission. The current Windows prototype cannot enforce a folder-only **read** boundary; the UI must not promise a prompt before every out-of-folder read until that enforcement is demonstrated.

## MVP for this redesign — agreed scope, with open interaction details

The boss wants the character-led tech-lead and intern work cycle to function end to end, rather than stopping at a visual prototype. The MVP uses text input, a fixed-angle follow camera with screen-relative movement, the same camera view during dialogue, a project picker with existing registered folders plus Start new and Skip, an app-owned dot directory as the base path, a direct/worktree toggle when hiring interns, scratch for Skip, immediate raw messages that create WIP board items without plan approval, and a genuine blocker. A **Hire intern** flow provisions up to three initial interns if the office layout supports them; an unassigned hire waits and becomes idle after five minutes. Pasted images, dictation, and the code reviewer belong to later milestones.

**End-to-end result:** Walk the third-person boss to a tech lead, pick a registered project, start a new one, or skip selection; converse and save/approve a plan when desired; hire an intern by selecting a project and direct/worktree mode and optionally attaching board work; or hire without work, then approach the waiting intern and send a raw instruction that starts immediately. See a WIP board item and real activity, receive and answer a genuine blocker, inspect the finished work, and choose what happens next. Other interns can work and then queue for attention. The conversation, task, and decision trail survive restart. The acceptance walkthrough will use a real ambiguous or blocked task; the app must not fabricate a blocker.

### MVP phases

| Phase | Visible result for the boss | Completion check |
| --- | --- | --- |
| 0. Lock the interaction contract | A short playable/storyboarded route through lead, intern, blocker, and completion, with dialogue states and controls agreed. | The boss can say what appears at each step and what happens after each choice. |
| 1. Third-person office slice | Move an avatar with screen-relative controls, approach visible lead/three-intern characters, interact through the bottom dialogue box without changing the camera view, and return to movement. | Camera, proximity, keyboard focus, collision, and model/animation use work without changing agent records. |
| 2. Tech lead dialogue and project entry | View the dot-directory base path or add external paths in Settings; pick a registered project, create a project under the dot directory, or Skip to scratch; send text, view thinking and reply, browse history, and reach plan/decision actions. | One real lead turn works through each entry path; project context stays distinct; optional plan approval remains visible; unsupported preview assumptions are shown honestly. |
| 3. Hire, board, and intern work | Choose a project, use direct mode or a separate Git worktree, optionally attach board work, and click Hire. An unassigned intern waits, goes idle after five minutes, and can later receive a raw message that starts immediately. | Hire creates a distinct agent session and character; non-Git folders disable Worktree; each worktree intern gets a distinct checkout; attached work or a raw message enters WIP without a plan gate; concurrent intern state is not mixed; no fake progress is shown. |
| 4. Escalation and completion | Interns walk to a designated office queue and wait for interaction with a genuine blocker or report; boss answers or inspects each one and chooses the next action. | A deliberately ambiguous or blocked real task produces a genuine question, then resumes correctly; a completed report points to real files and checks; several waiting interns stay distinct. |
| 5. Persistence and full-cycle check | Reopen the office and continue at the right project, dialogue, task, and review state; finish a real task through inspection and next-action choice. | Restart during blocked and review-ready states preserves history, and a full Windows session completes the cycle without implying an old live request is still open. |

**MVP feedback priority:** The intern desk first attempts a faithful live TUI. If it cannot be made useful, the agreed fallback is an indicator based on real status, without invented time remaining. The models and animations can be built in stages within the MVP, but the final cycle includes visible 3D characters. The visual acceptance bar is **Open**.

## Full implementation map

This is an ordered map of work, not a promise that every detail is settled. Each gate produces something the boss can see or try; technical tasks sit underneath that visible outcome.

### A. Experience and visual specification

- Draw the office route, three intern desks, and designated boss-office queue around the chosen fixed-angle follow camera. Use screen-relative movement and keep the walking view during dialogue. Decide interaction radius/cue and how the boss returns from focused views.
- Prototype the chosen bottom dialogue box with a real-length agent response, choices, permission details, and a long work report. Explore supplementary character bubbles later if useful.
- Define visual states for idle, available, thinking, working, blocked, approval needed, failed, paused, review ready, and complete. Define motion/emotion cues only for states that the app can verify.
- Define keyboard focus order and readable text sizes, including arrow navigation, Enter, Escape, mouse, and text composition behavior.

### B. Scene, models, and movement

- Replace first-person camera logic with a third-person boss controller, visible avatar, follow camera, room collision, and interaction detection.
- Source free models/animations for each role; record license, attribution, redistribution terms, polygon/texture size, skeleton compatibility, and available idle/walk/talk/emotion clips.
- Add animation state changes for conversations, walking to desks, boss visits, blocked markers, and completion reactions. Add route/pathing behavior for up to three interns moving between desks and the designated office queue without overlapping or blocking interaction.
- Keep character motion driven by durable task/agent state so scene reloads do not misrepresent work.

### C. Dialogue system and agent bridge

- Build a reusable dialogue view for speech, choices, free text, thinking/activity, attachments, message browsing, and recovery from errors/interrupted turns.
- Route interactions to the existing lead/intern app-server threads and persisted messages. Separate what the agent said from task/plan/permission actions that require explicit user selection.
- After the MVP, add clipboard image intake and storage/transport. Add dictation and an editable transcript after the speech approach is decided.
- Ensure a new message arriving while browsing older messages is discoverable and does not force the view away from what the boss is reading.

### D. Projects, plans, and board

- Establish the app-owned dot directory as the default base for new projects, scratch, and office data. Show it in MVP Settings and let the boss add external project paths to the picker. The exact dot-directory name and placement, and whether its base location can move, remain open.
- Build **Hire intern** with project selection, a direct/worktree toggle, optional board-item attachment, and Hire. Disable Worktree for a non-Git project or a repository without a usable base commit. Keep the actual active path visible before work starts.
- Define how worktree mode creates and tracks a separate checkout for each intern, which project and branch it belongs to, and how changed files, preview, plans, and conversations bind to it. Switching modes during active work must not silently move or discard changes.
- Decide what project types import accepts. The current preview and changed-file comparison assume a Vite starter with a saved baseline; an imported folder may need a different run command and review basis. The picker should communicate what the office can do for each registered folder.
- Replace the raw-message intern gate so a boss message starts a turn immediately. Preserve the raw wording and create a WIP board record in the same action without a second confirmation or approved-plan requirement.
- Store board items from lead plans, later reviewer bugs, and explicit boss requests to agents. Show source, ownership, and unassigned/assigned/WIP/blocked/review/completed state; prevent an informal board note from silently becoming executable work.
- Keep plan versions, user decisions, approval, task criteria, escalation answers, and work history synchronized with the dialogue flow.

### E. Intern work and desk feedback

- Provision an independent agent session per hired intern. An attached board item begins work after Hire; a hire without work waits for an interaction and becomes idle after five minutes without work. Persist the session/thread ID and project/worktree binding so the same conversation can resume. If the chosen runtime is an interactive CLI per intern, close only an idle process and resume it by ID on the next interaction; never stop an active turn or pending approval merely because the five-minute timer fired. If the runtime is the shared app-server, keep that intern's thread idle while other interns continue.
- Connect intern dispatch and status to character location and PC feedback. Probe whether the exact TUI can be displayed legally, safely, and legibly from the runtime available to the office.
- Include a small feasibility spike for an interactive CLI connected to app-server over its supported remote transport. This might provide a literal TUI while the office retains structured events, but simultaneous control and monitor capture must be proven before choosing it.
- If TUI display cannot meet that bar, show actual event/status summaries. Show a time or percent estimate only if the data source makes it meaningful.
- Implement blocker arrivals, persistent markers, a physical office queue for three interns, answer choices, continuation, pause, failed turn, and completion visits. Interns wait until the boss interacts with each one. Keep simultaneous requests tied to the correct intern and task.
- Preserve the existing preview and file-diff inspection as part of the completion conversation.

### F. Code reviewer and repository workflow

- Define repository eligibility, branch/worktree ownership, remote provider, and how one intern's work becomes a reviewable change set.
- Create a reviewer agent identity and handoff record; connect its findings to the task, plan, and exact files/commit/PR.
- Add separate commands for create PR, review, request revision, resolve conflicts, and merge. Make status and consequences visible to the boss at each step.
- Verify conflict handling and merge outcomes against a disposable repository before connecting the boss's real projects.

### G. Reliability and release

- Check restart behavior at every dialogue/task state, including pending permissions and a character mid-route. Restart must restore the truth, not replay a stale live request.
- Check that keyboard commands cannot move the avatar while typing or selecting a response, and that a permission choice cannot be triggered by a stray Enter.
- Verify the preview remains isolated from privileged office code, and project/context switches cannot mix messages or files between projects.
- Complete the existing packaged Windows work-cycle checks, then test the redesigned cycle in the portable app.

## Decisions to make before implementation

1. Where should the app-owned dot directory live, what should it be called, and is its base location fixed or movable?
2. Does “anything” inside a selected project include destructive actions such as deleting files or rewriting Git history without an additional boss decision? The selected project is the authorized scope; outside actions still request permission. The current Windows read boundary cannot promise prompts for every read.
3. Does **Hire** create a dedicated interactive CLI process for each intern or a separate agent thread on the existing shared app-server? Both can resume saved context; only the interactive CLI exposes a literal TUI.
4. What should happen if the boss changes Direct/Worktree mode while work is active or unreviewed changes remain?
5. How should three interns be ordered and spaced in the designated queue if they arrive close together?

These questions are deliberately kept open. The plan can be revised phase by phase as the boss decides.
