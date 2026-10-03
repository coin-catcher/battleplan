# Battleplan

Strategy, tactics, design, and agent orchestration management dashboard.

Battleplan is the planning surface for a project, as a mindmap "skin" over Cursor CloudAgents.

### Mindmap UX

- Move the pointer near the north, south, east, or west edge of a project or task to reveal a semi-transparent arrow.
- Press and hold the arrow to open a panel; choose **Add connected task** to create a linked task with a directed edge, or click away to dismiss without creating.
- Double-click a project or task shape to edit its title in place; the title saves when you click away or press Enter. A project starts as a prompt to a Cursor CloudAgents. The conversation stays in the battleplan UI. When the plan is settled, Generate Tasks asks the agent for an ordered task list. Each task is either a code change or a research write-up, can depend on other tasks, and is executed by its own cloud agent. Finished work comes back as a pull request for review. Approval tells the agent to merge the pull request.


# Battleplan frontend

Angular app for the battleplan sidebar, project chat, task tree, and output review. The same UI ships inside the cross-platform Electron desktop app, which stores project data on disk and checks GitHub Releases for updates.

```bash
npm start              # browser dev server at http://127.0.0.1:4200
npm run electron:dev   # Angular + Electron with hot reload
npm run electron:start # production build inside Electron
npm run test:local
npm run build
npm run dist           # local desktop installers (see docs/DESKTOP_RELEASE.md)
```
