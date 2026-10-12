# The Boss's Office — Windows MVP prototype

This Windows Electron prototype has a walkable 3D office and a live local Codex app-server bridge. It supports one active frontend website project. You create a Vite + React + TypeScript starter, consult a read-only tech lead, save and approve a plan version, then create and assign a bounded task to an intern. Agent messages, activity, and in-turn permission or question requests appear in the office. The boss can click Run to inspect the website in an isolated in-app preview and compare changed text files with the starter. The user has confirmed the agents work and the generated website was viewable.

## Run

Install Node.js 22 or newer, npm, and the local `codex` CLI. Sign in to Codex with your ChatGPT account and make sure `codex` is on `PATH`.

```powershell
npm install
npm run dev
```

For a built renderer:

```powershell
npm run build
npm run package:win-portable
node electron/smoke-portable-preview.cjs out/BossOffice-win32-x64-0.1.0
npm start
```

`npm start` opens Electron; it does not create an installer. The app starts `codex app-server --listen stdio://` in the background. If Codex cannot start, the office shows an error and disables agent actions.

For a portable Windows build, run `npm run package:win-portable`. The versioned folder under `out` contains `BossOffice.exe`, the office renderer, the trusted preview runtime, and the website starter. Keep the `resources` folder beside the executable. The portable app needs the Codex CLI signed in with a ChatGPT account, but does not need this source checkout or a developer terminal to launch. The executable is unsigned, so Windows may show a publisher warning. The packager requires network access when a production package is missing from npm's cache.

## Work through a project

1. At the **boss's desk**, enter a website idea and desired outcome, then create the project. The starter is copied into a fixed active project directory under Electron's user data; creating it does not install packages or use the network.
2. In the **meeting area**, talk to the tech lead, write the plan, click **Save new plan version**, then approve that exact version. Record your decisions with reasons and track open questions. Saving a changed plan creates a new version that needs its own approval.
3. At the **intern desk**, enter a task title, instructions, and acceptance criteria. Click **Create task**, then **Assign to intern**. Intern turns are tied to the task and approved plan version. The main process rejects dispatch until the current plan is approved.
4. Read the saved task state, escalations, reports, and work history at the intern desk or **project board**. Answer an ordinary blocker at the intern desk, or answer an in-turn question in the intern conversation. The tech lead's command approvals are automatically declined. Intern tool approvals go to you in Ask me mode or to Codex Auto-review when that mode is selected. A blocked ordinary turn returns to ready after your answer, then you assign it again.
5. Open **website preview** and click Run when ready. Refresh or stop it from the same panel. Inspect changed files below the preview; file review shows the starter and current text side by side. The preview starts only after you click Run.
6. When a task is in **review**, choose **Accept work** or write a **Request revision**. A revision saves new instructions and returns the task to ready; assign it again to get the next result. Pause and resume controls are available for an unfinished task; a disposable live Codex turn confirmed interruption before the paused state was saved.
7. At the **boss's desk**, switch **Intern website edits** off when you want an inspect-only turn. Choose **Ask me** or **Approve for me** under Permission review. Approve for me lets Codex's separate Auto-review agent decide eligible tool permission requests; your plan approval and the intern's design questions still come to you. Change the reviewer only while agents are idle; the office restarts its hidden Codex app-server and resumes stored role threads. The office shows command internet and hosted research as available.
8. At the **boss's desk**, read the Codex usage panel or click Refresh. It shows the rate-limit windows and token activity exposed by the signed-in app-server account. A warning appears at 80% used in any reported window; missing data is shown as unavailable. This is an account usage indicator, not a spending cap.

The intern works inside the generated website project, separate from this office application's source. Each role has its own Codex thread. The tech lead uses a read-only sandbox; the intern uses a workspace-write sandbox with on-request approval when edits are enabled. Network access is configured for both roles. Auto-review changes who reviews eligible approval requests; it does not remove the sandbox.

## Controls

- Click **Enter / resume walking** to lock the pointer. Use WASD or arrow keys to walk, mouse to look, E near a marked area to open its panel, and Esc to release the pointer.
- Use the work-area buttons in the right sidebar without walking. Close a panel with its Close button, Return to office, or Esc. Movement stops whenever a panel opens.
- The project brief is fixed after creation. Unsaved form drafts remain in local renderer storage. The bridge saves role thread IDs and messages under Electron user data. A separate versioned work-record file there saves plan versions and approval, decisions, questions, tasks, escalations, work reports, and history outside the intern's website files. Earlier approved-plan text is imported once as version 1; earlier conversations remain, but older intern work is not automatically marked accepted. On restart, an unfinished turn is marked interrupted for review and reassignment. A live in-turn request cannot resume after the app exits.
- Office controls are saved separately under Electron user data. With intern website edits off, the next Codex turn uses a read-only policy and cannot accept a write escalation; with edits on, it uses workspace-write. Ask me shows the available command, directory, host, file, and permission details for your response. Approve for me selects Codex Auto-review only for this office's app-server process; it does not edit your global Codex configuration. A local smoke confirmed the app-server accepts both reviewer settings and changes between them. A disposable live probe confirmed the edit switch changes the result. The boss chose to leave terminal-off and project-only privacy switches unavailable in this Windows MVP; the native Windows unelevated sandbox refused a project-only read profile.

## Verification

```powershell
node electron/test-codex-bridge.cjs
node --test electron/test-office-controls.cjs
node electron/smoke-auto-review-config.cjs
node electron/smoke-auto-review-decision.cjs
node --test electron/test-work-records.cjs
node electron/test-project-workspace.cjs
node electron/test-file-review.cjs
node --test electron/test-preview-runtime.cjs
node --test electron/test-usage-state.cjs
npm run build
```

The bridge's bounded live smoke script is `node electron/smoke-codex-bridge.cjs`; it uses the signed-in Codex CLI and sends a small real turn. On this machine it confirmed a streamed tech lead reply, thread resume after bridge restart, and a reachable network endpoint under the configured read-only policy. The Electron window launched after the build.

`node electron/smoke-intern-delegation.cjs` creates a disposable starter, approves a narrow plan, and asks a real intern turn to change one heading. On this machine it completed and changed exactly `src/App.tsx`; the disposable project was removed after verification.

The disposable `electron/smoke-preview-electron.cjs` test rendered the starter in an isolated Electron view, then refreshed and stopped it. The preview page had no `officeApi`, `require`, or `process` global. The trusted Vite preview ignores website-owned Vite, Babel, PostCSS, and npm scripts.

## Current limits

The user has confirmed agent operation and a viewable generated website. A complete revision and re-review, real escalation and answer, and blocked/review restart still need a manual office walkthrough. A disposable Auto-review turn hit a sandbox denial, retried, and wrote a sibling marker without an approval request reaching the office. The usage parser passed focused tests, and a signed-in local app-server returned rate-limit and token data. The portable executable launched and its packaged trusted preview served the starter. Speech input has been moved out of the MVP. The website-edit switch is enforced. Terminal-off and project-only file-read controls remain unavailable by the boss's choice. The current Windows probe confirmed a disposable sibling file is readable under the existing read-only policy; a restricted read profile failed closed under the native unelevated sandbox. Broader escape paths and HTTPS package installation remain unverified. See the [MVP completion plan](../MVP_COMPLETION_PLAN.md) for status and remaining work.
