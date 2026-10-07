# Fix PR create — research summary

**Task:** Fix PR create  
**Question:** Why could Cursor Agents create and merge pull requests before, but now often say they cannot (or refuse to try)?

## Short answer

PR creation and merge involve **three different mechanisms** that do not share the same GitHub credentials. Agents could appear to “do everything” when **platform auto-create** (`autoCreatePR`) or **ManagePullRequest** succeeded. A **known Cursor GitHub App / installation-token regression** (reported widely from March 2026) breaks **`gh pr create`** and other GraphQL write/read scopes even when the GitHub App UI shows full access. Separately, **current agent instructions** steer models away from `gh` for writes and toward **ManagePullRequest**, which only works when the run is on the **correct pushed branch** with commits; failures on stale or wrong branches (e.g. an “old cleanup branch”) produce messages that sound like a permanent ban on PR creation.

Battleplan adds a fourth layer: it sets **`autoCreatePr: true`** on task launch *and* tells the agent to open a PR manually. When auto-create and agent tools both fail, the UI never receives `run.git.branches[].prUrl` and merge-on-approve cannot run.

## Recommended direction for Battleplan (no app code changed in this task)

See `recommendations.yaml`. Highest impact: treat **platform `autoCreatePR` + run git metadata** as the source of truth for `pr_link`, add **GH_TOKEN** (or org PAT) to the Cloud Agent environment for repos that need reliable `gh`/merge, and soften duplicate “open a PR” instructions when auto-create is enabled.

## Artifacts in this folder

| File | Purpose |
|------|---------|
| `findings.md` | Detailed analysis |
| `recommendations.yaml` | Action items |
| `evidence.csv` | Checks run in agent bc-3062b33e on 2026-10-07 |
| `references.json` | External threads and in-repo touchpoints |
