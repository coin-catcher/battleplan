# Graph of Agents

Battleplan is the **canonical plan graph** (mindmap): goals, dependencies, human decision nodes, and what each task is told. Execution backends—Cursor cloud agents, Hermes kanban workers, research HTTP adapters—are **connectors** that run released nodes and stream status back.

## Ownership

| Data | Owner |
|------|--------|
| Plan fields (goal, brief, edges, kind, skills, context, agent binding) | Battleplan — editable until released |
| Execution state (status, run id, logs, handoff) | Backend connector |
| Evidence / verifier verdicts | Backend produces; Battleplan records; human decides |
| Runtime graph mutations | Proposals — human accepts or rejects |

## Task brief (pstack)

Optional `brief` on `ProjectTask` uses the pstack template: **GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING**. If any brief field is set, **all** fields are required before **Execute** (`task-brief.ts`).

Generate Tasks JSON may include a nested `brief` object or extended fields (`node_kind`, `loop_mode`, `connector_kind`). See [GENERATE_TASKS.md](./GENERATE_TASKS.md).

## Graph-delta pipeline

`graph-delta.ts` models proposed changes (`add_node`, `add_edge`, `patch_node`, …) from Generate Tasks, grilling sessions, Hermes decomposers, or imports. v1 wraps existing Generate Tasks output; UI ghost nodes and accept/reject are follow-on tasks.

## Connectors and Hermes

`agent-connector.ts` defines connector kinds and **Hermes ↔ Battleplan** status mapping. Releasing a task to Hermes should use `backend_idempotency_key` (defaults to `task_id` on create).

Decision and fog nodes (`node_kind`) are **not** dispatched to backends.

## Skill stacks

Skills own **how** work runs inside a node; Battleplan owns **which** node runs, with what context, and what the human sees. Graph-owning playbooks (pstack `orchestrate`, Matt `wayfinder` as map owner) should run as black-box nodes or leaf playbooks per task—not as a second plan store.

## Research deliverables

Implementation task breakdown: `research/15ddb36c-b9ec-4732-9ac1-6049da532e8a/d51c-graph-of-agents/TASKS.md`.
