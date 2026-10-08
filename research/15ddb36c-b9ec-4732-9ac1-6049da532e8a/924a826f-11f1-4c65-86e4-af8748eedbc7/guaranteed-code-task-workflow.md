# Guaranteed code-task workflow (branch → PR → review → merge)

## Desired behavior

For every **code** (and research) task:

1. Work happens on **one dedicated branch** per task, forked from **`develop`** (project merge base).
2. When the agent finishes committing, a **pull request** exists from that branch **into `develop`**.
3. The user reviews in Battleplan / GitHub, then **Approve and merge** merges that PR into `develop`.

## Can prompts alone guarantee this?

**No.** Prompts are necessary for *what* to implement, not for *reliably orchestrating* git/GitHub.

| Step | Prompt-only risk |
|------|------------------|
| Branch from `develop` | Agent may stay on a stale branch, wrong base, or resume a prior run’s branch (“old cleanup branch”). |
| Push commits | Usually works (git remote token ≠ `gh` token). |
| Open PR | Agents often call `gh pr create` and hit `Resource not accessible by integration`; some refuse after one failure; ManagePullRequest requires correct head + pushed commits. |
| Merge on approve | Second agent run; same permission and refusal patterns. |

Battleplan already sends **`autoCreatePr: true`** to the Cursor API **and** tells the agent to open a PR. That duplication increases failures when auto-create is slow or the agent tries `gh` first.

**Conclusion:** Treat prompts as **implementation instructions only**. Treat **API flags + Battleplan code** as the contract for branch/PR/merge.

## What Cursor already guarantees (when configured correctly)

From the [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints):

- `repos[0].startingRef`: base to branch from → set to **`develop`** (project `starting_ref`).
- `workOnCurrentBranch: false` (default): each new agent gets a **new `cursor/…` branch** off that base — **one branch per agent**, which maps 1:1 to **one code task** if each task creates one agent (Battleplan already does this in `executeTask`).
- `autoCreatePR: true`: Cursor **opens a PR when the run completes** (backend GitHub App), independent of sandbox `gh`.

Custom branch names (e.g. `task/{task_id}`) are **not** supported on v1 API (`branchName` was removed); the dedicated branch is always Cursor-generated under `cursor/…`, stored on the run as `run.git.branches[].branch`.

**Minimum config (already mostly present):**

- Project `starting_ref` = `develop`.
- `createAgent`: `startingRef: develop`, `autoCreatePr: true`, `workOnCurrentBranch: false`.
- **Remove** prompt lines that tell the agent to “open a pull request” when auto-create is on; instead tell the agent to **commit and push on the run branch only**.

That gets you most of the way **if** platform auto-create is healthy.

## Recommended solution: mechanical “PR gate” in Battleplan

Add a small **orchestration layer** in the app (not in the agent prompt) that runs whenever a task run reaches a terminal state.

### Phase A — Harden run completion (low risk, do first)

**Where:** `applyTaskRun` / `importFinishedRuns` in `local-engine.ts`.

**Behavior:**

1. On `run.status === 'FINISHED'` for a code/research task:
   - Read `run.git.branches[]` for `branch` and `prUrl`.
   - Persist `branch` on `TaskCodeOutput` / `TaskResearchOutput` even when `prUrl` is missing.
2. If `prUrl` is present → save `pr_link`, move task to **REVIEW** (today’s happy path).
3. If `prUrl` is missing but `branch` is present → call **`ensurePullRequest`** (Phase B), then REVIEW.
4. If both missing → keep task in **DOING**, surface a clear error (“No branch on run; retry or check Cursor integration”), do not pretend REVIEW.

**Prompt change (same PR as Phase A):** Replace “Open a pull request…” with:

- “Work only on the agent run branch. Commit and push all changes. Do not create or merge pull requests; Battleplan/Cursor handles PR creation.”

### Phase B — `ensurePullRequest` (guarantees PR exists)

**Why:** Covers auto-create failures and GitHub App token regressions without depending on agent tools.

**Implementation sketch:**

