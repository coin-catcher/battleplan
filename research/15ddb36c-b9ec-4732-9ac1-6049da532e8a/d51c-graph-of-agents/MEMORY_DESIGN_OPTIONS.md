# Memory system design options (Round 1 — Q2)

Battleplan needs agents—especially **local** agents (Hermes, vLLM)—to **record, recall, and extrapolate** over time without bypassing human visibility. Below are v1-v2 options; none is selected yet.

## Option A — Git repo as canonical memory (status quo+)

**How it works:** DAR, ADRs, `GLOSSARY.md`, research folders, and task briefs live in git. Agents read/write via normal repo tools. Battleplan **context manifests** list paths explicitly included per task.

| Pros | Cons |
|------|------|
| Reviewable, versioned, portable | Poor episodic recall (“what did we decide last Tuesday?”) |
| Matches skill stacks today | No embedding search without extra tooling |
| No new infra | Local agents must clone/read repo |

**Best when:** Compliance and audit matter more than fuzzy recall.

---

## Option B — Mnemosyne (local, simple)

**How it works:** Sidecar local store (files/SQLite) for notes, tags, and lightweight links. Battleplan manifest references `mnemo://entry-id`. Hermes workers on same machine read/write through a small API.

| Pros | Cons |
|------|------|
| Fast local recall; offline | Another store to backup |
| Simple mental model | Not shared across machines without sync |
| Good for agent-local episodic memory | Relationships/metrics are DIY |

**Best when:** Single developer machine, Hermes-heavy, minimal ops.

---

## Option C — Hindsight (local complex / cloud paid)

**How it works:** Managed memory graph with relationships, metrics, and cloud sync. Battleplan shows memory view + inclusion map; manifests reference Hindsight object ids.

| Pros | Cons |
|------|------|
| Rich relationships and analytics | Cost, vendor lock-in, privacy review |
| Cross-device if cloud | Heavier integration |
| Strong “extrapolate over time” story | Overkill for small projects |

**Best when:** Multi-machine teams want shared episodic memory without git noise.

---

## Option D — Hybrid (recommended direction to evaluate)

**How it works:**

- **Canonical / durable:** git (decisions, glossary, briefs, shipped code).
- **Episodic / derived:** Mnemosyne or Hindsight via pointers only.
- **Battleplan rule:** no automatic full recall—every inclusion is manifest-listed; memory view shows where each entry is used in the graph.

| Pros | Cons |
|------|------|
| Aligns with “atomic task + explicit context” | Two systems to operate |
| Supports local agent recall without silent prompt stuffing | Requires connector work per backend |
| Human can audit git vs episodic split | Migration story for existing projects |

**Best when:** You want Hermes/local recall **and** PR-reviewed project truth.

---

## Integration hooks (all options)

1. **Context manifest** on `ProjectTask` (Task 9) — pointers, not dumps.
2. **Memory view** (Task 10) — browse + “used by tasks” edges.
3. **Handoff payload** (Task 8) — pass memory refs across local → cloud tasks.
4. **Write-back inbox** — agent-proposed memory entries await human accept (graph-delta pattern).

## Spike suggestions before choosing

1. Run one Hermes task with Mnemosyne pointer round-trip (record → recall in second task).
2. Same flow with Hindsight trial project (if credentials available).
3. Measure prompt token cost: manifest pointers vs inline paste for cloud Cursor tasks.
