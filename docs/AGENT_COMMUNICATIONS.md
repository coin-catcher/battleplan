# AgentService (session communications)

Battleplan separates **UI state** (`BattleplanStore`) from **external agent session polling** (**AgentService**, implemented as `AgentCommunicationsService`).

## Naming

| Name in docs / product | TypeScript | Purpose |
| --- | --- | --- |
| **AgentService** | `AgentCommunicationsService` (`export type AgentService = …`) | Async coordinator: pending replies, background polls, broadcasts to the store. |
| *(not AgentService)* | `AgentConnectionService` | Agent editor credentials / connectivity — unrelated to task chat polling. |
| *(not AgentService)* | `AgentStatisticsService` | Usage stats UI — unrelated to session coordination. |

There is **one** session-coordination service today; connectors and the engine handle transport/persistence. Use **AgentService** in specs and UX copy unless a second coordination category appears (e.g. a separate notification bus).

## Responsibilities

| Layer | Role |
| --- | --- |
| **AgentService** | Project-wide async coordinator: tracks pending agent replies, polls sessions in the background, and **broadcasts** conversation + task updates through the store bridge (and optional per-task observers) whether or not the task panel is focused. |
| `BattleplanStore` | Owns selection, cached task panels, mindmap task rows, and chat transcript signals. Applies persistence results from the engine; does not embed polling loops. |
| `LocalEngine` | Persists chat, applies workflow transitions only when `isWorkflowTerminalAgentReply` is true (not for interim acks). |

## Provider kinds

Today most runs use the Cursor adapter. AgentService reports `AgentSessionRef.kind` as:

- `cursor` — Cursor cloud agents (code, subproject, default tasks)
- `research` — library OpenAI / Gemini / etc. via research adapter
- Future orchestration may add `openai` and `hermes` with the same watch API (`ensureTaskWatch`).

## Orchestrator integration (graph execution)

When the task-graph orchestrator dispatches work:

1. Start the agent through the existing engine APIs (`executeTask`, `sendTaskMessage`, …).
2. Rely on **`syncTaskWatches`** after `reloadTasks` when status is `DOING` (and `ensureTaskWatch` for active orchestration rows). **Do not** call `registerPendingReply` from orchestration — only **user-initiated** Send / Execute / Approve register pending replies.
3. Do **not** poll agent backends from orchestration code; read task status and chat from the store after the bridge applies engine results.
4. Treat workflow completion when task status leaves `DOING` or when `activeTaskSessions` no longer lists the task id.
5. Foreground “Waiting for Cursor…” in the open panel still uses store foreground watch; background watches continue when the user changes mindmap focus.

## Pending replies and observers

- After **Send**, **Execute**, or **Approve merge start**, the store calls `registerPendingReply(taskId)` so polling continues if the user selects another node.
- **Graph orchestration** and **project release** do not use `registerPendingReply`; they use DOING-based watches (`syncTaskWatches` / root project watch).
- `syncTaskWatches` also keeps watches for tasks whose cached chat still awaits a **workflow-terminal** assistant reply (`taskNeedsAgentSessionWatch`).
- Each poll calls `onTaskConversation`, which persists task JSON + chat cache and updates the mindmap (`replaceTask`) even when the panel is closed.
- Open panels can subscribe with `observeTask(taskId, cb)` to refresh live transcript signals when background polls land.

## UX decisions (product)

- **Mindmap:** No per-node spinners required; **correct status when the reply lands** is sufficient.
- **Reopen task panel:** **Cache-first** transcript is fine; **`chatAgentSyncing`** disables Send and shows a spinner beside it until background sync finishes.

## UI focus switching

- Opening a task uses local/cache transcript first, then background `syncAgent` import.
- While `chatAgentSyncing` is true, Send is disabled and a spinner appears beside the button.
- `coalesceCachedTaskStatus` keeps DOING on the mindmap when a background poll is active so REVIEW/DONE is not flashed prematurely from stale cache.