# Audit — manual Task status change (Task page dropdown)

**Target UX:** Persist task, mindmap color, chat history line (`Status: …`) within **~1s**.  
**Observed:** ~10s for tasks with a Cursor agent (pre-fix).

## Call chain (UI → persistence)

| Step | Layer | What happens | Typical cost |
| --- | --- | --- | --- |
| 1 | `app.component` `onStatusChange` | Reads `<select>` value, calls `store.transition(taskId, status, true)` | Instant |
| 2 | `BattleplanStore.transition` | `patchTaskStatus` (optimistic mindmap), then `run()` wrapper (`busy` signal) | Instant |
| 3 | `LocalEngine.transition` → `updateTask` | Validate transition; `applyStatus` (local state machine only — **no agent/GitHub**) | Local ms |
| 4 | `updateTask` (status branch) | On **ABANDONED**: `cascadeAbandonChildren` (extra saves + notes per child). On **DONE**: `autoDispatchReadyTasks` **if graph orchestration is running** (orchestration advance, may start agents) | Local; can be large if many children / active orchestrator |
| 5 | `updateTask` (always) | `repo.saveTask`, optional graph persist, **`taskNote` → `repo.saveMessage`** (`role: change`, `Status: {status}`) | Local ms |
| 6 | Store | `replaceTask` → mindmap/kanban signals | Instant |

### Pre-fix slow path (removed for manual changes)

| Step | Layer | What happens | Typical cost |
| --- | --- | --- | --- |
| 7a | Store (old) | Only if `cursor_agent_id`: `listTaskMessages` default **`syncAgent: true`** | **Seconds** |
| 7b | Engine | `importFinishedRuns` → `cursor.listRuns` + per-run `getRun` / stream | **Cursor API** |
| 7c | Engine | `syncArtifacts` | **Cursor API** |
| 7d | Engine | `importReferencedRuns` | Cursor / repo |
| 7e | Engine | `reconcileTaskStatusWithLatestAgentRun` → **`cursor.getRun`**; may rewrite status or `applyTaskRun` | **Cursor API**; can **override manual status** while run in-flight |
| 7f | Store (old) | `refreshOutput` (local code/research output read) | Usually fast |

**Root cause of ~10s:** Step 7 treated a **manual status edit** like “refresh chat from Cursor,” blocking `run()` until network sync finished. Chat/history line was already saved in step 5 but the UI waited for step 7.

## Post-fix (branch `cursor/responsiveness-1a9f`)

Manual transitions (`manual: true` from Task page):

- **`listTaskMessages({ syncAgent: false, reconcileStatus: false })`** — load saved messages (includes status note) from repo only.
- **`patchTaskStatus`** before engine call for immediate mindmap color.
- **AgentService** continues background watches via `syncDoingBackgroundWatches()`; Cursor catch-up happens there, not on the critical path.

## External systems (highlight)

| System | When invoked on status change |
| --- | --- |
| **Local repo** | Always — task JSON, change message, optional child abandons / orchestration |
| **Cursor agent API** | Pre-fix: every manual change on agent-backed tasks. Post-fix: **not** on critical path; background AgentService polls |
| **GitHub** | **Not** on manual status change (merge/release/approve are separate flows) |
| **Graph orchestration** | Only when setting **DONE** and `graph_orchestration.status === 'running'` (`autoDispatchReadyTasks`) |

## Product / research notes

- **Manual status wins** over in-flight agent reconciliation (no `reconcileStatus` on manual refresh).
- Orchestration dispatch on DONE may exceed 1s — candidate for async follow-up if humans mark DONE during active graph runs.
## Root project status (Task page project dropdown)

Same **≤1s** rule as tasks (`onProjectStatusChange` → `store.transitionProject`):

| Step | Notes |
| --- | --- |
| Optimistic | `patchRootProjectStatus` |
| Engine | `updateProject` — local `applyProjectStatusTransition` + change message (no GitHub/Cursor on critical path) |
| Chat | `listProjectMessages({ syncAgent: false })` |
| Background | `syncDoingBackgroundWatches()` after transition |

## Manual vs agent status (product)

| Source | Behavior |
| --- | --- |
| Human dropdown | Immediate; manual choice sticks until the next agent reconcile |
| Agent reply (background poll) | Reconcile may move the task to workflow-true status; human may override again |
| DONE + orchestration | `autoDispatchReadyTasks` runs **async** (does not block status dropdown) |