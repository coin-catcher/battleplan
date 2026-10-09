/** OpenAI-compatible API base URL (typically ends with `/v1`). */
export function normalizeLocalLlmApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://127.0.0.1:8000/v1';
  if (trimmed.endsWith('/v1')) return trimmed;
  return `${trimmed}/v1`;
}

/** vLLM health and metrics live on the server origin, not under `/v1`. */
export function localLlmServerOrigin(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) return trimmed.slice(0, -'/v1'.length) || trimmed;
  return trimmed;
}

export function localLlmModelsUrl(apiBaseUrl: string): string {
  const base = normalizeLocalLlmApiBase(apiBaseUrl);
  return `${base}/models`;
}

export function localLlmHealthUrl(apiBaseUrl: string): string {
  return `${localLlmServerOrigin(apiBaseUrl)}/health`;
}

export const LOCAL_LLM_BROWSER_LIMITATION =
  'Local vLLM listens on localhost (127.0.0.1). Use the Battleplan desktop app to run Test Connection and load the model list. The browser-only build cannot reliably reach a local vLLM server (CORS and mixed-context restrictions).';

export const LOCAL_LLM_ELECTRON_NOTE =
  'In the desktop app, connection tests run in the Electron main process so requests to http://127.0.0.1:8000 are allowed without browser CORS limits. Point the agent URL at your vLLM OpenAI server (default http://127.0.0.1:8000/v1).';
