# Undumb

A game-like workspace for building with AI without outsourcing your thinking. Plan, delegate, review, and sharpen your problem-solving skills.

Undumb puts you in charge of an AI team. Work through an idea with a tech lead, make and record the key decisions, give bounded tasks to interns, then inspect and run what they build. The goal is to stay engaged with the reasoning and code throughout the project.

## Project layout

- [`office-gui/`](office-gui/) — current Electron app and workflow.
- [`office-shell/`](office-shell/) — earlier walkable 3D office prototype.
- [`unbrainrot-vibecode-workflow/`](unbrainrot-vibecode-workflow/) — standalone isometric office concept.
- [`codex-spike/`](codex-spike/) — Codex app-server experiments.
- [`docs/`](docs/) and root Markdown files — product concept, decisions, and plans.

## Run the current app

Install Node.js, npm, and the Codex CLI, then sign in to Codex with your ChatGPT account.

```powershell
cd office-gui
npm install
npm run dev
```

See [`office-gui/README.md`](office-gui/README.md) for the current workflow and checks. The other prototypes have their own READMEs.
