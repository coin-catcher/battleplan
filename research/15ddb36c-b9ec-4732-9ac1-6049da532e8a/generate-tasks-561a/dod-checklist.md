# Definition of done — self-check

**Research task:** Generate Tasks (layered workflow spec)  
**Folder:** `research/15ddb36c-b9ec-4732-9ac1-6049da532e8a/generate-tasks-561a/`  
**Branch:** `cursor/generate-tasks-561a`  
**Date:** 2026-10-26

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Confirmed research scope and DoD with human (grilling) | **PENDING** | DoD proposed in README; awaiting human confirmation in chat |
| 2 | No application source code changed | **PASS** | Research markdown/JSON only |
| 3 | Output is a list of tasks with accomplishment details | **PASS** | [TASKS.md](./TASKS.md) — 8 ordered tasks |
| 4 | Layered Generate Tasks protocol documented | **PASS** | [layered-generate-protocol.md](./layered-generate-protocol.md) |
| 5 | Task types + mindmap shapes documented | **PASS** | [task-type-and-shapes.md](./task-type-and-shapes.md) |
| 6 | Sources cited | **PASS** | [references.json](./references.json) |
| 7 | Canonical `task_id` UUID path | **PENDING** | Using slug `generate-tasks-561a` until human supplies UUID |
| 8 | Human confirms handoff / research complete | **PENDING** | Per grilling rules |

## Blockers

1. **Human:** Confirm DoD checklist in README matches expectations.
2. **Human:** Provide Battleplan **`task_id`** UUID if artifacts must live at `research/{project_id}/{uuid}/` instead of this slug folder.
3. **Human:** Confirm whether **project-level** Generate Tasks should use the same layered protocol or remain one-shot (default in TASKS.md: research-parent only).

## Implementation (follow-on code task)

Not part of this DoD — tracked in TASKS.md Tasks 1–8.
