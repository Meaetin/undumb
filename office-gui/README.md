# Boss Office GUI

The separate Electron version of Boss Office. The earlier 3D app remains in `../office-shell`.

## Run

Install Node.js, npm, and the local Codex CLI, then sign in to Codex with your ChatGPT account.

```powershell
npm install
npm run dev
```

To run the built app:

```powershell
npm run build
npm start
```

## Current workflow

1. Create a project and discuss the work with its tech lead. Once its clarifications are resolved, the lead creates a Markdown task. It can also update an unfinished task after asking you whether to update or create another.
2. Open Whiteboard to see task headings, assignments, and full Markdown. Plans live under Electron user data in `project-data/<project-id>/plans`, outside the project's code folder.
3. Hire an intern, attach a task in its chat, add text, images, or files, and press Send. A raw instruction without an attached task creates a task on the board and starts work.
4. For a Git project, each task gets a branch and separate worktree under app data. A dependent task can start from a completed task's committed branch. The intern commits its changes before the task is marked done. Codex may ask you to allow a Git command.
5. For a project without Git, the app offers to initialize it. If you continue without Git, interns use the shared project folder, including for concurrent tasks.
6. Use Stop to interrupt work, Compact to shorten the current chat's AI context, or Clear context to start a new chat with the same assigned task and files. Recent chats remain visible. Past chat and terminal history stays available. After ten idle minutes, sessions close; the shared Codex process stops when all sessions are idle and starts on the next message.

The Office view opens an employee's saved chat or read-only command/output history. It is not an interactive terminal. Reassigning a Git task retains the old intern's chat/worktree as history and creates fresh chat and files for the next intern. Completed branches are not merged automatically.

The app stores project state and attachments under Electron user data. It does not migrate or modify the older 3D app's data.

## Checks

```powershell
npm test
npm run build
npm run smoke:gui
npm run smoke:codex
```

`smoke:gui` opens Electron with disposable data and captures chat and whiteboard screenshots in `screenshots/`. `smoke:codex` uses a disposable project to verify tech lead task creation, intern work in a branch/worktree, commit, completion, reading an attached text file, and continuing after compaction. It needs a signed-in Codex CLI and may take around a minute.
