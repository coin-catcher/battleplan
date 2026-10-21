# Graph of Agents — Research Summary

**BattlePlan research/code task:** unify the mindmap plan graph with Hermes kanban, Cursor cloud agents, skill-stack grilling, and memory systems—while Battleplan remains the human-facing harness.

## Problem

Battleplan already orchestrates ideation (mindmap), task execution (Cursor + Agent Library research adapters), and release workflow. Hermes, n8n, and skill stacks (Pocock, Osmani, pstack) each carry their own task-graph semantics. Without a single canonical plan graph and connector layer, graphs diverge, dual-writes appear, and grilling output cannot be managed in the UI.

## Principles (agreed design)

1. **Battleplan owns the plan** — nodes, edges, briefs, context manifests, human decision/fog nodes.
2. **Backends own execution** — Hermes, Cursor, research HTTP; status flows back via observations (WebSocket / poll).
3. **Skills own procedure inside a node** — not which node runs when (except black-box graph-owning playbooks run as import-only nodes).
4. **Graph-delta pipeline** — every source (Generate Tasks, grill-me, Hermes decomposer, ticket imports) emits proposals; humans accept/reject before merge.
5. **pstack brief** — canonical task fields; refuse release when brief is partial.
6. **Multi-connector** — several Hermes installs + Cursor + research agents; Battleplan enforces release budgets.

## Deliverables in this folder

| File | Purpose |
|------|---------|
| [TASKS.md](./TASKS.md) | Ordered implementation tasks with acceptance criteria and agent prompts |
| [task-brief-schema.json](./task-brief-schema.json) | JSON Schema for pstack brief on `ProjectTask` |
| [connector-schema.json](./connector-schema.json) | JSON Schema for project-level connector registry (v2) |
| [references.json](./references.json) | External links (Hermes, skill repos, Mnemosyne/Hindsight) |

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

**Interview status:** Round 1 frontier questions are open in the Graph of Agents agent chat until we confirm the design tree; no further implementation beyond foundation until you confirm shared understanding.

## Skill-stack presets (recommended)

| Use | Stack |
|-----|--------|
| Planning front end (grill → tickets) | Matt Pocock `grill-with-docs`, `to-tickets` |
| Lifecycle gates / personas | Addy Osmani agent-skills |
| Per-node rigor (Cursor-heavy) | pstack `feature`, `bug-fix`, `hillclimb` |
| Do **not** run as graph owner in Battleplan | pstack `orchestrate`, Matt `wayfinder` map-only without import |
