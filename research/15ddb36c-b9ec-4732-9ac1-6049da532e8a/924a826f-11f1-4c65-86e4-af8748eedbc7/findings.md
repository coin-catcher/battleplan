# Why Cursor Agents stopped reliably creating and merging PRs

## 1. How Battleplan expects PRs to appear

When a code or research **task** starts, `local-engine.ts` launches a Cursor agent with:

- Prompt lines: create branch from project `starting_ref`, **open a PR against that base**, implement or write research, etc.
- API flag: **`autoCreatePr: true`** → sent to Cursor as `autoCreatePR` on `POST /v1/agents`.

When a run finishes, the local engine reads **`run.git.branches`** from the Cursor API. If a branch entry includes **`prUrl`**, that URL is saved as `pr_link` and the task moves to **REVIEW**. Approve sends a follow-up run: “Merge the pull request … Do not open a new pull request.”

So Battleplan does **not** require the agent to paste a PR URL in chat. It depends on Cursor populating **git/PR metadata on the run** (auto-create or whatever backend associates a PR with the branch).

If no `prUrl` appears, the user sees an agent message about compare links or “cannot create PR,” and **Approve and merge** fails with “Record a pull request before approving.”

## 2. Three ways a PR can be created (they use different auth)

| Mechanism | Who invokes it | Typical credential | Observed in this research run |
|-----------|----------------|-------------------|--------------------------------|
| **Platform `autoCreatePR`** | Cursor when the agent is created | Cursor backend / GitHub App (not the sandbox `gh` session) | Not directly observable from the sandbox; success would show as `prUrl` on the run |
| **`ManagePullRequest` tool** | Agent via Cursor-managed API | Cursor integration (separate from `gh auth`) | **Allowed to attempt**; failed pre-commit with “no differences”; post-commit behavior documented in `evidence.csv` |
| **`gh pr create` / GraphQL** | Agent shell | **`ghs_` installation token** in `~/.config/gh/hosts.yml` | **Failed:** `Resource not accessible by integration (createPullRequest)` |

**Git push succeeded** using the **`x-access-token`** embedded in the git remote URL. That is **not** the same token `gh` uses. This split explains a common user report: “The agent pushed the branch but cannot open the PR.”

Repository metadata queried with the `gh` token returned **all permission flags false** (`admin`, `maintain`, `push`, `pull`, `triage`), which matches forum reports that the **effective installation token scopes do not match** the GitHub App settings UI.

## 3. Why it worked in the past

Plausible explanations (not mutually exclusive):

1. **Cursor backend regression (March–April 2026)**  
   Multiple Cursor staff and user threads describe the same error for `createPullRequest` and `repository.issues` while git operations still work. Users report the issue **persists after reconnecting** the GitHub App. Cursor staff acknowledge **no ETA** and suggest a **PAT in `GH_TOKEN`** for `gh` as a workaround.

2. **Silent success via `autoCreatePR`**  
   When platform auto-create worked, agents did not need `gh` or ManagePullRequest. The run still got a `prUrl`; merges on approve could succeed if the **merge run** had sufficient rights via ManagePullRequest or platform tooling.

3. **Agent behavior and instruction changes**  
   Recent agent runs (including messages citing **ManagePullRequest tied to the old cleanup branch**) reflect:
   - System/tooling guidance that **`gh` is read-only** for PR writes and that PRs must go through **ManagePullRequest**.
   - Models **giving up** after one permission or branch mismatch error, offering **compare URLs** instead of retrying after push or switching branch.
   - **Resume / wrong-branch** state: if the workspace checks out an unrelated branch (e.g. leftover cleanup work), ManagePullRequest targets that head; users interpret the error as “integration cannot create PRs.”

4. **Org rulesets and branch naming**  
   Forum reports note GitHub **rulesets** blocking `cursor/*` branches or requiring naming conventions can block PR creation even when tokens are correct. Battleplan uses **`cursor/`**-style branch names from Cursor by default.

5. **Merge is a second permission surface**  
   Approve starts a **new run** whose job is merge-only. Even if create worked once, **merge** can fail on the same integration scope gaps (or agent refusal), leaving PRs open and tasks stuck in DOING with `pending_action: merge`.

## 4. Parsing the user-visible agent message

Example pattern:

> This environment still cannot **create or approve** pull requests (`Resource not accessible by integration` / ManagePullRequest tied to the old cleanup branch). Use the compare link only…

This mixes:

- A **real `gh`/GraphQL error string** (installation token scope).
- A **branch/context failure mode** (ManagePullRequest associated with wrong or stale branch).
- **Policy language** (“cannot approve”) that may overstate a **retryable** failure after push/commit.

It is not evidence that Battleplan or the repo disabled integrations; it is consistent with **token scope regression + agent heuristics**.

## 5. Merge and “approve” in GitHub terms

Battleplan “Approve and merge” is **not** a GitHub review approval in the API sense. It sends natural-language instructions to the **same cloud agent** to merge an existing PR. That requires either:

- ManagePullRequest / platform merge capabilities, or  
- `gh pr merge` with a token that has **`pull_requests: write`** (currently broken for installation token in sandbox).

So merge reliability tracks **the same class of issues** as create.

## 6. What this research run verified

See `evidence.csv`. Summary:

- Branch **`cursor/fix-pr-create-e51e`** pushed to `origin` successfully.
- **`gh pr create`** → GraphQL `Resource not accessible by integration (createPullRequest)`.
- **`ManagePullRequest` `create_pr`** → operational errors until commits existed (not the GraphQL integration error).

## 7. Out of scope

- Changing Battleplan application source (explicitly excluded for this task).
- Proving Cursor internal auto-create status for every model/source (API-only inference).
