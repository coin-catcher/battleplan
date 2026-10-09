import { agentCredentialRequiredMessage, resolveAgentApiKey } from './agent-api-key';
import type { AgentType, ProjectAgent } from './models';
import { getAgentTypeDefinition, type AgentTestConnectionRecipe, type AgentTypeDefinition } from './agent-types';
import {
  geminiAccessTokenFromCredentialsJson,
  parseGeminiModelNames,
  parseGoogleServiceAccountJson,
} from './gemini-service-account';
import {
  localLlmHealthUrl,
  localLlmModelsUrl,
  normalizeLocalLlmApiBase,
} from './local-llm';

export interface AgentConnectionInput {
  type: AgentType;
  url: string;
  apiKey: string;
}

export interface AgentConnectionResult {
  ok: boolean;
  status?: number;
  message: string;
  models?: string[];
  testedAt?: string;
}

export interface AgentTestConnectionRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

export type AgentConnectionFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function joinAgentApiUrl(baseUrl: string, requestPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const path = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  try {
    const parsed = new URL(base);
    if (path.startsWith('/v1') && parsed.pathname.replace(/\/+$/, '').endsWith('/v1')) {
      return `${parsed.origin}${path}`;
    }
    return `${base}${path}`;
  } catch {
    return `${base}${path}`;
  }
}

function encodeBasicAuth(username: string, password: string): string {
  return globalThis.btoa(`${username}:${password}`);
}

function authHeaders(recipe: AgentTestConnectionRecipe, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...(recipe.headers ?? {}), accept: 'application/json' };
  if (recipe.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
  if (recipe.auth === 'x-api-key') headers['x-api-key'] = apiKey;
  return headers;
}

/** Map HTTP status and body to a single-line user-facing connection error (never includes secrets). */
export function agentConnectionUserMessage(
  recipe: AgentTestConnectionRecipe,
  status: number,
  bodyText: string,
): string {
  const mapped = recipe.userErrorMap?.[status];
  if (mapped) return mapped;
  if (status === 0) return 'Could not reach the server. Check the URL and that the service is running.';
  if (status === 401) return 'Authentication failed. Check the API key.';
  if (status === 403) return 'The API key lacks permission for this request.';
  if (status >= 500) return 'The provider returned a server error. Try again later.';
  const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (/sk-[a-zA-Z0-9]{8,}/.test(snippet)) {
    return snippet ? `Request failed (${status}).` : `Connection failed (HTTP ${status}).`;
  }
  return snippet ? `Request failed (${status}): ${snippet}` : `Connection failed (HTTP ${status}).`;
}

function userMessage(recipe: AgentTestConnectionRecipe, status: number, bodyText: string): string {
  return agentConnectionUserMessage(recipe, status, bodyText);
}

export function parseOpenAiModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as { data?: unknown };
  if (!Array.isArray(data.data)) return [];
  const ids: string[] = [];
  for (const entry of data.data) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id);
    }
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

const OPENAI_NON_CHAT_PREFIXES = [
  'text-embedding',
  'text-search',
  'whisper',
  'tts-',
  'dall-e',
  'gpt-image',
  'omni-moderation',
  'sora-',
  'davinci',
  'babbage',
  'curie',
  'ada',
  'code-search',
  'code-davinci',
];

/** Drop embeddings, audio, image, and legacy completion-only ids from OpenAI /v1/models. */
export function filterOpenAiSelectableModelIds(ids: string[]): string[] {
  return ids.filter((id) => {
    const lower = id.toLowerCase();
    if (OPENAI_NON_CHAT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
    if (lower.includes('embedding')) return false;
    return true;
  });
}

function modelsFromModelsListResponse(type: AgentType, bodyText: string): string[] | undefined {
  try {
    const parsed = JSON.parse(bodyText);
    const ids = parseOpenAiModelIds(parsed);
    if (type === 'OpenAI') return filterOpenAiSelectableModelIds(ids);
    return ids;
  } catch {
    return undefined;
  }
}

export async function listAgentModels(
  input: AgentConnectionInput,
  fetchFn: AgentConnectionFetch = fetch,
): Promise<string[]> {
  if (input.type === 'LocalLLM') {
    const result = await testLocalLlmConnection(input, fetchFn);
    return result.models ?? [];
  }
  if (input.type !== 'OpenAI' && input.type !== 'Grok') return [];

  const apiKey = input.apiKey.trim();
  if (!apiKey) return [];

  const definition = getAgentTypeDefinition(input.type);
  const request = buildAgentTestConnectionRequest(definition, apiKey, input.url);
  if (request.method !== 'GET') return [];

  try {
    const response = await fetchFn(request.url, { method: request.method, headers: request.headers });
    if (!response.ok) return [];
    const bodyText = await response.text();
    return modelsFromModelsListResponse(input.type, bodyText) ?? [];
  } catch {
    return [];
  }
}

/** Build HTTP request parameters for a registry test-connection recipe. */
export function buildAgentTestConnectionRequest(
  definition: AgentTypeDefinition,
  apiKey: string,
  baseUrl?: string,
): AgentTestConnectionRequest {
  const recipe = definition.testConnection;
  const root = baseUrl?.trim() || definition.defaultUrl;
  const path = recipe.path.startsWith('/') ? recipe.path : `/${recipe.path}`;
  const url = new URL(joinAgentApiUrl(root, path));
  const headers: Record<string, string> = { ...(recipe.headers ?? {}), accept: 'application/json' };

  switch (recipe.auth) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'x-api-key':
      headers['x-api-key'] = apiKey;
      break;
    case 'query_key':
      if (recipe.queryParam) url.searchParams.set(recipe.queryParam, apiKey);
      break;
    case 'google_service_account':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'basic': {
      const password = recipe.basicPasswordEmpty ? '' : apiKey;
      headers['Authorization'] = `Basic ${encodeBasicAuth(apiKey, password)}`;
      break;
    }
    case 'none':
      break;
    default:
      break;
  }

  return {
    url: url.toString(),
    method: recipe.method,
    headers,
    body: recipe.body,
  };
}