```text
ensurePullRequest({ owner, repo, head, base, title, body, draft })
  → POST https://api.github.com/repos/{owner}/{repo}/pulls
  → or GET existing PR for head (avoid duplicates)
  → return html_url
```

**Auth:** Store a **GitHub PAT** (or GitHub App user token) in Battleplan settings / Electron secure storage — same pattern as Cursor’s documented `GH_TOKEN` workaround, but owned by **Battleplan** so the desktop app does not rely on the cloud sandbox token.

**When to call:**

- After every finished task run (Phase A step 3).
- Optionally once more before enabling **Approve and merge** if `pr_link` is still empty (belt and suspenders).

**Base branch:** Always `project.starting_ref` (default `develop`), not `main`.

This **guarantees a PR record** for review UI and `approve()` as long as the branch was pushed.

### Phase C — Guarantee merge on “Approve and merge”

Today, approve sends a **natural-language merge run** to the cloud agent (`mergePrompt`). That is as fragile as PR create.

**Recommended:** Prefer **GitHub API merge** from Battleplan when the user clicks Approve:

```text
mergePullRequest({ owner, repo, number, merge_method: 'squash' | 'merge' })
  → PUT .../pulls/{number}/merge
```

**Flow:**

1. User clicks **Approve and merge**.
2. Battleplan calls GitHub API with stored PAT (merge + contents read).
3. On success: set task **DONE**, clear `pending_action`, refresh PR state (reuse `fetchGithubPullRequest`).
4. On failure: show GitHub error; optionally **fallback** to current agent `mergePrompt` run.

**Optional agent role:** Agent run is only for **code changes**, not for merge — reduces “cannot approve PR” noise.

If you must keep agent merge (e.g. no PAT in org policy), require **`GH_TOKEN`** in the **Cloud Agent environment** with `pull_requests: write` so ManagePullRequest / `gh pr merge` can succeed.

### Phase D — Feedback runs stay on the same branch

Feedback uses `createRun` on the **same** `cursor_agent_id` with `feedbackPrompt` (no new agent). That should continue on the **same workspace branch** tied to the open PR.

**Mechanical checks:**

- Store `pr_link` and `branch` after first completion.
- After feedback runs finish, re-run **`ensurePullRequest`** (same head) or refresh PR metadata; do not create a second PR.
- Prompt for feedback: already says “existing branch”; add “do not change base branch; PR target remains `develop`.”

**Future API (when available):** For feedback-only runs, Cursor docs suggest `repos[0].prUrl` + `workOnCurrentBranch: true` on agent create — for `createRun`, confirm in API docs whether equivalent exists; if not, same-agent continuation is the supported path.

## Decision summary

| Approach | Guarantees branch | Guarantees PR | Guarantees merge |
|----------|-------------------|---------------|------------------|
| Prompt only | No | No | No |
| `autoCreatePR` only | Mostly | Often | No |
| **Phase A + B (recommended)** | Yes (via Cursor API + stored branch) | **Yes** (Battleplan `ensurePullRequest`) | No |
| **Phase A + B + C (target)** | Yes | Yes | **Yes** (API merge on approve) |

## Implementation order

1. **Phase A** — prompt trim + persist branch + call ensure on missing `prUrl`.
2. **Phase B** — GitHub PAT in settings + `ensurePullRequest`.
3. **Phase C** — API merge on approve; agent merge as fallback only.
4. **Ops** — Cloud Agent env `GH_TOKEN` until Cursor fixes installation tokens (merge fallback for agent-driven flows).

## Acceptance tests

1. New code task on project with `starting_ref=develop` → run finishes → task in **REVIEW** with valid `pr_link`, base `develop`.
2. Simulate missing `prUrl` on run payload → Battleplan still creates PR via `ensurePullRequest`.
3. User feedback run → same PR updated, still one PR per task.
4. Approve → PR merged into `develop`, task **DONE** without agent merge run (Phase C).

No new acceptance test replaces monitoring: poll Cursor run until `git.branches` is populated before declaring failure (auto-create can lag commits).
