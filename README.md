# warplan

Strategy, tactics, design, and agent orchestration management dashboard.

Warplan is the planning surface for a project. A project starts as a prompt to a [Cursor cloud agent](https://cursor.com/docs/cloud-agent/api/endpoints). The conversation stays in the warplan UI. When the plan is settled, **Generate Tasks** asks the agent for an ordered task list. Each task is either a code change or a research write-up, can depend on other tasks, and is executed by its own cloud agent. Finished work comes back as a pull request for review. Approval tells the agent to merge the pull request.

## Layout

| Path | What it is |
| --- | --- |
| `infra/bootstrap` | One-time Terraform. Creates the S3 bucket that stores later `*.tfplan` files, plus a lock table for remote state. |
| `infra` | Shared DynamoDB table, HTTP API, and Lambda role. State and plans live in the bootstrap bucket. |
| `faas/projects` | Project create, list, rename, and delete. |
| `faas/tasks` | Task list, edits, reorder, dependencies, and status changes. |
| `faas/outputs` | Code and research pull-request records. |
| `faas/chat` | Chat history and the question/answer loop with Cursor. |
| `faas/agents` | Direct Cursor agent commands: status, follow-up runs, and cancel. |
| `frontend` | Angular app. |

Each of those folders has a `package.json` with `build`, `test:local`, `test:agent`, `deploy:local`, and `deploy:agent`.

`deploy:local` uses `AWS_PROFILE` (default `default`) and asks before apply. `deploy:agent` is for a Cursor cloud agent: `TF_IN_AUTOMATION=1`, no profile prompt, and apply without a confirmation. Set `WARPLAN_AUTO_APPROVE=1` to apply from a local non-interactive shell.

## Data

The Angular app keeps projects, tasks, outputs, chat messages, and artifacts in the browser IndexedDB database named `warplan`. Open **Cursor API key**, paste a key, and the app stores it in this browser’s local storage. Chat, task generation, and merges call `https://api.cursor.com` directly from the browser.

- **projects**: `project_id`, `title`, `initial_prompt`, `cursor_chat_link`, plus the Cursor agent id, repository, and base branch.
- **project_tasks**: `task_id`, `project_id`, `title`, `prompt`, `dependencies`, `status`, `output_type` (`code` or `research`), and optional mindmap coordinates.
- **task_code_output**: `task_id`, `repo`, `branch`, `pr_message`, `pr_link`.
- **task_research_output**: the same pull-request fields, plus `path` under `research/<project_id>/<task_id>/`.

Guided status changes are `TODO → DOING → REVIEW → DONE`, and a task can move to `BLOCKED` or `ABANDONED`. A task in `DOING` moves to `REVIEW` when a pull request is ready. Feedback returns it to `DOING`. Approval asks the Cursor agent to merge, then the task becomes `DONE`. The status dropdown can set any status directly.

A task has one output type. If a generated task asks for both, the app splits it into a research task and a code task that depends on it.

The `faas` services and the shared DynamoDB table remain in the repository. The dashboard does not call them.

## Local development

```bash
npm install --prefix frontend
npm start --prefix frontend
```

Save a Cursor API key in the app before creating a project. Projects and tasks stay in this browser.

## Deploy

```bash
cp .env.example .env
# export the variables, including CURSOR_API_KEY

npm run deploy:local --prefix infra/bootstrap   # once
npm run deploy:local
```

Cloud agents run `npm run deploy:agent` instead. Bootstrap is idempotent. Every later `terraform plan -out=*.tfplan` is uploaded to `s3://<plan-bucket>/plans/...` before apply. Remote state is stored in the same bucket under `state/`.

The frontend deploy builds the Angular app and syncs it to the frontend S3 website bucket. The built site does not embed an API endpoint.

`npm run destroy:local` destroys every resource in each Terraform state. Lambda stacks go first, then the frontend bucket, the shared API and table, and the bootstrap bucket last. Pass a state key to `scripts/tf-destroy.sh` to limit the run to one file, for example `bash scripts/tf-destroy.sh local frontend`. `npm run destroy:agent` runs the full sequence without a confirmation prompt.
