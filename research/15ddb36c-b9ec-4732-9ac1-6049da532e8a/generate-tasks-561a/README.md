# Generate Tasks — layered task graph (research summary)

**Battleplan research task:** Replace one-shot **Generate Tasks** with a **layer-by-layer** grilling workflow, fix **task type** selection on the task page, and align **mindmap node shapes** with workflow stencils. Parent research task stays **DOING** until the user ends the session or the agent has no further layers.

**Agent branch for this research:** `cursor/generate-tasks-561a` (no application code changes in this task).

## Problem (today)

| Area | Current behavior | Desired behavior (human spec) |
|------|------------------|-------------------------------|
| **Generate Tasks** | Single Cursor run → parse full JSON → create all tasks at once (`battleplan-store.service.ts` → `generateTasks()`) | Multi-round chat: propose **layer N** titles only → user **approve / disapprove / change** per item → on full approval, write briefs to git + emit JSON → import layer → repeat until **END** or no more layers |
| **Task page Type dropdown** | `output_type` only: `code`, `research`, `subproject` (`app.component.html`) | Expose workflow types including **brainstorm**, **critique**, **architecture** (and keep subproject where appropriate) |
| **Mindmap shapes** | `research` nodes use **cloud** CSS (`app.component.html` binds `cloud` for `research \| fog \| brainstorm`); generic `output_type === 'research'` → shape `research` in `mindmap.ts` | **Subproject/project** circle; **code** rounded rect; **critique** diamond; **brainstorm** cloud; **research** vertical cylinder; **architecture** hexagon |
| **Git collateral** | Path default `research/{project_id}/{task_id}/` on research execute (`local-engine.ts`) | Every generated task must carry/repo-reference its folder so execute agents load brief + files |
| **Parent status** | Generate Tasks does not force parent research **DOING** for the whole session | Parent research **DOING** for entire layered session; **DONE** when workflow ends |

Backend **already supports** extended Generate Tasks JSON (`task_kind`, `node_kind`, `brief`, edges) via `workflow-task-kind.ts`, `generate-tasks.ts`, and `docs/GENERATE_TASKS.md`. The gap is **UI**, **shape rendering**, and **orchestration** of the new conversation protocol—not the core draft normalizer.

## Proposed definition of done (DoD) — confirm with human

Research for this task is **done** when all of the following exist under `research/{project_id}/{task_id}/` and match human approval:

1. **README.md** (this file) — problem, principles, gap table, DoD.
2. **TASKS.md** — ordered implementation tasks with steps, acceptance criteria, and suggested agent prompts (no app code in *this* research task).
3. **layered-generate-protocol.md** — agent ↔ user message formats, JSON contract per layer, git brief layout, parent/child linking rules.
4. **task-type-and-shapes.md** — canonical mapping from UI selection → `ProjectTask` fields → mindmap shape.
5. **references.json** — in-repo file pointers and external docs.
6. **dod-checklist.md** — self-check pass/fail against the human spec (updated each grilling round).

**Out of scope for this research task:** shipping TypeScript changes (forbidden). Implementation is tracked in **TASKS.md** for a follow-on **code** task.

## Open question (blocker for path strictness)

Battleplan normally stores artifacts at `research/{project_id}/{task_id}/` using the task’s UUID. This folder uses the slug **`generate-tasks-561a`** to match the agent branch until the human confirms the canonical **`task_id`** UUID for this research node.

## Sources

See [references.json](./references.json) and [TASKS.md](./TASKS.md).
