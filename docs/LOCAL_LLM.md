# Local vLLM (LocalLLM agent type)

Battleplan’s **LocalLLM** research agent type targets a [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/) on your machine.

## Defaults

| Field | Default |
|-------|---------|
| Name | Local vLLM |
| URL | `http://127.0.0.1:8000/v1` |
| Logo | `public/assets/agents/vllm.svg` |

Agent options include **model** (filled from `GET /v1/models` after a successful connection test), **temperature**, **max_tokens**, **top_p**, **enable_auto_tool_choice** (when tool calls are enabled), and **reasoning_parser** (when reasoning is enabled).

## Desktop (Electron) — recommended

Local inference is supported in the **Battleplan desktop app**:

1. Start vLLM, for example: `vllm serve <model> --host 127.0.0.1 --port 8000`
2. In the agent editor, set URL to `http://127.0.0.1:8000/v1` (or your host/port).
3. Click **Test Connection**.

Connection checks run in the **Electron main process** (`agent:testConnection` IPC → `electron/agent-connection.ts`), not in the Chromium renderer. That avoids browser CORS restrictions when calling `http://127.0.0.1`.

Test sequence:

1. `GET {origin}/health` (origin = URL without trailing `/v1`)
2. If health fails, probe `GET {apiBase}/models`
3. On success, load models from `GET {apiBase}/models` and populate the **Model** dropdown

## Browser-only build

The browser build (`ng serve` without Electron) **cannot** reliably use LocalLLM: localhost requests from the page are blocked or fail CORS. The UI shows:

> Local vLLM listens on localhost (127.0.0.1). Use the Battleplan desktop app…

Cloud research providers may still be testable from the browser where CORS allows it; LocalLLM is desktop-only.

## Statistics

LocalLLM usage shows **∞** remaining tokens and **$0.00** cost. Daily and billing-period counters come from the project `agent_usage_ledger` (and optional Prometheus `/metrics` in a later iteration). See `src/app/core/agent-statistics.ts`.

## Related code

- Type registry: `src/app/core/agent-types.ts` (`LocalLLM`)
- Connection logic: `src/app/core/agent-connection.ts`, `src/app/core/local-llm.ts`
- Renderer service: `src/app/data/agent-connection.service.ts`