async function testGeminiServiceAccountConnection(
  input: AgentConnectionInput,
  fetchFn: AgentConnectionFetch,
): Promise<AgentConnectionResult> {
  const recipe = getAgentTypeDefinition('Gemini').testConnection;
  const successCodes = recipe.successHttp ?? [200];
  const testedAt = new Date().toISOString();
  const credentialsRaw = input.apiKey.trim();
  if (!credentialsRaw) {
    return { ok: false, message: agentCredentialRequiredMessage('Gemini'), testedAt };
  }
  let accessToken: string;
  try {
    parseGoogleServiceAccountJson(credentialsRaw);
    accessToken = await geminiAccessTokenFromCredentialsJson(credentialsRaw, fetchFn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid service account JSON.';
    return { ok: false, message, testedAt };
  }

  const request = buildAgentTestConnectionRequest(
    getAgentTypeDefinition('Gemini'),
    accessToken,
    input.url,
  );
  try {
    const response = await fetchFn(request.url, { method: request.method, headers: request.headers });
    const bodyText = await response.text();
    if (successCodes.includes(response.status)) {
      let models: string[] | undefined;
      try {
        models = parseGeminiModelNames(JSON.parse(bodyText));
      } catch {
        models = undefined;
      }
      const message = models?.length
        ? `Connection successful. ${models.length} model(s) available.`
        : 'Connection successful.';
      return { ok: true, status: response.status, message, models, testedAt };
    }
    return {
      ok: false,
      status: response.status,
      message: userMessage(recipe, response.status, bodyText),
      testedAt,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Network error';
    return { ok: false, message: `Could not reach the server (${detail}).`, testedAt };
  }
}

async function testLocalLlmConnection(
  input: AgentConnectionInput,
  fetchFn: AgentConnectionFetch,
): Promise<AgentConnectionResult> {
  const recipe = getAgentTypeDefinition('LocalLLM').testConnection;
  const successCodes = recipe.successHttp ?? [200];
  const apiBase = normalizeLocalLlmApiBase(input.url);
  const healthUrl = localLlmHealthUrl(apiBase);
  const modelsUrl = localLlmModelsUrl(apiBase);

  const probe = async (url: string, method = 'GET'): Promise<{ ok: boolean; status: number; bodyText: string }> => {
    try {
      const response = await fetchFn(url, { method, headers: { accept: 'application/json' } });
      const bodyText = await response.text();
      return { ok: successCodes.includes(response.status), status: response.status, bodyText };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Network error';
      return { ok: false, status: 0, bodyText: detail };
    }
  };

  let connected = false;
  let lastStatus = 0;
  let lastBody = '';

  const health = await probe(healthUrl);
  if (health.ok) {
    connected = true;
  } else {
    lastStatus = health.status;
    lastBody = health.bodyText;
    const modelsProbe = await probe(modelsUrl);
    if (modelsProbe.ok) {
      connected = true;
    } else {
      lastStatus = modelsProbe.status;
      lastBody = modelsProbe.bodyText;
    }
  }

  const testedAt = new Date().toISOString();

  if (!connected) {
    if (lastStatus === 0) {
      return {
        ok: false,
        message: 'Could not reach the local vLLM server. Start vLLM and confirm the URL (default http://127.0.0.1:8000/v1).',
        testedAt,
      };
    }
    return {
      ok: false,
      status: lastStatus,
      message: userMessage(recipe, lastStatus, lastBody),
      testedAt,
    };
  }

  const modelsResponse = await probe(modelsUrl);
  if (!modelsResponse.ok) {
    return { ok: true, message: 'Connected, but model list could not be loaded.', testedAt };
  }
  try {
    const parsed = JSON.parse(modelsResponse.bodyText);
    const models = parseOpenAiModelIds(parsed);
    return {
      ok: true,
      message: models.length ? `Connected. ${models.length} model(s) available.` : 'Connected. No models reported by the server.',
      models,
      testedAt,
    };
  } catch {
    return { ok: true, message: 'Connected, but the model list response was not valid JSON.', testedAt };
  }
}

export async function runAgentConnectionTest(
  input: AgentConnectionInput,
  fetchFn: AgentConnectionFetch = fetch,
): Promise<AgentConnectionResult> {
  if (input.type === 'LocalLLM') {
    return testLocalLlmConnection(input, fetchFn);
  }
  if (input.type === 'Gemini') {
    return testGeminiServiceAccountConnection(input, fetchFn);
  }

  const recipe = getAgentTypeDefinition(input.type).testConnection;
  const successCodes = recipe.successHttp ?? [200];
  const apiKey = input.apiKey.trim();
  if (recipe.auth !== 'none' && !apiKey) {
    if (input.type === 'Cursor Agent') {
      return {
        ok: false,
        message: 'Save a Cursor API key in the Cursor API key panel or on this agent.',
      };
    }
    return { ok: false, message: 'Enter an API key before testing the connection.' };
  }

  const attempt = async (
    path: string,
    method = recipe.method,
    body: unknown = recipe.body,
  ): Promise<AgentConnectionResult> => {
    let requestUrl = joinAgentApiUrl(input.url, path);
    const init: RequestInit = { method, headers: authHeaders(recipe, apiKey) };
    if (recipe.auth === 'basic') {
      const password = recipe.basicPasswordEmpty ? '' : apiKey;
      init.headers = { ...init.headers, Authorization: `Basic ${encodeBasicAuth(apiKey, password)}` };
    }
    if (recipe.auth === 'query_key' && recipe.queryParam) {
      const url = new URL(requestUrl);
      url.searchParams.set(recipe.queryParam, apiKey);
      requestUrl = url.toString();
    }
    if (method === 'POST' && body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    try {
      const response = await fetchFn(requestUrl, init);
      const bodyText = await response.text();
      const testedAt = new Date().toISOString();
      if (successCodes.includes(response.status)) {
        let models: string[] | undefined;
        if ((input.type === 'OpenAI' || input.type === 'Grok') && recipe.path === '/models') {
          models = modelsFromModelsListResponse(input.type, bodyText);
        }
        const message = models?.length
          ? `Connection successful. ${models.length} model(s) available.`
          : 'Connection successful.';
        return { ok: true, status: response.status, message, models, testedAt };
      }
      return {
        ok: false,
        status: response.status,
        message: userMessage(recipe, response.status, bodyText),
        testedAt,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Network error';
      return {
        ok: false,
        message: `Could not reach the server (${detail}).`,
        testedAt: new Date().toISOString(),
      };
    }
  };

  let result = await attempt(recipe.path);
  if (!result.ok && recipe.fallbackPath) {
    result = await attempt(
      recipe.fallbackPath,
      recipe.fallbackMethod ?? recipe.method,
      recipe.fallbackBody ?? recipe.body,
    );
  }
  if (!result.ok && recipe.altPath) {
    result = await attempt(recipe.altPath);
  }
  return result;
}

/** Test connection for a saved agent record, resolving Cursor API key fallback. */
export async function testProjectAgentConnection(
  agent: ProjectAgent,
  globalCursorApiKey: string,
  fetchFn: AgentConnectionFetch = fetch,
): Promise<AgentConnectionResult> {
  return runAgentConnectionTest(
    {
      type: agent.type,
      url: agent.url,
      apiKey: resolveAgentApiKey(agent, globalCursorApiKey),
    },
    fetchFn,
  );
}

/** Apply dynamic model ids to agent options after a successful models-list fetch. */
export function applyDynamicModelsToOptions(
  type: AgentType,
  options: Record<string, string | number | boolean>,
  models: string[] | undefined,
): Record<string, string | number | boolean> {
  if (!models?.length) return options;
  const def = getAgentTypeDefinition(type);
  const modelOption = def.specificOptions.find((row) => row.key === 'model' && row.dynamic);
  if (!modelOption) return options;
  const current = options['model'];
  const nextModel =
    typeof current === 'string' && current && models.includes(current)
      ? current
      : models.includes(String(modelOption.default))
        ? String(modelOption.default)
        : models[0];
  return { ...options, ['model']: nextModel };
}

export function selectChoicesForOption(
  type: AgentType,
  optionKey: string,
  staticChoices: readonly string[] | undefined,
  dynamicModels: string[] | undefined,
): string[] {
  const def = getAgentTypeDefinition(type);
  const option = def.specificOptions.find((row) => row.key === optionKey);
  if (option?.dynamic) {
    const live = dynamicModels ?? [];
    if (live.length) return live;
    return staticChoices ? [...staticChoices] : [];
  }
  return staticChoices ? [...staticChoices] : [];
}
