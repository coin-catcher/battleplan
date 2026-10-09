# Agent Library — Implementation Tasks

Ordered tasks to add a visual **Agent Library**: fixed toolbox on the mindmap (left sidebar), agent editor in the right panel, persistence in `project_config.json`, connection testing, and usage statistics.

---

## Task 1 — Basic Agent Editor (toolbox, editor shell, app wiring)

**Goal:** Users see connected agents on the mindmap, open an editor on the right, and persist configs to the project.

**Steps:**

1. **Extend selection model** in `src/app/core/models.ts`:
   - Add `{ kind: 'agent'; agentId: string }` and `{ kind: 'agent-create'; role: 'research' | 'code' }`.
   - Extend `ProjectTabSnapshot` in `battleplan-store.service.ts` so tab restore remembers agent selection.
2. **Persist agents** (see Task 2) and load into store signals: `agents = signal<ProjectAgent[]>([])`.
3. **Mindmap toolbox UI** in `src/app/app.component.html` inside `.map-frame` (only when `store.project()` is set):
   - Container `.agent-toolbox` with `position: absolute; top: 10px; right: 10px; z-index: 4` (stack **below** `.zoom-controls` by offsetting `top` ~90px or moving zoom to top-left—avoid overlap).
   - Vertical flex column; each entry: 100×100 icon button + label (`max-width: 100px`, centered text, ellipsis).
   - Render saved agents sorted by `kind` then `name`.
   - Last two entries: green circular **+** buttons labeled **Code Agent** and **Research Agent** (`role` passed to `agent-create`).
4. **Agent editor panel** in `main.editor` `@switch`:
   - Header row: large icon (matches toolbox), editable name display (live from Name field), actions:
     - **Test Connection** (always)
     - **Save** (only `agent-create` or unsaved draft id)
     - **Delete** (only persisted `agentId`, confirm dialog)
   - Form fields: Type dropdown (with logo per row), Name, URL, API key, Agent Options table.
   - Footer: statistics dashboard placeholder component `<app-agent-stats [agentId]="..." />`.
5. **Store methods** in `battleplan-store.service.ts` / `local-engine.ts`:
   - `listAgents`, `createAgentDraft`, `saveAgent`, `deleteAgent`, `selectAgent`.
   - Saving writes via repository patch to `project_config.json`.
6. **Keyboard Save:** Extend `app.component.ts` `persistEditorChanges()` for `agent` / `agent-create` kinds (menu **Save** and Ctrl/Cmd+S already call `saveCurrent()`).
7. **Unsaved guard:** Extend `editorPanelDirty` (`src/app/core/editor-dirty.ts`) with `agentEditorDirty(form, savedAgent)`; hook `guardUnsavedChanges` when switching mindmap selection or tabs.

**Acceptance criteria:**

- Toolbox icons do not move when panning/zooming the mindmap.
- Clicking an agent icon opens its editor; **+** opens create flow with Type pre-filtered (Research types vs Cursor Agent only).
- Create flow shows **Save**, hides **Delete**; edit flow hides **Save** button but Ctrl+S persists changes.
- Agent list survives project reload (desktop file repo and IDB browser repo).

---

## Task 2 — Project config schema and repository plumbing

**Goal:** Agents live in `project_config.json` with backward-compatible defaults.

**Steps:**

1. Add TypeScript types mirroring [agent-schema.json](./agent-schema.json) in `src/app/core/models.ts` (`ProjectAgent`, `AgentUsageLedger`).
2. Extend `ProjectDocument` in `electron/document-types.ts`:
   ```ts
   agents?: ProjectAgent[];
   agent_usage_ledger?: Record<string, AgentUsageLedger>;
   ```
3. Update `electron/file-repository.ts` read/write paths to merge `agents` / ledger on `writeProjectDocument`.
4. Mirror in `src/app/data/idb-repository.ts` (browser mode).
5. **Portability:** Ensure battleplan archive export/import copies agent arrays (`electron/battleplan-archive.ts`).
6. Optional: redact `api_key` on export zip if user chooses “share without secrets” (future checkbox).

**Acceptance criteria:**

- Old projects without `agents` load with empty toolbox (only **+** buttons).
- New field validates against schema in a unit test (`agent-schema.json` + AJV in `vitest`).

---

## Task 3 — Agent type registry and shared editor controls

**Goal:** One registry drives dropdown labels, logos, default names/URLs, and dynamic option rows.

**Steps:**

1. Implement `src/app/core/agent-types.ts` generated from or loaded alongside [agent-types.yaml](./agent-types.yaml).
2. **Type dropdown:** Each option shows SVG logo + text; changing Type:
   - Updates header icon
   - Sets default Name if user has not manually edited name (track `nameTouched` flag)
   - Replaces URL with default unless `urlTouched`
   - Rebuilds Agent Options table from registry (preserve common keys when switching within research family).
