# Graph of Agents — Implementation Tasks

Ordered tasks to unify Battleplan’s canonical plan graph with Hermes, Cursor, skill stacks, and memory—without dual-writing orchestration state.

**Foundation already on branch `cursor/graph-of-agents-d51c`:** task brief schema, graph-delta model, Hermes status mapping, extended `ProjectTask` / Generate Tasks JSON, decision/fog execute guard, mindmap shapes.

---

## Task 1 — Task brief editor and standing orders merge

**Goal:** Humans can view and edit the pstack brief on a task; project DAR continues as standing orders.

**Prompt:** Add a Brief section to the task editor (right panel) with nine fields matching `task-brief.ts`. On Execute, prepend `formatTaskBriefMarkdown(brief)` to the agent message when brief is complete. Show validation errors inline when Execute fails `assertTaskBriefReadyForRelease`.

**Steps:**

1. Extend `updateTask` patch in `local-engine.ts` for `brief`, `node_kind`, `loop_mode`, `connector_kind`.
2. Task editor UI: collapsible Brief form bound to store.
3. Optional: “Import brief from grill session” reads markdown sections.

**Acceptance:**

- Saving brief persists in `task_config.json`.
- Partial brief blocks Execute with a clear message.
- Tasks without brief behave as today.

---

## Task 2 — Graph-delta UI (ghost nodes)

**Goal:** Proposals from any source appear as ghost nodes/edges until accepted.

**Prompt:** Implement `BattleplanStore.proposeGraphDelta(proposal)` storing pending ops in project doc. Mindmap renders ghosts with dashed outline. Toolbar **Accept** / **Reject** applies ops via `createTasks`-like logic or patches.

**Steps:**

1. Persist `graph_delta_queue?: GraphDeltaProposal[]` on `ProjectDocument`.
2. `applyGraphDeltaProposal()` — reuse `normalizeDrafts` + `bindDependencies`.
3. Mindmap layer for ghost styling.

**Acceptance:**

- Generate Tasks can optionally route through propose → accept (feature flag).
- Reject removes ghosts without touching canonical tasks.

---

## Task 3 — Interactive grilling sessions

**Goal:** First-class HITL sessions bound to a decision node, plain-text chat (no answer chips).

**Prompt:** Add `InteractiveSession` on task: `{ skill_bundle, transcript_path }`. Open session loads Matt-style grill skill text from skill registry. On completion, skill output (ticket files or JSON) feeds Task 2 pipeline.

**Steps:**

1. Session kind in selection model `{ kind: 'session'; taskId }`.
2. Chat panel reuses research adapter or local completion when no tools required.
3. Import `.scratch/.../issues/*.md` via graph-delta.

**Acceptance:**

- Decision node with `loop_mode: HITL` opens session, not Execute.
- Round-based frontier questions remain plain markdown in chat.

---

## Task 4 — Skill registry with pinning

**Goal:** Track installed stacks, versions, hashes, and per-node bundles; warn on capability mismatch.

**Prompt:** Extend `project_config.json` with `skills_registry: { installs[], pins{} }`. UI lists skills from `skills.external_dirs` pattern (Hermes-compatible). Node editor multi-select skills; match against agent capabilities (shell, MCP, browser, subagents).

**Acceptance:**

- Pin prevents silent skill edits from changing behavior mid-run.
- Warn when pstack `orchestrate` selected on Hermes worker (no Task tool).

---

## Task 5 — Hermes connector spike

**Goal:** Prove Battleplan can release one task to Hermes with idempotency and receive status events.

**Prompt:** Spike Hermes REST/WebSocket auth (dashboard token vs stable API). Implement `HermesConnector.release(task)` using `backend_idempotency_key`. Map statuses via `mapHermesStatusToBattleplan`. Document human/unassigned card support.

**Acceptance:**

- One card created per released task; retry safe.
- Status DOING/REVIEW/DONE observed in Battleplan within 30s of Hermes transition.

---

## Task 6 — Connector registry and release budget

**Goal:** Multiple backends with concurrency caps and health.

**Prompt:** Add `connectors[]` to project doc per `connector-schema.json`. Release scheduler respects `max_in_progress` per connector and project-wide ceiling. Default code path remains Cursor when `connector_kind` unset.

**Acceptance:**

- Two Hermes connectors (two endpoints) can each run work in parallel up to cap.
- Unhealthy connector blocks release with user-visible reason.

---

## Task 7 — Observed status + user commands

**Goal:** Backend-run tasks use observed state; user overrides remain `manual` trigger.

**Prompt:** Refactor `task-state-machine.ts` docs: for `connector_kind !== undefined`, allow Hermes/Cursor to drive transitions; user drag still uses `manual`. Prevent editing plan fields on running tasks (match Hermes “no new parent on running child”).

**Acceptance:**

- Hermes promotes todo→running without Battleplan inventing triggers.
- User can still manually BLOCK or ABANDON.

---

## Task 8 — Unified handoff payload

**Goal:** Handoff carries summary, metadata JSON, branch, SHA, artifact paths.

**Prompt:** Define `BackendHandoff` persistence on task doc after run completes. Display in task output panel. Merge Matt integration-branch and pstack stacked-PR policies as **per-edge code_flow_policy** enum: `merge_first | integration_branch | stacked`.

**Acceptance:**

- Child task context manifest lists parent handoff pointers.
- Code flow policy visible on mindmap edge tooltip.

---

## Task 9 — Context manifest editor

**Goal:** Explicit control of memory refs, skills, glossary, ADRs, upstream handoffs in agent context.

