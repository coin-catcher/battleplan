# Battleplan storage (v3)

**BATTLEPLAN_ROOT** is the Electron `userData` directory (e.g. `%AppData%/battleplan` on Windows). App JSON metadata and the git-mirrored **battleplan/** tree both live under it.

## Layout

```
{BATTLEPLAN_ROOT}/
  app_config.json
  projects/                          # mindmap metadata (JSON)
    {PROJECT_ID}/
      project_config.json
      tasks/
        {TASK_ID}/
          task_config.json
          chat artifacts…
  battleplan/
    projects/
      {PROJECT_ID}/
        tasks/
          {TASK_ID}/                 # same task_id / slug as git when mirrored
            brief.md                 # optional at task root when copied from git
            inputs/                  # populated at Execute from upstream repo_path
            outputs/                 # agent collateral (briefs, summaries, docs)
        task_templates/
        workflows/
        subprojects/{SUBPROJECT_ID}/tasks/
```

Git uses the same relative paths starting at `battleplan/projects/…` in the linked repository.

## Migration (v3)

On desktop startup (and before listing tasks), Battleplan migrates older layouts:

| Legacy | Current |
|--------|---------|
| `projects/{id}/{task_id}/task_config.json` | `projects/{id}/tasks/{task_id}/task_config.json` |
| `projects/{id}/battleplan/…` nested mirror | `{BATTLEPLAN_ROOT}/battleplan/…` |
| `battleplan/projects/{id}/{task}/…` (no `tasks/`) | `battleplan/projects/{id}/tasks/{task}/…` |

Task records still store git-relative `repo_path` (usually `…/outputs/`). **Start Discovery** import downloads the agent branch into the local `battleplan/` mirror. **Execute** copies upstream `repo_path` folders into the task’s local `inputs/` directory.

## Repo path field (v2)

On project load, tasks with legacy `research/{project_id}/{task_id}/` paths are rewritten to `battleplan/projects/{project_id}/tasks/{task_id}/outputs/` (`battleplan-storage-migrate.ts`).

## Execution

When a task starts, upstream **output manifests** and `repo_path` folders are injected as **INPUT DOCUMENTS** in the agent prompt (`input-documents.ts`), after upstream files are staged under `inputs/`.
