# The Boss's Office — redesign decisions

Decisions below are the boss's stated direction. The end-to-end MVP scope is agreed at a high level; remaining interaction details are tracked in [the redesign brief](../AGENT_INTERACTION_REDESIGN.md).

- 2026-10-08 — Replace the current work-area UI with NPC-like character conversations — “walk up to the 3D models, and interact with them” — decided by: you.
- 2026-10-08 — Change the office from first-person to third-person movement with a Pokémon/Animal Crossing feel — decided by: you.
- 2026-10-08 — Tech lead starts with project choice, including Start new and Skip/no project, then continues into work conversation — decided by: you; the MVP project behavior is clarified below.
- 2026-10-08 — Dialogue should support message back/forward browsing, choice navigation with arrow keys and Enter, typed/pasted input including images, and desired dictation — decided by: you; the MVP input scope is clarified below.
- 2026-10-08 — Interns should come to the boss with a visible ! when blocked, return to work after resolution, and visit again with a report when done — decided by: you.
- 2026-10-08 — Prefer an exact TUI on intern desk PCs; use a progress indicator only if that cannot work — decided by: you; feasibility and availability of real time estimates remain open.
- 2026-10-08 — Add a code reviewer/DevOps role for PRs, code review, conflict resolution, and merges — decided by: you; later scope and authority are clarified below.
- 2026-10-08 — The redesigned MVP must complete the tech-lead and intern interaction end to end — decided by: you; a genuine blocker is included, as recorded below.
- 2026-10-08 — Start new creates a folder for a new project; Skip selects no project; existing-folder selection was initially deferred — decided by: you; later settings and scratch decisions below refine this.
- 2026-10-08 — Text is the MVP input; pasted images and dictation come later — decided by: you.
- 2026-10-08 — The code reviewer is a later milestone; it may create PRs and review code, while conflict resolution and merges need your decision — decided by: you.
- 2026-10-08 — Use a bottom-screen dialogue box — decided by: you; later camera decisions below refine this.
- 2026-10-08 — An intern can begin from a freeform instruction — decided by: you; later direct-dispatch decision below refines this.
- 2026-10-08 — Interns wait for your interaction after coming to your office with a blocker or completion report — decided by: you.
- 2026-10-08 — Use a fixed-angle follow camera — decided by: you; later movement and dialogue decisions below refine this.
- 2026-10-08 — Include a genuine intern blocker and answer in the redesigned MVP walkthrough — decided by: you.
- 2026-10-08 — Let the user set the location when Start new creates a project folder — decided by: you; superseded by the later dot-directory base and added-path choices below.
- 2026-10-08 — Treat the board as storage for work to be done: unassigned tech-lead plan tasks, later code-review bugs, and items you ask agents to add; show assignment and work-in-progress status when handed to an agent — decided by: you.
- 2026-10-08 — Interns needing attention queue at your office, and you interact with them one by one — decided by: you; later count and pathing decision below refines this.
- 2026-10-08 — Movement follows the screen under the fixed camera, and dialogue keeps the walking view — decided by: you.
- 2026-10-08 — Skip uses an app-owned scratch folder; agents may work there as needed — decided by: you; access beyond scratch remains open.
- 2026-10-08 — A raw message to an intern starts work immediately without requiring a saved plan, approval, or completed task form first — decided by: you; later WIP board decision below completes this flow.
- 2026-10-08 — Put **Select base path** and **Import paths** in Settings so the boss can choose where to work and add folders — decided by: you; later dot-directory base decision below updates the base-path behavior.
- 2026-10-08 — Start with three interns, subject to map layout; program them to walk to a designated office area and form a queue — decided by: you; queue order and spacing remain open.
- 2026-10-08 — Include a project picker in the MVP so existing registered folders can be selected, alongside Start new and Skip — decided by: you; this updates the earlier deferral of existing-folder selection.
- 2026-10-08 — Add a toggle to work directly in the selected folder or use a Git worktree — decided by: you; later hire-flow decision below places the toggle at hiring.
- 2026-10-08 — Add a **Hire intern** UI: select project, choose direct or worktree mode, optionally attach a board item, then click Hire to provision the agent and its 3D character — decided by: you.
- 2026-10-08 — Disable the worktree option when the selected folder is not a usable Git repository — decided by: you; multiple-intern worktree ownership remains open.
- 2026-10-08 — A hired intern with no assigned work waits for a raw message and becomes idle after five minutes; the boss can interact with it later — decided by: you; whether idle stops its CLI process remains open.
- 2026-10-08 — Add a WIP board section and create a WIP item when a raw message is sent to an intern, without requiring an existing approved plan — decided by: you.
- 2026-10-08 — Use an app-owned dot directory as the default base for office data, projects, and scratch; allow added external paths to appear as project choices — decided by: you; dot-directory name/location and selected external-path permission scope remain open.
- 2026-10-08 — Require agents to request permission for work outside their authorized folder — decided by: you; the current Windows runtime cannot enforce folder-only reads, so implementation must not promise an unreadable outside path until verified.
- 2026-10-08 — Selecting an added external project path authorizes the intern to work within that project; actions outside the selected project or scratch still ask permission — decided by: you; whether destructive in-project actions get extra review remains open.
- 2026-10-08 — Give each intern a separate Git worktree when multiple interns choose Worktree mode for the same project — decided by: you.
- 2026-10-08 — Preserve an intern's context across idle shutdown/restart if a dedicated interactive CLI is used; do not close an active turn at the five-minute mark — decided by: you; dedicated CLI versus shared app-server remains open.

