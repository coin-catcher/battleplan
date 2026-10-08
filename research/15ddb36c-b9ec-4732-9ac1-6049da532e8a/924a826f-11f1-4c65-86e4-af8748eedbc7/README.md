# Fix PR create — research summary

**Task:** Fix PR create  
**Question:** Why could Cursor Agents create and merge pull requests before, but now often say they cannot (or refuse to try)?

## Short answer

PR creation and merge involve **three different mechanisms** that do not share the same GitHub credentials. Agents could appear to “do everything” when **platform auto-create** (`autoCreatePR`) or **ManagePullRequest** succeeded. A **known Cursor GitHub App / installation-token regression** (reported widely from March 2026) breaks **`gh pr create`** and other GraphQL write/read scopes even when the GitHub App UI shows full access. Separately, **current agent instructions** steer models away from `gh` for writes and toward **ManagePullRequest**, which only works when the run is on the **correct pushed branch** with commits; failures on stale or wrong branches (e.g. an “old cleanup branch”) produce messages that sound like a permanent ban on PR creation.

Battleplan adds a fourth layer: it sets **`autoCreatePr: true`** on task launch *and* tells the agent to open a PR manually. When auto-create and agent tools both fail, the UI never receives `run.git.branches[].prUrl` and merge-on-approve cannot run.

## Guaranteed code-task workflow (PR review feedback)

Prompts **cannot** reliably enforce one branch off `develop`, PR into `develop`, and merge on approve. Use **Battleplan code** plus Cursor API flags. Full design: **`guaranteed-code-task-workflow.md`**.

**Recommended:** Keep `autoCreatePr: true` and `startingRef: develop` as the fast path; add **`ensurePullRequest`** (GitHub API + PAT in app settings) when `run.git.branches` has a branch but no `prUrl`; on **Approve and merge**, call **GitHub merge API** instead of relying on an agent merge run (agent merge as fallback only).

## Artifacts in this folder

| File | Purpose |
|------|---------|
| `guaranteed-code-task-workflow.md` | Reliable branch → PR → merge design (Phases A–C) |
| `findings.md` | Detailed analysis |
| `recommendations.yaml` | Phased action items |
| `evidence.csv` | Checks run in agent bc-3062b33e on 2026-10-07 |
| `references.json` | External threads and in-repo touchpoints |
