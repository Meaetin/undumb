# The Boss's Office — Product Concept

## One-sentence concept

A 3D working environment with a game-like feel where the user runs software projects as the boss of an AI team. A tech lead helps the user reason through a project, and interns implement tasks under the user's direction.

**Working title:** The Boss's Office. The name can change.

## Why this exists

The user wants to stop handing their thinking and technical decisions to AI. In a typical AI-assisted workflow, an agent can plan, choose an approach, and write code while the user loses track of why the code works. This workspace should help the user:

- Make and explain product and engineering decisions.
- Learn the relevant parts of the codebase while building.
- Notice gaps in a plan before implementation hides them.
- Think ahead about trade-offs, dependencies, and failure cases.
- Delegate implementation while staying accountable for the result.

Success means the user understands and owns the work they produce with agents. There is no game to beat, fixed ending, level system, or score. People return to this office to start and continue their projects.

## First user and project

The first user is an experienced web developer: the creator of this workspace. They can already build websites, but want to stay engaged with the reasoning, code, and decisions while using AI agents to develop features.

The initial prototype is a Windows desktop app built with Electron and a React Three Fiber office where the user can bring any frontend-only website idea and work on one project at a time. Each project starts from a Vite + React + TypeScript template. The tech lead and intern use separate threads in a local Codex app-server process with the user's ChatGPT sign-in, with their activity shown in the office. An intern edits real files in a sandboxed project workspace, and the user can run the website to check whether it behaves as intended. If an idea needs a backend or database, the tech lead helps the user choose a frontend-only slice. This tests the workflow before connecting agents to the user's existing repositories.

## Core principle

**The user decides. The agents make the user's thinking visible.**

Agents can ask questions, expose trade-offs, point toward concepts or resources, and carry out clearly delegated work. They should not silently fill in consequential gaps or present an AI-chosen direction as if it were the user's decision.

## The 3D office

The user enters an office as the boss. The environment gives each part of the work a place:

| Place | Purpose |
| --- | --- |
| Boss's desk | Start a project or feature, review decisions, and see overall progress. |
| Meeting room | Discuss the idea and plan with the tech lead. |
| Intern desks | Assign tasks, receive questions, and inspect work in progress. |
| Project board | See the plan, task ownership, blocked questions, decisions, and completed work. |

The first office can be a simple rectangular space with a few rooms or work areas. The user walks through it in first person to reach each work area. Exact dimensions and art can be decided later. The 3D setting should make work engaging and legible; its game-like atmosphere does not turn projects into levels or tasks into challenges to beat.

The MVP uses typed messages. Push-to-talk speech, with an editable transcript, can follow in a later release; transcription technology needs a separate decision then. The boss's desk or another clearly visible office control area should show agent permissions, privacy settings, Codex usage, and usage warnings. Interns may edit files, run commands, and use the network inside the website sandbox by default. Access beyond it requires review: the boss can choose to review eligible tool permissions personally or use Codex Auto-review. Product and engineering decisions still go to the boss. The user later chose to leave command internet and hosted web research available, so the MVP does not need a network restriction switch. The boss can turn intern website edits off. Other controls must reflect what agents are actually allowed to do; terminal blocking and project-only file reads remain unavailable until enforceable.

## Roles and boundaries

### User: the boss

The user brings an idea, describes the desired outcome, chooses among trade-offs, approves a plan, delegates tasks, answers intern questions, reviews delivered work, and explains what changed. The user can research or ask for help, but the final decisions belong to them.

### Tech lead: a thinking partner

The tech lead's job is to help the user think like a software engineer. It should:

- Ask focused questions about goals, constraints, architecture, data, security, deployment, testing, and edge cases when relevant.
- Ask the user to explain *why* an approach fits before accepting it.
- Surface missing decisions, dependencies, and likely consequences.
- Give directional hints when the user is stuck, such as a concept to investigate or an option to consider.
- Adapt to the user's level: start with a hint, then provide more explanation if requested.
- Research a question when the user asks, including web research by default, present the relevant options with pros, cons, and sources where available, then ask the user to choose.
- Summarize the user's decisions in a plan and check whether the summary is accurate.

The tech lead should challenge weak reasoning without taking control of the decision. For example, it might ask, “Where will session state live, and what happens when the server restarts?” If the user asks for research, the tech lead can compare authentication approaches in detail. The user still makes and records the choice.

### Interns: supervised implementers

Interns execute tasks that the user has defined. The user can assign as many interns as the project needs. Each intern should:

- Work from the approved task description and relevant project context.
- Ask the user when a requirement, technical choice, or expected behavior is unclear.
- Escalate when something goes wrong, the task conflicts with the project, or the next step is not covered by the user's instructions.
- State the options and the exact decision needed, without quietly choosing one.
- Show what was changed, where it was changed, and how it was checked.
- Stop and report a blocker when continuing would require an unapproved decision.

