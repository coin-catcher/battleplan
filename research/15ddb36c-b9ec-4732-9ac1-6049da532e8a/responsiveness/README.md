# Responsiveness & agent session management

**Battleplan research task:** UX responsiveness for panel switching and long-running agent actions; separation of UI from external agent session polling; fix premature task status transitions while agents are still working.

**Implementation branch (code):** `cursor/responsiveness-1a9f` (synced with `develop`).

## Distilled understanding (grilling round — 2026-11-14, updated)

### Human decisions (same round)

| Topic | Decision |
| --- | --- |
| Mindmap while agents run | **No per-node spinners**; update status when the workflow-terminal reply lands. |
| Reopen task panel | **Cache-first** + `chatAgentSyncing` until background sync completes — acceptable. |
| `registerPendingReply` | **Only user Send, Execute, and Approve** — not graph orchestration dispatch (orchestration uses DOING + `syncTaskWatches`). |
| Naming | Product/docs: **AgentService** (`AgentCommunicationsService` in code). Other `Agent*` injectables (`AgentConnectionService`, `AgentStatisticsService`) are different categories (credentials, stats), not a second session coordinator. |

## Distilled understanding (grilling round — 2026-11-14)

### Problem

1. **Perceived slowness** — Full-panel loading blocked mindmap → task navigation; Send/Approve/Release waited on network sync before the UI updated.
2. **Architecture** — All agent polling lived in `BattleplanStore`, coupling UI focus to Cursor sync. Future **OpenAI cloud agents**, **Hermes local agents**, and **graph orchestration** need one session layer that updates persisted task/chat storage regardless of which node is selected.
3. **Status bug** — Tasks jumped **DOING → REVIEW/DONE** when the agent posted an interim ack (“working on it”) rather than a terminal completion.

### Agreed direction (code + docs)

| Area | Approach |
| --- | --- |
| Panel open | Local/cache transcript immediately; `syncAgent: false` first; background sync + `chatAgentSyncing` (Send disabled, spinner beside button). |
| Approve / Release | `prepare*` updates status + chat synchronously; heavy GitHub/agent work in background; user can navigate away. |
| Session polling | **AgentService** (`AgentCommunicationsService`) + store bridge; `docs/AGENT_COMMUNICATIONS.md`; orchestrator uses `ensureTaskWatch` / `syncTaskWatches` only (see `docs/GRAPH_ORCHESTRATION.md`). |
| Workflow transitions | `isWorkflowTerminalAgentReply` gates `applyTaskRun` and “answered run” detection; interim messages still appear in chat. |
| Focus switch | Task cache + `coalesceCachedTaskStatus` keeps DOING on mindmap while background poll active. |
| **AgentService coordinator** (grill 2026-11-14) | Global async coordinator: `registerPendingReply` on Send/Execute/Approve only; `pendingReply` set; `taskNeedsAgentSessionWatch` + cached messages in `syncTaskWatches`; broadcast via bridge `onTaskConversation` (persists task + cache / mindmap). Optional `observeTask` for focused live transcript. |

### User-reported bug (grill 2026-11-14)

Send on **Task A**, switch to **Task B** → Task A agent status and mindmap stall.

**Root cause (confirmed in code review):** background watches were tied primarily to `DOING` + foreground `watchTask`; unfocused tasks could stop polling before a workflow-terminal reply, so `applyTaskConversation` never ran and mindmap/chat cache went stale.

**Target behavior:** AgentService tracks all pending replies project-wide; observers (store bridge + optional per-task callbacks) receive broadcasts; task JSON + chat cache update in the background so reopening Task A shows full history and correct status.

### Out of scope for this research folder

- Full graph orchestration implementation (separate agent/tasks on `develop`).
- Hermes/OpenAI transport adapters (connector layer future work).

## Proposed definition of done (research)

1. Written spec: responsibilities split (UI / agent comms / engine / orchestrator hooks) — **PASS** (`docs/AGENT_COMMUNICATIONS.md`, `docs/GRAPH_ORCHESTRATION.md` cross-ref).
2. Written spec: terminal vs interim agent replies and status semantics — **PASS** (`src/app/core/agent-run-response.ts` + tests).
3. Checklist mapping original product feedback (panel load, async merge/release, focus switch) to shipped behaviors — **this folder `dod-checklist.md`**.
4. Open questions resolved with human (provider matrix, Hermes timeline, e2e acceptance) — **PARTIAL** (AgentService UX + naming resolved this round; provider matrix + e2e still open).
5. Human confirms research complete / code task DoD for any remaining gaps — **PENDING**.

## References

- Code: **AgentService** (`agent-communications.service.ts`, `agent-session-watch.ts`), `BattleplanStore` bridge, `LocalEngine.prepareApprove` / `executeApproveMerge`, fast `openTask`.
- Prior merges: responsiveness UX, state-transitions work on `develop`.