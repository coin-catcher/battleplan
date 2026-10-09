import type { AgentType } from './models';
import { getAgentTypeDefinition } from './agent-types';
import type { AgentTestConnectionRecipe } from './agent-types';
import {
  localLlmHealthUrl,
  localLlmModelsUrl,
  normalizeLocalLlmApiBase,
} from './local-llm';

export interface AgentConnectionParams {
  type: AgentType;
  url: string;
  apiKey?: string;
}

export interface AgentConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
  testedAt: string;
}

export type AgentHttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; bodyText: string }>;

const HTML_SNIPPET = /<html[\s>]/i;

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

export function mapConnectionHttpError(
  status: number,
  recipe: AgentTestConnectionRecipe,
  bodyText: string,
): string {
  const mapped = recipe.userErrorMap?.[status];
  if (mapped) return mapped;
  if (status === 0) return 'Could not reach the server. Check the URL and that the service is running.';
  if (status >= 500) return `Server error (${status}). Try again after the provider recovers.`;
  if (status === 404) return 'Endpoint not found. Verify the base URL matches your provider docs.';
  if (HTML_SNIPPET.test(bodyText)) return `Unexpected HTML response (${status}). Check the base URL.`;
  const trimmed = bodyText.trim().slice(0, 160);
  if (trimmed && !trimmed.startsWith('{')) return `Request failed (${status}): ${trimmed}`;
  return `Request failed with HTTP ${status}.`;
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function authHeaders(recipe: AgentTestConnectionRecipe, apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { ...(recipe.headers ?? {}) };
  const key = apiKey?.trim() ?? '';
  switch (recipe.auth) {
    case 'bearer':
      if (key) headers.Authorization = `Bearer ${key}`;
      break;
    case 'x-api-key':
      if (key) headers['x-api-key'] = key;
      break;
    case 'basic':
      if (key) headers.Authorization = `Basic ${btoa(`${key}:`)}`;
      break;
    case 'query_key':
    case 'none':
      break;
    default:
      break;
  }
  return headers;
}

function withQueryKey(url: string, recipe: AgentTestConnectionRecipe, apiKey: string | undefined): string {
  if (recipe.auth !== 'query_key' || !recipe.queryParam) return url;
  const key = apiKey?.trim();
  if (!key) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(recipe.queryParam, key);
  return parsed.toString();
}

function successStatuses(recipe: AgentTestConnectionRecipe): number[] {
  return recipe.successHttp?.length ? recipe.successHttp : [200];
}

async function requestOnce(
  fetchFn: AgentHttpFetch,
  url: string,
  recipe: AgentTestConnectionRecipe,
  apiKey: string | undefined,
  methodOverride?: 'GET' | 'POST',
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const method = methodOverride ?? recipe.method;
  const headers = authHeaders(recipe, apiKey);
  let body: string | undefined;
  if (method === 'POST' && recipe.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    body = JSON.stringify(recipe.body);
  }
  const target = withQueryKey(url, recipe, apiKey);
  const response = await fetchFn(target, { method, headers, body });
  const ok = successStatuses(recipe).includes(response.status);
  return { ok, status: response.status, bodyText: response.bodyText };
}

async function testLocalLlm(
  params: AgentConnectionParams,
  fetchFn: AgentHttpFetch,
): Promise<AgentConnectionResult> {
  const apiBase = normalizeLocalLlmApiBase(params.url);
  const recipe = getAgentTypeDefinition('LocalLLM').testConnection;
  const healthUrl = localLlmHealthUrl(apiBase);
  const modelsUrl = localLlmModelsUrl(apiBase);

  let connected = false;
  let lastStatus = 0;
  let lastBody = '';

  try {
    const health = await requestOnce(fetchFn, healthUrl, { ...recipe, path: '/health' }, params.apiKey, 'GET');
    if (health.ok) {
      connected = true;
    } else {
      lastStatus = health.status;
      lastBody = health.bodyText;
      const modelsProbe = await requestOnce(fetchFn, modelsUrl, { ...recipe, path: '/models' }, params.apiKey, 'GET');
      if (modelsProbe.ok) {
        connected = true;
      } else {
        lastStatus = modelsProbe.status;
        lastBody = modelsProbe.bodyText;
      }
    }
  } catch {
    return {
      ok: false,
      message: 'Could not reach the local vLLM server. Start vLLM and confirm the URL (default http://127.0.0.1:8000/v1).',
      testedAt: new Date().toISOString(),
    };
  }

  if (!connected) {
    return {
      ok: false,
      message: mapConnectionHttpError(lastStatus, recipe, lastBody),
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const modelsResponse = await requestOnce(fetchFn, modelsUrl, { ...recipe, path: '/models' }, params.apiKey, 'GET');
    if (!modelsResponse.ok) {
      return {
        ok: true,
        message: 'Connected, but model list could not be loaded.',
        testedAt: new Date().toISOString(),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(modelsResponse.bodyText);
    } catch {
      return {
        ok: true,
        message: 'Connected, but the model list response was not valid JSON.',
        testedAt: new Date().toISOString(),
      };
    }
    const models = parseOpenAiModelIds(parsed);
    return {
      ok: true,
      message: models.length ? `Connected. ${models.length} model(s) available.` : 'Connected. No models reported by the server.',
      models,
      testedAt: new Date().toISOString(),
    };
  } catch {
    return {
      ok: true,
      message: 'Connected, but loading models failed.',
      testedAt: new Date().toISOString(),
    };
  }
}

async function testWithRecipe(
  params: AgentConnectionParams,
  fetchFn: AgentHttpFetch,
): Promise<AgentConnectionResult> {
  const def = getAgentTypeDefinition(params.type);
  const recipe = def.testConnection;
  const base = params.url.trim().replace(/\/+$/, '');
  const primaryUrl = joinUrl(base, recipe.path);
  const attempts = [primaryUrl];
  if (recipe.fallbackPath) attempts.push(joinUrl(base, recipe.fallbackPath));
  if (recipe.altPath) attempts.push(joinUrl(base, recipe.altPath));

  let lastStatus = 0;
  let lastBody = '';
  for (const url of attempts) {
    try {
      const result = await requestOnce(fetchFn, url, recipe, params.apiKey);
      if (result.ok) {
        return { ok: true, message: 'Connection successful.', testedAt: new Date().toISOString() };
      }
      lastStatus = result.status;
      lastBody = result.bodyText;
    } catch {
      lastStatus = 0;
      lastBody = '';
    }
  }
  return {
    ok: false,
    message: mapConnectionHttpError(lastStatus, recipe, lastBody),
    testedAt: new Date().toISOString(),
  };
}

export async function runAgentConnectionTest(
  params: AgentConnectionParams,
  fetchFn: AgentHttpFetch,
): Promise<AgentConnectionResult> {
  if (params.type === 'LocalLLM') return testLocalLlm(params, fetchFn);
  return testWithRecipe(params, fetchFn);
}

/** Apply dynamic model ids to agent options after a successful LocalLLM test. */
export function applyDynamicModelsToOptions(
  type: AgentType,
  options: Record<string, string | number | boolean>,
  models: string[] | undefined,
): Record<string, string | number | boolean> {
  if (!models?.length) return options;
  const def = getAgentTypeDefinition(type);
  const modelOption = def.specificOptions.find((row) => row.key === 'model' && row.dynamic);
  if (!modelOption) return options;
  const current = options.model;
  const nextModel =
    typeof current === 'string' && current && models.includes(current)
      ? current
      : models.includes(String(modelOption.default))
        ? String(modelOption.default)
        : models[0];
  return { ...options, model: nextModel };
}

export function dynamicModelChoices(
  type: AgentType,
  dynamicModels: string[] | undefined,
): string[] {
  if (type !== 'LocalLLM') return [];
  return dynamicModels ?? [];
}

export function selectChoicesForOption(
  type: AgentType,
  optionKey: string,
  staticChoices: readonly string[] | undefined,
  dynamicModels: string[] | undefined,
): string[] {
  const def = getAgentTypeDefinition(type);
  const option = def.specificOptions.find((row) => row.key === optionKey);
  if (option?.dynamic) return dynamicModelChoices(type, dynamicModels);
  return staticChoices ? [...staticChoices] : [];
}