## Electron GUI direction

- 2026-10-11 — Continue Boss Office as a separate Electron GUI with project chats and an Office view instead of the 3D space — decided by: you.
- 2026-10-12 — After the tech lead has resolved its clarifying questions, it tells you it understands and creates a Markdown task without a separate approval click — decided by: you; accepted risk: the lead may judge the discussion complete earlier than you intended.
- 2026-10-12 — Keep app data locally. Each project has a `plans` folder under app data for task Markdown, outside the user project folder and Git; database storage comes later — decided by: you.
- 2026-10-12 — Each task Markdown file has a task heading and an implementation body; the whiteboard lists headings and opens the full content when clicked — decided by: you.
- 2026-10-12 — An intern chat can include text and an attached task; pressing Send gives the intern the task and starts work — decided by: you.
- 2026-10-12 — A task has one assigned intern at a time; another intern can receive it only after the first intern is removed from the session — decided by: you; close behavior during active work remains to be defined.
- 2026-10-12 — Stopping an intern should interrupt its current work and allow continuation in the same context. After completion, you may keep chatting or attach more tasks in that context, or clear the context for a new task while preserving the visible chat and terminal history — decided by: you; exact controls and interrupted-work behavior remain to be defined.
- 2026-10-12 — Idle agents should eventually close to avoid unnecessary memory use — decided by: you; timing and interaction with the shared app-server remain to be defined.
- 2026-10-12 — Closing an intern session, including after an interruption, does not release its task assignment; the same intern can resume that task — decided by: you; this refines the earlier reassignment rule, and a separate way to release a task remains open.
- 2026-10-12 — Each task should have its own Git branch so agents working on different tasks do not interfere with the same files — decided by: you; branch workspace and starting-point behavior remain open.
- 2026-10-12 — Clearing context starts a fresh AI chat for the same intern while its previous chat and terminal history remain visible as a past session — decided by: you.
- 2026-10-12 — Close an idle agent session after ten minutes; when all agents are idle, stop the shared AI process and restart it on the next message — decided by: you.
- 2026-10-12 — Show recent and past sessions for both tech lead and interns in a sidebar; clicking one continues it, while starting a new session starts a new chat or task — decided by: you.
- 2026-10-12 — Give the tech lead access to all task Markdown files for its project; when an unfinished task is relevant to a new planning discussion, it asks whether to update that task or create a new one — decided by: you.
- 2026-10-12 — For a project without Git, show an alert with an Initialize Git button; if you decline, interns work directly in the default project folder without branches — decided by: you; simultaneous non-Git work remains open.
- 2026-10-12 — Show the intern's current assigned task in its chat, with a way to remove the assignment. Selecting a task held by another intern prompts to remove it from that intern and start fresh with the selected intern — decided by: you; handling partial branch work remains open.
- 2026-10-12 — When a task Markdown file changes during intern work, send the intern a note in the same session to reread the task, assess whether completed work is affected, and realign its plan — decided by: you.
- 2026-10-12 — Use both a branch and a separate Git worktree for each Git-backed task so concurrent interns have isolated file copies; let a dependent task wait for its source task, then select which finished branch to start from — decided by: Claude after you requested guidance; handling uncommitted source work remains open.
- 2026-10-12 — An intern commits the files it changed when it finishes its task, so a dependent task can start from that branch's committed work — decided by: you.
- 2026-10-12 — If a project is not Git initialized and you decline to initialize it, allow multiple interns to work concurrently in the same default project folder — decided by: you; accepted risk: their edits can overwrite one another.
- 2026-10-12 — Compacting or clearing an intern's chat preserves its assigned task and edited files; clearing starts fresh chat context in the same task workspace, while past chat and terminal history stay visible — decided by: you.
- 2026-10-12 — Reassigning a task to another intern starts fresh for both chat and files; the previous intern's task branch and worktree remain as historical work rather than becoming the new intern's starting point — decided by: you.
- 2026-10-12 — Chat messages may include ordinary files as well as images and task attachments; the GUI stores sent attachments under app data, outside the project code folder — decided by: you.
- 2026-10-12 — The no-Git shared-folder exception cannot provide fresh files on reassignment; the GUI states this when prompting to reassign — implementation consequence of your no-Git choice.
- 2026-10-12 — Codex may request permission to change Git metadata when an intern commits from a linked worktree; the chat shows the permission request — runtime behavior verified in the end-to-end smoke test.
