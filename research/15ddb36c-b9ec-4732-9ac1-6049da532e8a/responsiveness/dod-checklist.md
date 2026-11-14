# Definition of done — Responsiveness research

**Folder:** `research/15ddb36c-b9ec-4732-9ac1-6049da532e8a/responsiveness/`  
**Date:** 2026-11-14

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Scope & DoD grilled with human | **PARTIAL** | README DoD proposed; human synced branch + grilling continuation this round |
| 2 | UI/agent separation documented for orchestrator | **PASS** | AGENT_COMMUNICATIONS.md + GRAPH_ORCHESTRATION.md on develop |
| 3 | Premature DOING→REVIEW bug root cause & fix documented | **PASS** | isWorkflowTerminalAgentReply + engine applyTaskRun gating |
| 4 | Fast focus switch + background updates documented | **PASS** | cache, coalesceCachedTaskStatus, agent comms service |
| 5 | Async Approve & Release semantics documented | **PASS** | prepare/execute split in engine + store |
| 6 | Open provider matrix (Cursor / OpenAI / Hermes) | **PENDING** | sessionKind stub only |
| 7 | Human acceptance: manual UX checklist passed on desktop | **PENDING** | Not recorded in repo |
| 8 | Human declares research handoff complete | **PENDING** | |

## Blockers (deliverables not yet sufficient)

1. **Human:** Confirm whether this research task is **spec-only** or must also track **remaining code gaps** on `cursor/responsiveness-1a9f` vs what already landed via merged PR #195 and follow-on `develop` commits (orchestration, state-transitions).
2. **Human:** Provide official **`task_id` UUID** if artifacts must move to `research/{project_id}/{uuid}/`.
3. **Human:** Sign off on **acceptance tests** (mindmap switch latency, approve-and-navigate-away, release-from-task-view, no spurious REVIEW while agent typing).
4. **Engineering:** Hermes/OpenAI session polling not implemented in `AgentCommunicationsService` — document as follow-on or in-scope for a child code task.

## This round incorporated

- Git workflow: single branch `cursor/responsiveness-1a9f`, merge `develop`, push only, no agent-opened PRs.
- Branch synced to `develop` (includes graph orchestration, state transition fixes post-responsiveness merge).