# Task graph orchestration

Battleplan persists an orchestration run on each `Project` as `graph_orchestration`. The run interprets `task_graph_edges` (tree, ordering, fork, join, cycle), plans parallel dispatch via `orchestrationDispatchBatch`, records transitions, and recovers in-flight agent runs after reload.

## Run lifecycle

- **Start:** Mindmap **Run task graph** (whole project) or **Run subgraph** on a parent task (root + descendants).
- **While running:** Ready tasks dispatch through `LocalEngine.executeTask` with graph-based upstream inputs. Completing or approving a task triggers the next wave when `status === 'running'`.
- **Pause task:** Excludes a task from dispatch without changing its mindmap status (orchestrator pause).
- **Pause / resume run:** Halts or resumes automatic dispatch for the active run.
- **Stop:** Ends the run; no further automatic dispatch until a new start.
- **Recovery:** On app load and project select, `reconcileGraphOrchestration` re-reads `DOING` / `REVIEW` tasks and `last_agent_runs`, then re-attaches agent communication watches.

## Persistence

`graph_orchestration` is stored in `project_config.json` with:

- `run_id`, optional `root_task_id`, `status`, `paused_task_ids`, `active_task_ids`, `last_agent_runs`, and `transitions`.

Agent polling stays in `AgentCommunicationsService` (`ensureTaskWatch`); orchestration code does not poll Cursor directly.

## Related modules

- `src/app/core/graph-orchestration.ts` — pure planning, scope, pause, completion, recovery helpers
- `src/app/core/task-ready.ts` — dispatch candidacy and prerequisites
- `src/app/data/local-engine.ts` — `startGraphOrchestration`, `advanceGraphOrchestration`, stop/pause APIs
