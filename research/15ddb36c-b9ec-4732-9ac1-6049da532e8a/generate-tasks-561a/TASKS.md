# Generate Tasks — Implementation Tasks

Ordered tasks to implement **layered Generate Tasks**, **task kind dropdown**, **mindmap shape fixes**, and **git folder references**. Foundation JSON/`task_kind` support already exists on `develop` (`workflow-task-kind.ts`, `generate-tasks.ts`, `docs/GENERATE_TASKS.md`).

**Protocol spec:** [layered-generate-protocol.md](./layered-generate-protocol.md)  
**Shape mapping:** [task-type-and-shapes.md](./task-type-and-shapes.md)

---

## Task 1 — Mindmap shape corrections

**Goal:** Mindmap matches the shape legend (research = cylinder, brainstorm = cloud, critique = diamond, architecture = hexagon, code = rounded rect, subproject/project = circle).

**Steps:**

1. **`src/styles.scss`** — Add `.map-node.research` cylinder styling (SVG mask or border-radius stack). Do not reuse `.cloud` for research.
2. **`src/app/app.component.html`** — Update `[class.cloud]` to apply only to `brainstorm` and `fog` (remove `research`).
3. **`src/app/app.component.html`** — Add `[class.research]="node.shape === 'research'"` (or equivalent).
4. **`src/app/core/mindmap.ts`** — Confirm shape resolution order: `node_kind` overrides before bare `output_type` (already mostly true); add unit tests in `mindmap` or dedicated spec for the matrix in [task-type-and-shapes.md](./task-type-and-shapes.md).
5. **Legend / docs** — Optional one-line legend on mindmap for stencil shapes (follow-up if UX asks).

**Acceptance criteria:**

- Research task with default `node_kind` renders **cylinder**, not cloud.
- Brainstorm node renders **cloud**.
- Critique renders **diamond**; architect renders **hexagon**.
- Subproject and project remain **circles**.

**Suggested agent prompt:** “Implement Task 1 from `research/.../generate-tasks-561a/TASKS.md`; add Vitest coverage for `shapeForTask` expectations.”

---

## Task 2 — Task kind dropdown on task page

**Goal:** Task editor exposes brainstorm, critique, architecture (and existing code, research, subproject) with correct persisted fields.

**Steps:**

1. Replace or extend the **Type** `<select>` in `app.component.html` (task meta row) with **Task kind** values: `code`, `research`, `brainstorming`, `critiquing`, `architect`, `subproject`.
2. **`app.component.ts`** — On kind change, map via `workflowKindToTaskFields` + set `output_type`; for subproject keep existing subproject behavior.
3. **`battleplan-store.service.ts` / `updateTask`** — Persist `node_kind`, `lifecycle_phase` when kind changes (extend patch if not already exposed).
4. **`taskWorkflowHint()`** — Ensure hints from `task-workflow-lifecycle.ts` match selected kind.
5. **Migration** — Existing tasks: infer kind from `node_kind` + `output_type` when opening editor (no data migration file required).

**Acceptance criteria:**

- User can set a task to **brainstorm / critique / architecture** from the panel without editing JSON.
- Reload preserves kind; mindmap shape updates per Task 1.
- Subproject still has no agent selector row.

---

## Task 3 — Generate Tasks session model (store + UI)

**Goal:** Clicking **Generate Tasks** starts a **multi-round session** instead of a single import.

**Steps:**

1. Add **`GenerateTasksSession`** state to `battleplan-store.service.ts`:
   - `sourceTaskId`, `layer` (number), `phase`: `'idle' | 'review' | 'awaiting_json'`, `approvedTitles[]` optional cache.
2. **`generateTasks()`** — If no active session, set parent research to **DOING**, send **layer-1 title proposal** prompt (new template in `generate-tasks.ts`), set `intent: 'generate_tasks'`, **do not** call `importGeneratedTasksFromReply` until layer JSON arrives.
3. **Chat send path** — When session active, append user grilling replies as normal chat; detect agent messages that are **title lists** vs **JSON** (reuse `parseGeneratedTasksFromSources` try/catch or layer marker).
4. **UI** — Banner on task panel: “Generate Tasks session — Layer N — reply with approve/disapprove/change or END.” Disable duplicate **Generate Tasks** button while session active.
5. **`END` handling** — Clear session; set parent research **DONE** (respect manual status locks if any).

**Acceptance criteria:**

- One-shot import no longer runs on first assistant reply during session.
- User can iterate approve/disapprove/change within a layer.
- **END** completes session and sets parent **DONE**.

---

## Task 4 — Layer prompts and agent instructions

