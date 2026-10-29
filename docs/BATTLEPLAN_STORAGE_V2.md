# Battleplan storage v2

Local data lives under **BATTLEPLAN_ROOT** (desktop file repository root). Git collateral uses the same relative paths under **`battleplan/projects/`** in the linked repository.

## Layout

```
battleplan/projects/{PROJECT_ID}/
  tasks/{TASK_ID}/outputs/     # task briefs, research, code artifacts
  task_templates/
  workflows/                   # n8n workflow catalog entries
  subprojects/{SUBPROJECT_ID}/tasks/
```

## Migration

On project load, tasks with legacy `research/{project_id}/{task_id}/` paths are rewritten to `battleplan/projects/{project_id}/tasks/{task_id}/outputs/` and `battleplan_storage_version` is set to **2** (see `battleplan-storage-migrate.ts`).

## Git mirror

On **Start Discovery** import, Battleplan downloads each task’s `repo_path` folder (and optional `git_paths`) from the discovery agent’s GitHub branch into `{BATTLEPLAN_ROOT}/{project_id}/battleplan/...`, matching the linked repository layout.

## Execution

When a task starts, upstream **output manifests** and `repo_path` folders are injected as **INPUT DOCUMENTS** in the agent prompt (`input-documents.ts`).