3. **Agent Options table:** Two columns “Option Name” / “Option Value”; control types: text, textarea, number, checkbox, select.
4. **API key field:**
   - Create / key edited: `type="password"` or text with show toggle; store plaintext in project doc (consistent with PAT storage).
   - Edit unchanged key: display fixed mask `********` (length ≥ 8); focus clears mask for replacement.
5. Ship logos under `public/assets/agents/*.svg` (from Simple Icons or vendor media kits); map in registry.

**Acceptance criteria:**

- Switching OpenAI → Anthropic updates URL, icon, and option rows without stale Grok-only fields.
- Common options (`system_prompt`, `use_reasoning`, `use_tool_calls`) always appear first.

---

## Task 4 — Test Connection UX and backend

**Goal:** Reliable per-type connectivity check with specified success/error affordances.

**Steps:**

1. Add `AgentConnectionService` (Electron: main-process `fetch` or IPC to avoid CORS; browser: may require Electron-only for some hosts).
2. Implement recipes from [agent-types.yaml](./agent-types.yaml) (`test_connection` blocks).
3. Map HTTP/status/body errors to **single-line, human-readable** messages (never echo API key or full HTML).
4. UI next to **Test Connection**:
   - **Success:** green circle + checkmark; auto-fade/remove after **5 seconds** (CSS `@keyframes` opacity or `setTimeout`).
   - **Error:** red circle + thick X + message line; persists until next **Success**.
5. Persist `last_test_at`, `last_test_status`, `last_test_message` on agent record (optional).

**Acceptance criteria:**

- Valid OpenAI key against `/v1/models` shows success indicator that fades.
- Invalid key shows stable error until a later success clears it.

---

## Task 5 — Agent statistics dashboard (shared)

**Goal:** Bottom of agent editor shows combined metrics with honest data-source labeling.

**Steps:**

1. Define view model `AgentStatisticsSnapshot` with fields:
   - tokens today / billing period / remaining
   - requests today / billing period
   - cost today / billing period (USD)
2. Implement `AgentStatisticsService` with provider adapters (see [statistics-capabilities.csv](./statistics-capabilities.csv)).
3. **UI:** One composite card:
   - Left: dual-axis or small multiples — tokens (bars) + cost (line) for “today vs period-to-date”.
   - Right: request counters + remaining tokens meter (∞ glyph for LocalLLM).
   - Badge: `Live`, `Estimated`, or `Recorded locally`.
4. **Local ledger:** On each BattlePlan-originated API call (future chat wiring), increment `agent_usage_ledger[agent_id]`; reset `tokens_period` / `requests_period` when calendar month changes (LocalLLM billing period = calendar month per spec).
5. Cache provider polls (e.g. Cursor Admin API **≤1/hour** per docs).

**Acceptance criteria:**

- LocalLLM shows **∞** remaining tokens and **$0.00** costs always.
- OpenAI with only standard API key shows usage as “Unavailable—requires org Admin key” link text, not fake zeros.

---

## Task 6 — OpenAI provider configuration

**Goal:** Research agent type fully configured in the editor.

**Steps:**

1. Logo: `public/assets/agents/openai.svg`.
2. Defaults: URL `https://api.openai.com/v1`, name `OpenAI Research`.
3. Options: implement registry block (model, reasoning effort, temperature, max tokens, tool choice, parallel tool calls)—see [agent-types.yaml](./agent-types.yaml).
4. **Test connection:** `GET /v1/models` with Bearer token.
5. **Statistics adapter:** Optional second field “Organization Admin API key” on agent or project settings; call Usage + Cost endpoints documented in OpenAI cookbook; filter by this agent’s API key id if user registers mapping.
6. Document that **tokens remaining** is not available via standard API keys.

**Acceptance criteria:**

- Dropdown shows OpenAI logo; reasoning controls hidden when `Use Reasoning` unchecked.
- Test connection works with valid project key.

---

## Task 7 — Anthropic provider configuration

**Goal:** Claude research backend with extended thinking and server tools options.

**Steps:**

1. Logo: `anthropic.svg`.
2. URL: `https://api.anthropic.com` (Messages API uses `/v1/messages`).
3. Options: model, max_tokens, thinking budget/type, tool_choice, parallel tool disable, web search / code execution toggles.
4. **Test connection:** minimal `POST /v1/messages` with `max_tokens: 1`.
5. **Statistics:** Admin API key path (`/v1/organizations/usage_report/messages`, `/v1/organizations/cost_report`); UI explains difference between Messages key and Admin key.

**Acceptance criteria:**

- Thinking options only visible when `Use Reasoning` enabled.
- Server tool toggles only when `Use Tool Calls` enabled.

---

## Task 8 — Gemini provider configuration

**Goal:** Google Gemini research backend.

**Steps:**

1. Logo: `googlegemini.svg`.
2. URL: `https://generativelanguage.googleapis.com/v1beta`.
3. Options: model, thinking budget, temperature, top_p, function calling mode, grounding, code execution.
4. **Test connection:** `GET /v1beta/models?key=...`.
5. **Statistics:** Primary ledger from `usageMetadata` on responses; optional future Cloud Billing project id; badge **Estimated** when using ledger-only.

