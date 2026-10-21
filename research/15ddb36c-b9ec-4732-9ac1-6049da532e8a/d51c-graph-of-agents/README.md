# Graph of Agents — Research Summary

**BattlePlan research/code task:** unify the mindmap plan graph with Hermes kanban, Cursor cloud agents, skill-stack grilling, and memory systems—while Battleplan remains the human-facing harness.

## Problem

Battleplan already orchestrates ideation (mindmap), task execution (Cursor + Agent Library research adapters), and release workflow. Hermes, n8n, and skill stacks (Pocock, Osmani, pstack) each carry their own task-graph semantics. Without a single canonical plan graph and connector layer, graphs diverge, dual-writes appear, and grilling output cannot be managed in the UI.

## Principles (agreed design)

1. **Battleplan owns the plan** — nodes, edges, briefs, context manifests, human decision/fog nodes.
2. **Backends own execution** — Hermes, Cursor, research HTTP; status flows back via observations (WebSocket / poll).
3. **Battleplan orchestrates the lifecycle** — skill stacks (Pocock, Osmani, pstack) merge into a Battleplan-flavored define → architect → build → verify → ship flow; tasks are atomic brief-backed units on mindmap/kanban; agents report status; handoffs cross local/cloud boundaries. Skills inform **how** work runs inside a task, not a second graph owner.
4. **Graph-delta pipeline** — every source (Generate Tasks, grill-me, Hermes decomposer, ticket imports) emits proposals; humans accept/reject before merge.
5. **pstack brief** — required on every task; defaults generated at create; editable in task editor.
6. **Multi-connector** — several Hermes installs + Cursor + research agents; Battleplan enforces release budgets.

## Deliverables in this folder

| File | Purpose |
|------|---------|
| [TASKS.md](./TASKS.md) | Ordered implementation tasks with acceptance criteria and agent prompts |
| [task-brief-schema.json](./task-brief-schema.json) | JSON Schema for pstack brief on `ProjectTask` |
| [connector-schema.json](./connector-schema.json) | JSON Schema for project-level connector registry (v2) |
| [references.json](./references.json) | External links (Hermes, skill repos, Mnemosyne/Hindsight) |
| [MEMORY_DESIGN_OPTIONS.md](./MEMORY_DESIGN_OPTIONS.md) | Pros/cons for memory v1 (Q2 open) |

## Code landed on branch `cursor/graph-of-agents-d51c` (foundation)

- `src/app/core/task-brief.ts` — brief validation and release guard
- `src/app/core/graph-delta.ts` — proposal ops model; wraps Generate Tasks
- `src/app/core/agent-connector.ts` — Hermes ↔ Battleplan status mapping
- `src/app/core/task-node-kind.ts` — decision / gate / fog / work
- Extended `ProjectTask`, `TaskDraft`, parse/create/execute paths
- `docs/GRAPH_OF_AGENTS.md` — architecture index

## Feature coverage (review feedback traceability)

| Desired capability | TASKS.md | Foundation code today |
|--------------------|----------|------------------------|
| Mindmap + editable task graph, outputs along edges | Tasks 2, 8, 17 | `dependencies`, `sibling_dependencies`, `graph-delta.ts` |
| Explicit memory in agent context | Tasks 9–10 | — |
| Memory contents / relationships / metrics view | Task 10 | — |
| Kanban (task, agent, status) | Task 11 | Status on `ProjectTask`; connector mapping in `agent-connector.ts` |
| Config for agents + cloud resources | Tasks 4, 6, 13 | Agent Library in `project_config.json` |
| Desktop (Windows, Linux, macOS) | Task 18 | Electron app (existing) |
| Interactive grilling → task graph | Tasks 3, 14 | `node_kind` decision/fog; graph-delta model |
| Multi-agent CI/CD (parallel code agents) | Tasks 15–16 | `sequential_with`, `docs/AGENT_BRANCH_AND_PRS.md` |
| Hermes local + Cursor cloud in one graph | Tasks 5–7 | `connector_kind`, Hermes status map |
| pstack brief + skill-stack ideas | Task 1 | `task-brief.ts`, optional on Execute |

**Interview status:** Round 2 answers recorded. Memory: **hybrid + Mnemosyne first** (Q1). Discover phase may shape arbitrary graphs (not a serial lifecycle pipeline).

| # | Decision |
|---|----------|
| 1 | Battleplan canonical plan graph |
| 2 | Hybrid memory: git canonical + Mnemosyne episodic via manifest pointers |
| 3 | Task brief required with generated defaults (**implemented**) |
| 4 | Plain-text grilling + graph-delta import |
| 5 | Default Hermes Docker per subproject |
| 6 | Defer n8n |
| 7 | Battleplan orchestrates lifecycle; skill stacks inform brief templates / phases, not black-box graph owners |
| 8 | Mindmap + kanban v1 (**kanban shipped** in sidebar toggle) |
| R2 | Standard handoff schema; default connectors; **auto-dispatch** when parents DONE (not manual release) |
| R2 Q4 | Lifecycle phases discover/architect/build/verify/ship — **Discover** may propose fan-in/out graphs freely |

## Skill-stack presets (recommended)

| Use | Stack |
|-----|--------|
| Planning front end (grill → tickets) | Matt Pocock `grill-with-docs`, `to-tickets` |
| Lifecycle gates / personas | Addy Osmani agent-skills |
| Per-node rigor (Cursor-heavy) | pstack `feature`, `bug-fix`, `hillclimb` |
| Do **not** run as graph owner in Battleplan | pstack `orchestrate`, Matt `wayfinder` map-only without import |