**Goal:** Cursor agent follows layered protocol (titles first, JSON only after approval, git briefs before JSON).

**Steps:**

1. Add **`generateTasksLayerProposalInstruction(layer, parentContext)`** and **`generateTasksLayerCommitInstruction(layer)`** in `generate-tasks.ts`.
2. Include standing rules from [layered-generate-protocol.md](./layered-generate-protocol.md) (numbered lists, recompute on change, no JSON until approved).
3. **`wrapAgentRunPrompt`** — Ensure research task DAR + project DAR still prepend.
4. **Tests** — `generate-tasks.test.ts` asserts layer-1 prompt mentions approve/disapprove/change and forbids premature JSON.

**Acceptance criteria:**

- First run message asks for title review, not full task graph JSON.
- Commit prompt requires git brief files + JSON with `tasks` array.

---

## Task 5 — Per-layer JSON import and mindmap update

**Goal:** After each approved layer, Battleplan imports **only that layer’s** tasks and wires edges to previous layer.

**Steps:**

1. **`importGeneratedTasksFromReply`** — Accept optional `session` context; increment `session.layer` after successful import.
2. Reuse **`validateAndRepairGeneratedTasks`** + **`createTasks`** with `parentTaskId` = research task for layer 1; layer 2+ uses `depends_on` from JSON only.
3. **`prepareGeneratedDrafts`** — For layer > 1, **do not** force all tasks under research task; only layer 1 gets empty `depends_on` anchoring.
4. After import, trigger **`reloadTasks`** (existing) and optional camera focus on new nodes.
5. Auto-send next **layer proposal** user message (or agent continues in same run if Cursor supports follow-up).

**Acceptance criteria:**

- Mindmap grows incrementally per layer.
- Layer-2 tasks attach to correct layer-1 parents, not all to research root.
- Validation/repair loop (max 2) still works per layer.

---

## Task 6 — Git brief creation and `repo_path`

**Goal:** Each generated task references its git folder; agent writes brief collateral under `research/{project_id}/{task_id}/`.

**Steps:**

1. Extend **`ProjectTask` / `TaskDraft`** with optional **`repo_path`** (string, trailing slash).
2. **`createTasks`** — Default `repo_path` to `research/{project_id}/{task_id}/`; persist on research/code output metadata where applicable.
3. **Task editor** — Show read-only or editable **Repo folder** field (reuse research output path UX).
4. **Execute** — Include `repo_path` in agent prompt (`local-engine.ts` research/code execute builders).
5. **Layer commit** — Document agent workflow: push brief files to branch, then emit JSON. Optional: Battleplan **polls git** after import to verify folder exists (soft warning).

**Acceptance criteria:**

- New tasks display correct folder path immediately after import.
- Executing agent sees path in prompt and can load brief/README from repo.

---

## Task 7 — Parent research status DOING/DONE

**Goal:** Parent research stays **DOING** for entire Generate Tasks session.

**Steps:**

1. On session start: **`applyTaskStatusTransition(source, 'DOING', 'generate_tasks_session')`** (add reason if enum extended).
2. On session complete (**END** or no next layer): transition parent to **DONE** unless user had set BLOCKED/ABANDONED.
3. Do not auto-**DONE** on intermediate layer imports.
4. **Tests** — store unit test or integration test for status timeline.

**Acceptance criteria:**

- Parent shows DOING while user grills layer 2+.
- Parent shows DONE only when session ends.

---

## Task 8 — Documentation and regression tests

**Goal:** Docs match shipped behavior; CI covers protocol edge cases.

**Steps:**

1. Rewrite **`docs/GENERATE_TASKS.md`** for layered flow (keep JSON reference table).
2. Add **`docs/GENERATE_TASKS_LAYERED.md`** short user guide (approve/disapprove/change/END examples).
3. Vitest: shape matrix, session state transitions, layer-1 vs layer-2 anchoring in `prepareGeneratedDrafts` / new helper **`prepareGeneratedDraftsForLayer`**.

**Acceptance criteria:**

- README link from main README optional.
- All new tests pass in CI.

---

## Suggested implementation order

1 → 2 (shapes + editor visible) → 3 → 4 → 5 → 6 → 7 → 8

Tasks 3–5 are the critical path; 6–7 can parallelize after 5.

---

## Out of scope (explicit)

- Graph-delta ghost nodes ([d51c-graph-of-agents/TASKS.md](../d51c-graph-of-agents/TASKS.md) Task 2) — optional later integration.
- Project-level Generate Tasks (no research parent) — keep one-shot or add separate protocol in follow-up.
