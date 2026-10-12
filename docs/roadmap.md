# Boss Office — Electron GUI roadmap

A local desktop office for planning work with a tech lead and assigning it to AI interns. The boss keeps product decisions, can inspect each chat and coding activity, and can return to past sessions. The earlier 3D route is archived in [roadmap-3d-archive.md](roadmap-3d-archive.md).

**Smallest useful version:** Discuss a project with the tech lead, get a saved Markdown task, read it on the whiteboard, attach it to an intern chat, see the intern work in an isolated Git workspace when Git is available, and return to its chat and terminal history later.

## Milestones

- [x] 1. Open the separate Electron GUI, create projects, hire interns, chat with employees, attach images, and inspect chat/coding activity in Office view.
- [x] 2. Create and update Markdown tasks through the tech lead; browse task headings and bodies on the whiteboard; attach tasks and files in intern chats; manage recent chats, context, assignment, Git branches/worktrees, and idle sessions.
- [ ] 3. Refine the visual design and interaction details after using the working GUI. ← next
- [ ] 4. Add the code reviewer/DevOps workflow for review, PRs, conflict resolution, and merging completed branches.

## Parked questions

- How should completed task branches be reviewed, merged, and cleaned up? — reviewer milestone.
- How should historical worktrees, attachments, and long chat/terminal logs be retained or cleaned up? — storage milestone after real use.
- How should added external project folders and scratch work appear in the GUI? — project settings milestone.
- Should the no-Git shared-folder mode continue to allow concurrent interns after real use? The current choice accepts possible overlapping edits.
- Dictation and richer attachment previews — later input milestone.