Routine work means following the given plan, task instructions, and existing project conventions. When those instructions do not cover the situation, or something breaks, an intern asks the user how to proceed. Their limited autonomy is a deliberate way to keep the user involved, not a claim that they should produce poor code.

## Core work cycle

1. **Start work:** The user opens or creates a project or feature and states the desired outcome.
2. **Plan with the tech lead:** The tech lead asks questions. The user researches, reasons, and chooses an approach. Open questions remain visible.
3. **Approve a plan:** The workspace records the goal, scope, key decisions and reasons, dependencies, risks, and a definition of done. The user confirms it reflects their intent.
4. **Delegate:** The user turns the plan into bounded tasks and assigns them to one or more interns.
5. **Resolve questions:** Interns work until they need a decision. The user answers, and that answer becomes part of the task and decision record.
6. **Review:** Interns present their changes and checks. The user inspects the code, asks questions, and decides whether to accept or revise the work.
7. **Explain and reflect:** The user can summarize how the feature works, why key choices were made, and what they would change next time. The project board captures the result.

The cycle can repeat for new tasks or a revised plan. Planning is not a one-time gate: implementation may reveal facts that send the user back to the tech lead.

## Support for learning while working

- **Decision log:** Records what the user chose, why, alternatives considered, and later changes. The user should be able to trace a code change back to a decision.
- **Visible unknowns:** Unanswered questions appear on the project board rather than disappearing into agent assumptions.
- **Graduated help:** The tech lead offers a prompt or research direction first, then stronger hints, research with pros and cons, or an explanation when the user asks. The user can always request direct help, but should still make the choice.
- **Code walkthroughs:** After an intern completes a task, the user can ask what changed in a specific file or flow and connect it to the original plan.
- **Reflection:** The workspace can invite the user to explain a behavior or trade-off in their own words, without scoring the answer.
- **Consequences:** Later work can reveal the effects of earlier decisions, such as a deployment constraint or data model that makes a feature harder. The tech lead helps the user reason through the consequence.

Progress should be felt through successful direction of agents, working projects, and growing confidence with the code. The workspace does not need to score or quantify the user's understanding, decision making, or improvement.

## Example interaction

**User:** “I want users to sign in so their projects are saved.”

**Tech lead:** “What kinds of accounts do you need? Where should user data live? What should happen if a session expires while someone is editing?”

**User:** Investigates the options, chooses an approach, and explains why it fits the project.

**Tech lead:** Summarizes the chosen approach, flags any unanswered questions, and helps break the work into tasks.

**User:** Assigns an intern a specific authentication task.

**Intern:** “The plan says users can sign in, but does not say whether email verification is required. Should I implement it now or leave it for a later task?”

**User:** Decides, updates the task, and later reviews the code and behavior.

## First prototype

Build one complete work cycle with a contained example project:

1. A simple rectangular 3D office with the boss's desk, a meeting area, one intern desk, and a project board.
2. Typed conversation with the tech lead that helps turn one idea into a recorded plan.
3. User-owned decisions and an explicit list of open questions.
4. Task creation and assignment to one intern.
5. An intern question-and-answer flow for ambiguous requirements.
6. A sandboxed frontend website project based on the user's idea, with files the intern actually edits and a running preview in an in-app panel.
7. A review screen that connects a completed task to its changes and checks.
8. Office controls that display and let the user change agent permissions and limits.
9. An optional user explanation or reflection at the end of the task.

The first projects should stay contained so the work cycle can be tested before connecting agents to the user's existing repositories.

## Product rules to preserve

- Agents must distinguish the user's decisions from their own suggestions.
- Material unanswered questions must remain visible until the user resolves them.
- A task should have a clear outcome and acceptance criteria before an intern starts.
- Interns must not silently expand scope or change architecture.
- Interns must escalate errors, blockers, and situations their instructions do not cover.
- The user can pause an intern, revise a task, or return to planning at any point.
- Completed work should be inspectable; a “done” label alone is insufficient.
- Hints and feedback should support learning without treating uncertainty as failure.
- Agent capabilities and privacy settings must be visible and controllable in the office; Codex usage must be visible with warnings.

## Open design and technical decisions

These are intentionally unanswered. They should be decided by the user during planning:

- How will the contained website run, and what files or tools will interns use to build it?
- For a later release, which speech input, transcription, and possibly speech output approach should the workspace use?
- How will the desktop app coordinate separate Codex app-server threads for the tech lead and intern?
- What are the exact effects of the office controls for execution, file access, and privacy, and when should usage warnings appear?
- What limits should apply when the workspace connects to the user's real projects?

## Suggested next planning step

Choose one concrete example feature and walk it through the work cycle on paper. That exercise will expose the minimum screens, agent prompts, data to record, and decisions the user must make before building the 3D environment.
