# Agent Library — Research Summary

**BattlePlan research task:** Agent Library  
**Scope:** A visual library of LLMs and agents connected to a project—configured from a fixed toolbox on the mindmap (left sidebar), edited in the right panel, persisted in `project_config.json`, with connection testing and usage statistics.

## Problem

BattlePlan today binds **one Cursor cloud agent per project** (and optionally per task) via `cursor_agent_id` on `Project` / `ProjectTask`, with the Cursor API key stored globally in `app_config.json` (`CursorKey` / `AppPreferences`). There is no first-class catalog of **multiple** research or code backends, no per-project API keys for OpenAI/Anthropic/etc., and no unified statistics view.

The left sidebar already hosts the mindmap inside `.map-frame`, with **fixed overlays** that do not scroll or zoom with the canvas—see `.zoom-controls` in `src/app/app.component.scss` (`position: absolute` on `.map-frame`). The right `main.editor` panel is driven by `Selection` in `src/app/core/models.ts` and `@switch (store.selection().kind)` in `src/app/app.component.html`. Agent Library should extend that pattern rather than introducing a new routing layer.

Project data on disk is a **`ProjectDocument`** written to `project_config.json` (`electron/file-repository.ts`, `electron/document-types.ts`): `{ project, messages, artifacts, pending_changes? }`. Agent configs belong in this document (recommended: top-level `agents` array plus optional `usage_ledger` for LocalLLM), not only on the nested `project` object, so chat history and agent secrets stay in one file the user already backs up.

## Agent taxonomy (v1)

| Category | Types in UI dropdown | Purpose |
|----------|----------------------|---------|
| **Research agents** (chat only) | OpenAI, Anthropic, Gemini, Grok, LocalLLM | Future research-task chat backends |
| **Code agents** | Cursor Agent | Same family as today’s cloud agents; multiple named configs allowed |

Toolbox: vertical list of **100×100** icons + labels; last two slots are green **+** for “Code Agent” and “Research Agent”.

## Deliverables in this folder

| File | Purpose |
|------|---------|
| [TASKS.md](./TASKS.md) | **Primary output:** ordered implementation tasks with acceptance criteria |
| [agent-types.yaml](./agent-types.yaml) | Default URLs, logos, option definitions, test-connection recipes |
| [agent-schema.json](./agent-schema.json) | JSON Schema for persisted agents + usage ledger |
| [statistics-capabilities.csv](./statistics-capabilities.csv) | What each provider can supply live vs. must be stored locally |
| [references.json](./references.json) | External documentation links |

## Design principles

1. **Fixed toolbox, scrolling mindmap** — Mount the agent strip on `.map-frame` (sibling to `.map-stage`), same z-index strategy as `.zoom-controls`; do not attach icons inside `.map-canvas` (they would scale with zoom).
2. **Secrets in project_config** — API keys encrypted-at-rest is out of scope for v1 research; match existing plaintext PAT/key patterns (`github_pat`, `cursor_api_key`) but never log keys in renderer devtools or test-connection error messages.
3. **Type registry** — One module (`agent-types.yaml` → runtime registry) drives dropdown icons, default names/URLs, option rows, and test/statistics adapters.
4. **Do not break Cursor-first workflow** — Existing `local-engine.ts` launch paths keep working; Agent Library is additive until a later task wires research chat to non-Cursor agents.
5. **Legacy Cursor binding** — Until users add a library entry, `project.cursor_agent_id` appears in the toolbox as read-only **Primary Cursor Agent (legacy)** (`LEGACY_PRIMARY_CURSOR_AGENT_ID` in `agent-toolbox.ts`); consolidate into `agents[]` when ready.
6. **Statistics honesty** — Show “live from API”, “estimated”, or “recorded locally” badges; use ∞ for LocalLLM tokens remaining; $0 cost for LocalLLM.

## UI/UX notes mapped to codebase

| Requirement | Suggested implementation touchpoints |
|-------------|--------------------------------------|
| Agent editor header (icon + name) | New `@case ('agent')` block in `app.component.html`; header mirrors Type/Name fields |
| Create vs edit chrome | `selection.kind === 'agent-create'` vs `'agent'`; Delete only when `agent_id` persisted |
| Save on Ctrl+S | Reuse `menu:action` `'save'` in `app.component.ts` → extend `persistEditorChanges()` |
| Masked API key | Same UX as GitHub PAT replace flow (`showGithubPat` pattern) |
| Auto-save on blur | Optional follow-up; spec requires explicit Save on create + keyboard save on edit |
| Test connection indicators | Component-local signals; CSS animation for 5s fade on success |

## References

- OpenAI Usage/Cost API (org admin key): [Usage API cookbook](https://developers.openai.com/cookbook/examples/completions_usage_api)
- Anthropic Usage & Cost Admin API: [docs](https://docs.anthropic.com/en/api/data-usage-cost-api)
- Gemini billing/monitoring: [AI Studio usage](https://ai.google.dev/gemini-api/docs/billing)
- xAI Grok API: [overview](https://docs.x.ai/overview)
- Cursor Cloud Agents API (already used): `src/app/data/cursor-browser.ts` → `https://api.cursor.com/v1`
- vLLM OpenAI-compatible server: [online serving](https://docs.vllm.ai/en/latest/serving/online_serving/)
