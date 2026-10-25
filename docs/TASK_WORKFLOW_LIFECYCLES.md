# Task workflow lifecycles

Battleplan **workflow stencils** (`task_kind` / `node_kind`) specialize how agents behave when you **Execute** or chat on a task. They complement the pstack **task brief** and are injected into Cursor / research-agent system prompts.

## Idea → PR pipeline

Typical flow:

1. **Brainstorming** — multi-round grilling on the seed idea; when ready, **Generate Tasks** on that node.
2. **Task graph** — research, code, architect, and critique nodes with edges (fork/join/loops).
3. **Execute** — each task runs with its workflow preamble until DONE/REVIEW.
4. **Critique loops** — failed critique sends rework guidance upstream (cycle edges with `break_condition`).

## Brainstorming (`node_kind: brainstorm`)

- **Initial prompt**: user’s idea seed.
- **Agent behavior**: Matt-style grilling — each round reflects user input, adds ideas/facts (web, repo, context), presents **distilled understanding**, asks **follow-up questions**.
- **Completion**: human declares readiness; agent summarizes handoff for **Generate Tasks** (no product code in this task).
- **Defaults**: `loop_mode: HITL`, lifecycle `discover`, brief scope/verify tuned in `task-workflow-lifecycle.ts`.

## Research (`node_kind: work`, `output_type: research`)

- **Grill first**: confirm research plan and **definition of done** (output shape and quality).
- **Then research**: artifacts under `research/{project_id}/{task_id}/`.
- **Before done**: self-check against DoD; report **blockers** to the human if not met.

## Critiquing (`node_kind: critique`)

- **Dispatchable** (unlike human-only `decision` / `fog` nodes).
- **Grill first**: agree on goal, **rubric**, and **pass threshold** with the human.
- **Review** upstream commits/artifacts; **PASS** or **FAIL** with rework guidance for the next cycle.
- Mindmap uses the **diamond** (decision) shape.

## Code & architect

- **Code**: standard agent-branch implementation preamble.
- **Architect**: cross-task commit review and consolidation preamble.

## UI

The task **Chat** tab shows a one-line **workflow hint** when the selected task uses a specialized stencil. Full brief fields remain on **Task Details**; no separate UI is required for grilling rounds (chat transcript is the session).

## Code references

| Piece | Location |
|--------|-----------|
| Workflow inference & prompts | `core/task-workflow-lifecycle.ts` |
| Brief defaults | `applyTaskBriefDefaults` in `core/task-lifecycle.ts` |
| Execute / chat wiring | `local-engine.ts` → `launchWithFirstMessage`, `sendResearchLibraryMessage`, `feedbackPrompt` |
| Generate Tasks kinds | `core/workflow-task-kind.ts`, `docs/GENERATE_TASKS.md` |
