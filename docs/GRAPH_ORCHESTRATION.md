# Task graph orchestration

Battleplan persists an orchestration run on each `Project` as `graph_orchestration`. The run interprets `task_graph_edges` (tree, ordering, fork, join, cycle), plans parallel dispatch via `orchestrationDispatchBatch`, records transitions, and recovers in-flight agent runs after reload.

## Ownership

**The orchestrator owns all automatic graph execution.** When a task reaches `DONE` (for example after approve/merge), the next wave is dispatched only while `graph_orchestration.status === 'running'`. There is no legacy auto-dispatch outside an active run. Single-task **Execute** is still explicit; chained graph progress requires **Run task graph** / **Run subgraph** (or **Execute Children**, which starts a descendants-only subgraph run).

**REVIEW** is the human-review gate when the agent needs grilling or merge cannot proceed automatically. Task agents are instructed to append `NO_HUMAN_REVIEW_NEEDED` when grilling decisions are clear; Battleplan then merges via **Approve** (PR create/merge → `DONE`) without waiting in the UI. Agent-led review of prior outputs still belongs on **Critique** tasks downstream.

## Run lifecycle

- **Start:** Mindmap **play** (`|>`) on a task with children — runs that task and its descendants under orchestration.
- **Stop / pause (run):** Mindmap toolbar **Stop Execution** and **Pause Execution** while a run is active.
- **Pause (task):** Mindmap **pause** (`‖`) on child tasks (toggle per task; dimmed fill when paused).
- **While running:** Ready tasks dispatch through `LocalEngine.executeTask` with graph-based upstream inputs. Tasks that already have a Cursor agent are **re-executed** via a new run on the same chat, with `NO_HUMAN_REVIEW_GRILLING_INSTRUCTION` injected. Completing or approving a task triggers the next wave when `status === 'running'`.
- **Pause task:** Excludes a task from dispatch without changing its mindmap status (orchestrator pause).
- **Pause / resume run:** Halts or resumes automatic dispatch for the active run.
- **Stop:** Ends the run; no further automatic dispatch until a new start.
- **Recovery:** On each **project load** — restoring the app session (last open project), switching to a cached project tab, or cold-opening a project — `reconcileGraphOrchestration` re-reads in-flight tasks and `last_agent_runs`, then re-attaches agent communication watches.

## Persistence

`graph_orchestration` is stored in `project_config.json` with:

- `run_id`, optional `root_task_id`, optional `descendants_only`, `status`, `paused_task_ids`, `active_task_ids`, `last_agent_runs`, and `transitions`.

Agent polling stays in `AgentCommunicationsService` (`ensureTaskWatch`); orchestration code does not poll Cursor directly.

## Related modules

- `src/app/core/graph-orchestration.ts` — pure planning, scope, pause, completion, recovery helpers
- `src/app/core/task-ready.ts` — dispatch candidacy and prerequisites
- `src/app/data/local-engine.ts` — `startGraphOrchestration`, `advanceGraphOrchestration`, stop/pause APIs
