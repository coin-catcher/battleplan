# Definition of done — Responsiveness research

**Folder:** `research/15ddb36c-b9ec-4732-9ac1-6049da532e8a/responsiveness/`  
**Date:** 2026-11-14

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Scope & DoD grilled with human | **PARTIAL** | AgentService UX, pending-reply scope, naming locked; scope spec-vs-code + handoff still open |
| 2 | UI/agent separation documented for orchestrator | **PASS** | AGENT_COMMUNICATIONS.md + GRAPH_ORCHESTRATION.md |
| 3 | Premature DOING→REVIEW bug root cause & fix documented | **PASS** | isWorkflowTerminalAgentReply + engine applyTaskRun gating |
| 4 | Fast focus switch + background updates documented | **PASS** | cache, coalesceCachedTaskStatus, AgentService |
| 4b | Unfocused task keeps agent session until terminal reply | **PASS (code + spec)** | registerPendingReply, agent-session-watch, bridge persist; **desktop acceptance not recorded** |
| 4c | Mindmap / panel UX while unfocused | **PASS (spec)** | No per-node spinners; cache-first + chatAgentSyncing on reopen |
| 4d | Manual task status change ≤1s (save, mindmap, history) | **PASS (code)** | Fast local path; audit in status-change-audit.md; **desktop timing not recorded** |
| 5 | Async Approve & Release semantics documented | **PASS** | prepare/execute split; Approve registers pending; Release uses project watch |
| 6 | Open provider matrix (Cursor / OpenAI / Hermes) | **PENDING** | sessionKind stub only |
| 7 | Human acceptance: manual UX checklist passed on desktop | **PENDING** | Not recorded in repo |
| 8 | Human declares research handoff complete | **PENDING** | |

## Blockers (deliverables not yet sufficient)

1. **Human:** Confirm whether this research task is **spec-only** or must also track **remaining code gaps** on `cursor/responsiveness-1a9f` vs merged PR #195 + `develop`.
2. **Human:** Provide official **`task_id` UUID** if artifacts must move to `research/{project_id}/{uuid}/`.
3. **Human:** Sign off on **acceptance tests** (send on A → switch to B → A mindmap/chat updates; approve-and-navigate-away; no spurious REVIEW on interim ack).
4. **Engineering:** Hermes/OpenAI session polling not implemented in AgentService — follow-on child task unless human expands scope.
5. **Human:** Confirm **project-level Release** (async merge) unfocused behavior matches task-level expectations — currently project DOING watch only, not `registerPendingReply`.

## Resolved this round (human)

| Question | Answer |
| --- | --- |
| Mindmap indicators for multiple in-flight agents | Correct status when reply lands — **no extra spinners** |
| Reopen panel while sync in flight | **Cache-first + chatAgentSyncing OK** |
| Orchestration + `registerPendingReply` | **Only Send / Execute / Approve** |
| AgentService vs AgentCommunicationsService | **AgentService** in product/docs; keep TS class name; `AgentConnectionService` / `AgentStatisticsService` are separate concerns |

## Open clarifying questions (human)

1. **Research scope:** Is this folder **done** once specs + checklist pass, or must it include a **code merge checklist** until `cursor/responsiveness-1a9f` is merged?
2. **Release from project chat:** When user starts **Release** and navigates to a task, should project chat/status get the same “pending until terminal” guarantees as Send/Execute (today: root project poll only)?
3. **Provider matrix:** For research closure, is a **one-page stub** (Cursor = shipped, OpenAI/Hermes = future, same AgentService API) enough, or do you need dates/owners?
4. **Manual status vs in-flight agent:** Confirm **manual dropdown always wins** (no auto snap-back to DOING while Cursor run continues) — implemented via `reconcileStatus: false` on manual transition.
5. **DONE during graph orchestration:** If setting DONE triggers `autoDispatchReadyTasks` synchronously, is **>1s acceptable** for that edge, or should dispatch move to background like Approve?

## History

- Git workflow: single branch `cursor/responsiveness-1a9f`, merge `develop`, push only, no agent-opened PRs.
- AgentService observer/pending-reply design + implementation on branch (`agent-session-watch`, extended `AgentCommunicationsService`, store `registerPendingReply` on send/execute/approve).