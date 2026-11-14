# Agent communications layer

Battleplan separates **UI state** (`BattleplanStore`) from **external agent session polling** (`AgentCommunicationsService`).

## Responsibilities

| Layer | Role |
| --- | --- |
| `AgentCommunicationsService` (**AgentService**) | Project-wide async coordinator: tracks pending agent replies, polls sessions in the background, and **broadcasts** conversation + task updates through the store bridge (and optional per-task observers) whether or not the task panel is focused. |
| `BattleplanStore` | Owns selection, cached task panels, mindmap task rows, and chat transcript signals. Applies persistence results from the engine; does not embed polling loops. |
| `LocalEngine` | Persists chat, applies workflow transitions only when `isWorkflowTerminalAgentReply` is true (not for interim acks). |

## Provider kinds

Today most runs use the Cursor adapter. The service reports `AgentSessionRef.kind` as:

- `cursor` — Cursor cloud agents (code, subproject, default tasks)
- `research` — library OpenAI / Gemini / etc. via research adapter
- Future orchestration may add `openai` and `hermes` with the same watch API (`ensureTaskWatch`).

## Orchestrator integration (planned graph execution)

When a future task-graph orchestrator dispatches work:

1. Start the agent through the existing engine APIs (`executeTask`, `sendTaskMessage`, …).
2. Call `AgentCommunicationsService.ensureTaskWatch(taskId)` (or rely on `syncTaskWatches` after `reloadTasks` when status is DOING).
3. Do **not** poll agent backends from orchestration code; read task status and chat from the store after the bridge applies engine results.
4. Treat workflow completion when task status leaves `DOING` or when `activeTaskSessions` no longer lists the task id.
5. Foreground “Waiting for Cursor…” in the open panel still uses store foreground watch; background watches continue when the user changes mindmap focus.

## Pending replies and observers

- After **Send**, **Execute**, or **Approve merge start**, the store calls `registerPendingReply(taskId)` so polling continues if the user selects another node.
- `syncTaskWatches` also keeps watches for tasks whose cached chat still awaits a **workflow-terminal** assistant reply (`taskNeedsAgentSessionWatch`).
- Each poll calls `onTaskConversation`, which persists task JSON + chat cache and updates the mindmap (`replaceTask`) even when the panel is closed.
- Open panels can subscribe with `observeTask(taskId, cb)` to refresh live transcript signals when background polls land.

## UI focus switching

- Opening a task uses local/cache transcript first, then background `syncAgent` import.
- While `chatAgentSyncing` is true, Send is disabled and a spinner appears beside the button.
- `coalesceCachedTaskStatus` keeps DOING on the mindmap when a background poll is active so REVIEW/DONE is not flashed prematurely from stale cache.