**Prompt:** Add `context_manifest: { pointers[], inline? }` on task. Default pointers-only; inline only for cloud agents without repo access. Link to Mnemosyne/Hindsight refs (paths or URIs).

**Acceptance:**

- Execute builds prompt from manifest + brief + DAR.
- UI shows which memory entries are included per task.

---

## Task 10 — Memory views (Mnemosyne / Hindsight)

**Goal:** Fourth project view: memory contents, relationships, metrics, and graph inclusion map.

**Prompt:** Add left-nav tab **Memory** beside mindmap. Read-only v1: index local Mnemosyne paths configured in project settings. Highlight tasks that reference each entry via manifest.

**Acceptance:**

- Cross-link from task manifest to memory entry and back.

---

## Task 11 — Kanban view

**Goal:** Flat kanban of tasks with assignee agent profile and status across connectors.

**Prompt:** Derive columns from `TaskStatus`; rows show task title, `connector_kind`, bound agent name, last heartbeat. Filter by subproject.

**Acceptance:**

- Drag column changes status with same rules as mindmap (manual trigger).

---

## Task 12 — Attention inbox

**Goal:** Batch gates, needs_input, review requests, fog decisions across projects.

**Prompt:** Aggregate `node_kind === 'gate' | 'decision'`, BLOCKED, REVIEW, fog nodes. pstack-style default answers for parked gates.

**Acceptance:**

- Single inbox lists actionable items with deep links to mindmap selection.

---

## Task 13 — Config system (cloud resources)

**Goal:** Manage GitHub, AWS, Azure, IBM Cloud configs for agents—not only PAT in project.

**Prompt:** Encrypted-or-plaintext v1 config vault in project doc or sidecar `resources.json` with typed entries referenced from agent options and manifests.

**Acceptance:**

- Agent test connection can resolve resource refs by id.

---

## Task 14 — Import Matt to-tickets / Addy plan.md / pstack units

**Goal:** Graph-delta sources beyond Generate Tasks.

**Prompt:** Importers: `.scratch/.../issues/*.md` (Blocked by), `tasks/todo.md`, `units.tsv` + `frontier.json`. Each emits `GraphDeltaProposal` with `source` set.

**Acceptance:**

- Round-trip spike: grill-with-docs → local tickets → import → accept → mindmap matches file graph.

---

## Task 15 — PR policy overlay for skill stacks

**Goal:** Skills that create PRs respect Battleplan “push branch, stop” standing orders.

**Prompt:** Extend project DAR template with `PR_POLICY` block injected into every spawn (pstack `preferences.md` pattern). Document in agent editor for Cursor configs.

**Acceptance:**

- Code task with overlay never calls `createPullRequest` from `local-engine` wrappers (unchanged) and agents receive explicit stop instruction.

---

## Task 16 — Multi-agent parallel code CI

**Goal:** Branching + integration strategy with simultaneous agents.

**Prompt:** Document and enforce per-edge `code_flow_policy`; integration branch task type; `sequential_with` for blast-radius (Pocock). Align with `docs/AGENT_BRANCH_AND_PRS.md`.

**Acceptance:**

- Two code tasks with `sequential_with` never Execute in same `executeChildren` batch (already true); integration branch policy tested in vitest.

---

## Task 17 — Mindmap fan-in QA

**Goal:** Confirm multi-parent sibling and tree fan-in render correctly.

**Prompt:** Add `mindmap.test.ts` cases: two tasks with `sibling_dependencies` pointing to same target; multiple parents listing same child. Fix layout overlap if needed.

**Acceptance:**

- All edges visible; labels legible at default zoom.

---

## Task 18 — Docker-backed local Hermes in desktop app

**Goal:** Battleplan Electron manages Hermes container lifecycle per subproject default.

**Prompt:** Subproject setting `default_hermes_connector_id`. Desktop starts/stops container; health check feeds connector registry.

**Acceptance:**

- Windows, Linux, macOS documented paths (WSL note for Windows).

---

## Task 19 — n8n bridge (lower priority)

**Goal:** Optional export/import of deterministic automation graphs.

**Prompt:** Export selected subgraph to n8n workflow JSON for ops tasks; import not required v1.

**Acceptance:**

- Manual export button on subproject menu.

---

## Task 20 — Harness limits (depth, fan-out, cost)

**Goal:** Battleplan enforces caps Matt/pstack defer to harness.

**Prompt:** Project settings: max spawn depth, max parallel releases, cost ceiling. Pre-approve dialog shows estimated worker count before accepting graph delta.

**Acceptance:**

- Exceeding cap blocks accept with explanation.

---

## Suggested order

1. Tasks **1, 2, 17** (brief UI, delta UI, fan-in QA)
2. Spikes **5, 6, 7** (Hermes + connectors + observed status)
3. **3, 4, 14** (grilling + skills + importers)
4. Views **10, 11, 12** (memory, kanban, inbox)
5. **8, 9, 15, 16** (handoff, manifest, PR policy, CI)
6. **13, 18, 19, 20** (resources, Docker, n8n, limits)

---

## Design tree (summary)

- **Canonical graph:** Battleplan mindmap + task configs
- **Execution:** Connector per backend; Hermes default local; Cursor default cloud code
- **Planning input:** Graph-delta from Generate Tasks, grilling, imports
- **Task definition:** pstack brief + output_type + node_kind + loop_mode
- **Skills:** Registry + node bundles; no orchestrate-as-owner
- **Memory:** Git canonical docs + Mnemosyne/Hindsight derived
- **Views:** Mindmap, memory, kanban, attention inbox, config
- **CI/CD:** code_flow_policy per edge + sequential_with blast radius
