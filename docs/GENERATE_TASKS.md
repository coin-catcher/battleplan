# Generate Tasks

**Generate Tasks** turns a settled Cursor conversation into Battleplan task nodes on the mindmap. It is available from the project chat toolbar and from an open task (typically a **research** task after the agent has produced a plan).

## End-to-end flow

1. **User** clicks **Generate Tasks** in the right-hand panel (`BattleplanStore.generateTasks()`).
2. **Scope**
   - **Project chat**: sends a generate instruction to the project’s Cursor agent (`LocalEngine.generateTasks`).
   - **Task chat**: sends a task-specific message to that task’s agent (or the project agent if the task has not started its own) via `LocalEngine.generateTaskTasks`.
3. **Cursor** runs with `intent: 'generate_tasks'`. The app waits for the run to finish and reloads messages/artifacts.
4. **Parse** — `parseGeneratedTasksFromSources()` reads `{ "tasks": [...], "edges": [...] }` (or a bare task array) from the assistant reply or a `.json` artifact (`parse-tasks.ts`).
5. **Validate** — `validateAndRepairGeneratedTasks()` simulates the mindmap graph (tree, ordering, fork/join/cycle) before any tasks are created. Missing `break_condition` on `cycle` edges is auto-filled (`human:REVIEW`). If validation still fails, Battleplan sends up to **two** repair prompts to the Cursor agent with the error list, then imports or shows a clear error (`validate-generated-tasks.ts`, `BattleplanStore.importGeneratedTasksFromReply`).
6. **Anchor (task scope only)** — when Generate Tasks is invoked from a task panel, Battleplan passes that task’s id into `createTasks()`. Drafts with empty `depends_on` get the source task title as a fallback; any generated task still without a tree parent is linked under the **source task id** (`linkCreatedTasksUnderParent()` in `generate-task-links.ts`).
7. **Create** — `LocalEngine.createTasks()` normalizes drafts, creates `ProjectTask` rows, wires the mindmap graph (`bindDraftDependsOn()`), and applies **`sequential_with`** as one-way ordering among conflicting code tasks (`bindSequentialDraftLinks()`).
8. **UI** — tasks reload; new nodes appear on the left-hand mindmap.

## JSON shape the agent must return

Preferred top-level object:

```json
{ "tasks": [ ... ], "edges": [ ... ] }
```

Each task object:

| Field | Meaning |
|--------|---------|
| `title` | Short label on the mindmap |
| `prompt` | Becomes the task **initial prompt** (what Execute sends to the agent) |
| `task_kind` | Workflow stencil: `brainstorming`, `research`, `critiquing`, `code`, or `architect` (maps to mindmap shape + `output_type` / `node_kind`) |
| `output_type` | `"code"` or `"research"` when not using `task_kind` |
| `depends_on` | Titles of **parent** tasks in this batch (tree links) |
| `sequential_with` | Titles that must not run in parallel; later tasks in the batch wait for earlier ones |
| `brief` | **Required** pstack object (`goal`, `scope`, `context`, `acceptance`, `verify`, `timebox`, `forbidden`, `report`, `standing`). Omitted fields are filled from **`buildDefaultTaskBrief`** at create time |
| `node_kind` | Optional override: `work`, `decision`, `gate`, `fog`, `brainstorm`, `architect`, `critique` (dispatched critiquing agent; diamond shape) |

Execution behavior per stencil: [TASK_WORKFLOW_LIFECYCLES.md](./TASK_WORKFLOW_LIFECYCLES.md).
| `loop_mode` | Optional `HITL` or `AFK` |
| `connector_kind` | Optional execution backend |

Optional `edges` array (graph links beyond tree/ordering):

| Field | Meaning |
|--------|---------|
| `from`, `to` | Task titles |
| `kind` | `tree`, `ordering`, `fork`, `join`, or `cycle` (`fan-out`, `fan-in`, `loop` aliases) |
| `break_condition` | **Required** on every `cycle` / loop edge (e.g. `human:REVIEW`) |

See [GRAPH_OF_AGENTS.md](./GRAPH_OF_AGENTS.md).

## How the mindmap graph is built

Battleplan stores dependencies as **parent → child** links: `parent.dependencies` contains child task IDs (`dependencies.ts`).

When `bindDependencies()` processes a draft:

- For each title `T` in the draft’s `depends_on`, the task named `T` is the **parent**, and the new task is added as **T’s child** on the mindmap.

So:

- `depends_on: []` at project scope → new tasks are **roots** attached directly to the **project** circle.
- `depends_on: []` at research-task scope → after anchoring, `depends_on: ["<research title>"]` → new tasks appear as **children of that research node**.
- `depends_on: ["Foundation task"]` → the new task is drawn **under** “Foundation task”.

The layout engine (`mindmap.ts`) places root tasks in a ring around the project and hangs children outward from their parent. **Many `depends_on` links between generated tasks produce a deep tree** (for example a parent “Ship skills catalog v1” with multiple nested code children), which is what you see when the agent emits a hierarchical plan.

## Research task: intended default vs advanced plans

### Default (base case)

After a **research** task conversation, you usually want:

- A **flat, one-dimensional list of code tasks** — siblings under the research node.
- **No** research tasks in that list unless you explicitly need another research pass.
- **`depends_on: []`** on each generated code task (Battleplan anchors them under the research task automatically).

The research-specific prompt in `generate-tasks.ts` tells the agent to follow that shape.

### Advanced (when prerequisites are real)

Use extra structure only when the plan needs it:

| Need | Typical tasks |
|------|----------------|
| Data not yet collected | Child **research** task; optionally a small **code** child to automate retrieval |
| Shared interfaces / base classes / process template | **Foundation code** task first; other code tasks list it in `depends_on` |

Avoid long chains of code→code dependencies unless execution order truly requires it.

## Project-level Generate Tasks

From **project chat**, the instruction is broader (`generateTasksInstructionForProject()`): decompose the whole battleplan. The agent may emit both research and code tasks and may use `depends_on` for real ordering. Nothing is auto-anchored to a single parent task.

## Code references

| Piece | Location |
|--------|-----------|
| UI button | `app.component.html` → `store.generateTasks()` |
| Orchestration | `battleplan-store.service.ts` → `generateTasks()` |
| Agent messages | `local-engine.ts` → `generateTasks`, `generateTaskTasks` |
| Prompts + anchoring | `core/generate-tasks.ts` |
| JSON parsing | `core/parse-tasks.ts` |
| Persist + graph | `local-engine.ts` → `createTasks`, `bindDependencies` |
| Layout | `core/mindmap.ts`, `core/dependencies.ts` |

## Tips for consistent flat lists from research

1. Run **Generate Tasks** from the **research task** (not project chat) so anchoring applies.
2. In the research task **Data and Rules**, state that output should be a **flat list of code tasks** with no nested dependencies unless prerequisites are required.
3. If the agent still returns a deep graph, edit tasks on the mindmap or regenerate after clarifying in chat that siblings should use empty `depends_on`.