**Acceptance criteria:**

- Type change pulls default Gemini URL and models list.
- Editor documents that live quota requires AI Studio / Cloud Console.

---

## Task 9 — Grok (xAI) provider configuration

**Goal:** Grok research backend via Responses API.

**Steps:**

1. Logo: xAI-branded SVG.
2. URL: `https://api.x.ai/v1`.
3. Options: model, reasoning effort (low–xhigh), prompt cache key, built-in tools (web/X/code), custom functions JSON.
4. **Test connection:** `GET /v1/models` or lightweight `/v1/responses` if models list unavailable for key tier.
5. **Statistics:** Local ledger + list-price estimate from token counts (see yaml `price_hint_usd_per_mtok`).

**Acceptance criteria:**

- Built-in tool checkboxes gated on `Use Tool Calls`.
- Reasoning effort hidden when `Use Reasoning` off.

---

## Task 10 — Cursor Agent (code) configuration

**Goal:** Named Cursor cloud agent configs distinct from legacy single `project.cursor_agent_id`.

**Steps:**

1. Logo: `cursor.svg`.
2. URL: `https://api.cursor.com/v1` (align with `cursor-browser.ts`).
3. Options: default mode agent/plan, default repo/ref (inherit project fields), env JSON, model preference text field.
4. **Test connection:** reuse Cursor Basic auth (`API key:` empty password) — same as global Cursor key panel; allow per-agent key override or fallback to `AppPreferences.cursorApiKey()`.
5. **Statistics:** Enterprise Admin API (`POST /teams/filtered-usage-events`, `/teams/spend`) when admin key configured on agent; otherwise aggregate from BattlePlan runs tied to `cursor_agent_id` stored on agent record.
6. **Relationship to today’s model:** Document migration: existing `project.cursor_agent_id` appears as read-only “Primary Cursor Agent” entry until user consolidates into library.

**Acceptance criteria:**

- **Code Agent** + only allows Type = Cursor Agent.
- Test connection succeeds with same key that works in Cursor API key panel.

---

## Task 11 — LocalLLM (vLLM) provider configuration

**Goal:** Local OpenAI-compatible inference for research chat.

**Steps:**

1. Logo: vLLM / local GPU icon.
2. Default URL: `http://127.0.0.1:8000/v1`.
3. Options: model (dynamic from `/v1/models`), temperature, max_tokens, top_p, tool-use toggle, reasoning parser hint.
4. **Test connection:** `GET /health` then `/v1/models`.
5. **Statistics:** Parse Prometheus `/metrics` for throughput gauges; **daily** token/request totals from `agent_usage_ledger`; remaining = ∞; costs = 0.
6. Electron: allow localhost fetch from main process; warn on browser-only deployment that LocalLLM requires desktop.

**Acceptance criteria:**

- Model dropdown populates after successful test against local server.
- Dashboard shows ∞ remaining and zero cost.

---

## Task 12 — Wire Agent Library into BattlePlan workflows (follow-up)

**Goal:** Configured agents are usable beyond the editor (not required for initial UI ship).

**Steps:**

1. **Research tasks:** Add `research_agent_id?: string` on `ProjectTask`; chat composer routes to selected research agent adapter instead of Cursor when set.
2. **Code tasks:** Add `code_agent_id?: string`; `launchWithFirstMessage` uses library Cursor config (repo/ref/env) when launching via `cursor-browser.ts`.
3. **Project defaults:** Project-level `default_research_agent_id` / `default_code_agent_id` for new tasks.
4. Increment usage ledger on each routed call for statistics accuracy.

**Acceptance criteria:**

- Research task chat uses OpenAI/Gemini/etc. when bound; code tasks still enforce Battleplan PR policy via existing `local-engine.ts` wrappers.

---

## Task 13 — QA, accessibility, and themes

**Goal:** Production-ready polish across themes and input modalities.

**Steps:**

1. Keyboard: toolbox icons focusable; Enter opens editor; Escape closes create draft with dirty guard.
2. Screen reader labels: “Open agent {name}”, “Add research agent”.
3. Verify contrast for green **+** buttons on all themes in `src/app/core/themes.ts`.
4. Vitest: registry loading, dirty-state, connection error mapping, ledger month rollover.

**Acceptance criteria:**

- No axe-critical issues on agent editor form.
- Toolbox usable at 200% zoom in sidebar.

---

## Suggested implementation order

1. Tasks **2 → 3 → 1** (data before UI)
2. Task **4** (test connection)
3. Tasks **6–11** (provider rows can land in parallel once registry exists)
4. Task **5** (statistics; can trail Test Connection by one sprint)
5. Tasks **12–13** (integration + polish)

---

## Out of scope (research explicitly deferred)

- Encrypting API keys at rest (match current PAT plaintext approach; note in security review).
- Non-vLLM local runners (Ollama, llama.cpp) — add as new Type enum later with same registry pattern.
- Letting research agents run shell/tools without Battleplan sandbox review (tool flags are config-only until chat wiring exists).
