# The Boss's Office — interaction redesign roadmap

A Windows desktop office for directing AI coworkers while the boss retains the decisions. This roadmap covers the requested third-person, character-led redesign. The detailed design and full implementation map are in [AGENT_INTERACTION_REDESIGN.md](../AGENT_INTERACTION_REDESIGN.md).

**Smallest useful version:** One full tech-lead-to-intern work cycle through third-person character dialogue, from picking an existing registered project, starting a project under the app-owned dot directory, or using scratch through real work, a genuine blocker, report inspection, and a next-action choice. The boss hires interns with a project, direct/worktree mode when Git is available, and optional board work. Raw messages create WIP items and start immediately. Text is the MVP input. The fixed camera uses screen-relative walking and keeps its view during dialogue. The initial office targets three interns and a physical waiting queue.

## Milestones

- [ ] 0. Agree on the playable interaction route and remaining first-release behavior. ← current
- [ ] 1. Walk a third-person avatar with screen-relative movement and a fixed-angle follow camera up to the lead and three interns; open/close bottom-screen dialogue while retaining the walking view.
- [ ] 2. View the dot-directory base path or add external paths in Settings; pick an existing project, start a new folder under the base, or Skip to scratch; converse with the tech lead and save/approve a plan when desired.
- [ ] 3. Hire an intern with a project, direct/worktree mode when Git is available, and optional board item; see attached work start or an unassigned hire wait and become idle after five minutes. A later raw message starts immediately and creates a WIP board item.
- [ ] 4. Answer a genuine blocker, receive intern reports from a physical queue at the boss's office, inspect the resulting work, and choose what happens next.
- [ ] 5. Reopen the office and finish a full work cycle from the correct project, dialogue, and task state.
- [ ] Later. Add pasted images, dictation, and the code reviewer/PR workflow.

## Parked questions

- Interaction controls and character art — milestone 0–1. Screen-relative movement, fixed-angle follow camera, retained walking view, and bottom-screen dialogue are decided.
- Dot-directory name/location, exact scope of “anything” inside a selected project, and mode changes with active work — milestone 0–3. Selecting an added external project authorizes work inside it; outside actions ask permission. Worktree is disabled for non-Git folders, and each Worktree intern gets a separate checkout.
- Pasted images and dictation — later input milestone; text is the MVP input.
- Raw messages bypass the old plan/task form gate, create a WIP board item, and start immediately. Hire-time board attachment and five-minute idle behavior need the process/thread choice defined; saved context must resume — milestone 3.
- Exact TUI monitor feasibility and any reliable progress indicator — milestone 3.
- The MVP walkthrough includes a genuine blocker, not a scripted fake — milestone 4.
- Start with three interns, subject to map layout; program them to walk to a designated queue area for one-by-one interaction. Queue order and spacing remain open — milestones 1, 3, and 4.
- Repository and PR setup — reviewer milestone. The reviewer may create PRs and review code; conflict resolution and merge require a boss decision.
