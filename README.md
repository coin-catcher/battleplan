# Battleplan

Strategy, tactics, design, and agent orchestration management dashboard.

Battleplan is the planning surface for a project, as a mindmap "skin" over Cursor CloudAgents. A project starts as a prompt to a Cursor CloudAgents. The conversation stays in the battleplan UI. When the plan is settled, Generate Tasks asks the agent for an ordered task list. Each task is either a code change or a research write-up, can depend on other tasks, and is executed by its own cloud agent. Finished work comes back as a pull request for review. Approval tells the agent to merge the pull request.


# Battleplan frontend

Angular app for the battleplan sidebar, project chat, task tree, and output review.

```bash
npm start          # http://127.0.0.1:4200, talks to the local Lambda server
npm run test:local
npm run build
```
