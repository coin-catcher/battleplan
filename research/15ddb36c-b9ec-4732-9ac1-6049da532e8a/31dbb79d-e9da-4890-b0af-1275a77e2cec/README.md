# Local Hermes — Research

**BattlePlan research task:** Local Hermes  
**Branch:** `cursor/local-hermes-b550`  
**Status:** Design interview — **Round 1** (frontier open; no final task list until shared understanding)

## Goal

Design how Battleplan (and developers) can **start a local Hermes agent in Docker** using a **common profile and configuration**, and grow a **catalog of Hermes profiles/configs** as specialized agents are added.

## Scope of this folder

| Artifact | Purpose |
|----------|---------|
| [FACTS.md](./FACTS.md) | Repo + upstream Hermes facts (no user decisions) |
| [design-tree.yaml](./design-tree.yaml) | Decision tree; nodes marked `open` / `settled` |
| [interview.md](./interview.md) | Interview log (questions + answers by round) |
| [references.json](./references.json) | External URLs |
| [profile-catalog-schema.json](./profile-catalog-schema.json) | Draft schema for a Battleplan-side profile catalog |
| [upstream-docker-notes.md](./upstream-docker-notes.md) | Hermes official Docker / compose patterns |

## Relationship to Graph of Agents

Battleplan already plans Hermes as a **connector** (`connector_kind: hermes`, status mapping in `src/app/core/agent-connector.ts`). Research task **d51c Task 18** covers Electron-managed container lifecycle; **Task 5** covers the Hermes connector spike. This research focuses on **how local Hermes should run and how profiles are cataloged**, so those implementation tasks share one contract (data dir, endpoint, health, profile names).

## Next step

Answer **Round 1** in [interview.md](./interview.md) (also posted in the Code task chat). After each round, the frontier is recomputed and the design tree updated. When the frontier is empty and you confirm shared understanding, this folder will gain a final **TASKS.md** with titled prompts per implementation task.
