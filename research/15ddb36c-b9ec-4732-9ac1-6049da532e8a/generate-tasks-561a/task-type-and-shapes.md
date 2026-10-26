# Task types and mindmap shapes

Canonical mapping for the **Generate Tasks** and **task editor** workstreams.

## Human-specified shape legend

| Concept | Shape | Battleplan implementation target |
|---------|--------|----------------------------------|
| Project / subproject | Circle | Existing `.map-node.circle` + `shape: 'subproject' \| 'project'` |
| Code | Rounded rectangle | Existing `.map-node.code` (`border-radius: 16px`) |
| Critique | Diamond | Existing `.map-node.decision` (rotated square); `node_kind: 'critique'` |
| Brainstorm | Cloud | Existing `.map-node.cloud` mask; **`node_kind: 'brainstorm'` only** |
| Research | Vertical cylinder (database icon) | **New** CSS + `shape: 'research'`; remove research from cloud binding |
| Architecture | Hexagon | Existing `.map-node.process` clip-path hexagon; `node_kind: 'architect'` |

## Workflow kind → stored fields

From `workflow-task-kind.ts` (already shipped):

| UI label (proposed) | `task_kind` | `output_type` | `node_kind` | Mindmap `shape` (target) |
|---------------------|-------------|---------------|-------------|---------------------------|
| code | `code` | `code` | `work` | `code` |
| research | `research` | `research` | `work` | **`research` (cylinder)** |
| brainstorm | `brainstorming` | `research` | `brainstorm` | `brainstorm` → cloud |
| critique | `critiquing` | `research` | `critique` | `decision` → diamond |
| architecture | `architect` | `research` | `architect` | `architect` → hexagon |
| subproject | (none) | `subproject` | — | `subproject` → circle |

Aliases already accepted in JSON: `brainstorm`, `critique`, `architecture`, etc. (`WORKFLOW_ALIASES`).

## Current bugs (verified in repo)

1. **`app.component.html`** — `[class.cloud]` includes `node.shape === 'research'`, so **research tasks render as clouds**, not cylinders.
2. **`mindmap.ts`** — Plain `output_type === 'research'` without `node_kind` maps to shape **`research`**, but CSS treats research as cloud (above).
3. **Task editor** — Type `<select>` binds `outputType` only (`code` \| `research` \| `subproject`); no way to set `node_kind` / `task_kind` for brainstorm, critique, architecture without manual data patch.

## UI design options (for implementation task)

**Option A — Single “Kind” dropdown** (recommended)

Replace or augment **Type** with **Task kind** enum matching `WORKFLOW_TASK_KINDS` + **Subproject**. On change:

- Call `workflowKindToTaskFields(kind)` to set `output_type`, `node_kind`, `lifecycle_phase`.
- Keep `output_type === 'subproject'` as separate value.

**Option B — Type + Node kind** (two dropdowns)

Matches graph-of-agents editor follow-up; more flexible but heavier UX.

## Mindmap rendering tasks

1. Add `.map-node.research` (cylinder SVG mask or pseudo-element stack — vertical pill with elliptical caps).
2. Change cloud binding to **`brainstorm` and `fog` only** (not `research`).
3. Ensure `critique` uses `decision` shape (already in `mindmap.ts` when `node_kind === 'critique'`).
4. Add Vitest or screenshot test listing `shapeForTask(task)` expectations (table above).

## Generate Tasks JSON

Agent should prefer **`task_kind`** over bare `output_type` so shapes survive import (`resolveDraftFieldsFromWorkflow` in create path).

Example layer-1 mix under a research parent:

```json
{
  "tasks": [
    {
      "title": "Explore scope",
      "task_kind": "brainstorming",
      "depends_on": [],
      "prompt": "...",
      "brief": { "...": "..." }
    },
    {
      "title": "Implement feature",
      "task_kind": "code",
      "depends_on": [],
      "prompt": "...",
      "brief": { "...": "..." }
    }
  ]
}
```

After import, layer-1 tasks appear as children of the research node; shapes follow `task_kind`.
