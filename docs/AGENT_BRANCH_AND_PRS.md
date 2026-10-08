# Agent branches and pull requests

Battleplan owns **GitHub pull requests**. Cursor agents must **not** create or merge PRs.

## Cursor API / environment config

Every `POST /v1/agents` from Battleplan (`BrowserCursor.createAgent`) sets:

| Field | Value | Purpose |
|--------|--------|---------|
| `autoCreatePR` | `false` | Cursor must not open a PR when a run finishes |
| `workOnCurrentBranch` | `false` | First push goes to one auto `cursor/…` branch from `startingRef` (not the base branch directly) |
| `repos[].prUrl` | *(omitted)* | Agents are never scoped to an existing PR |
| `envVars.BATTLEPLAN_PR_POLICY` | `cursor_agents_must_not_create_or_merge_pull_requests` | Session env marker aligned with prompt rules |

Caller-supplied `autoCreatePr` / `prUrl` on `CreateAgentInput` are **ignored** so no code path can re-enable platform PRs.

Follow-up runs (`POST …/runs`) reuse the agent record; they do not pass `autoCreatePR`. Prompt text on every run repeats the no-PR policy.

## One branch per task agent

1. **Execute** creates one Cursor agent with the settings above.
2. Cursor opens a single `cursor/…` branch from the project **base branch** (`starting_ref`, usually `develop`).
3. Every follow-up run on that agent (`createRun` for chat, feedback, generate tasks) receives **agent branch policy** text:
   - Stay on the same branch (named when known).
   - Do not create additional branches.
   - Merge the latest base branch into the working branch before new commits when behind.
   - Commit and push only to that branch.
   - Do not open or merge pull requests.

## How Battleplan picks the branch

Cursor runs may report **multiple** branch names if an agent incorrectly created a second branch. When a run finishes, `applyTaskRun`:

1. Collects branch names from `run.git.branches`.
2. Uses the project GitHub PAT to compare each candidate to the base branch.
3. Stores the branch with the most commits ahead (preferring the previously stored branch on ties).

**Approve and merge** repeats the same resolution before calling the GitHub API to create and merge a PR.

If no branch has commits ahead of the base, Approve fails with a clear error instead of GitHub HTTP 422 (`No commits between develop and …`).

## Approve and merge

Uses the project **GitHub PAT** from `project_config.json` / project settings:

1. Resolve the merge head branch (see above).
2. `POST /repos/{owner}/{repo}/pulls` (skipped when an open PR already exists for that head/base).
3. `PUT …/merge` to merge into the project base branch.
4. Record pending release notes from PR commits.

Agents should report which branch they pushed in the run summary; Battleplan does not use Cursor `prUrl` from runs for merge.
