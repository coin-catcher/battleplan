import { getAgentTypeDefinition } from './agent-types';
import { resolveAgentApiKey } from './agent-api-key';
import type { AgentTestConnectionRecipe } from './agent-types';
import type { ProjectAgent } from './models';

export type AgentConnectionFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string> }>;

export interface AgentConnectionTestResult {
  ok: boolean;
  message: string;
  httpStatus?: number;
}

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

function buildAuthHeaders(
  recipe: AgentTestConnectionRecipe,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...(recipe.headers ?? {}), accept: 'application/json' };
  switch (recipe.auth) {
    case 'bearer':
      if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
      break;
    case 'x-api-key':
      if (apiKey) headers['x-api-key'] = apiKey;
      break;
    case 'basic': {
      const password = recipe.basicPasswordEmpty ? '' : apiKey;
      const username = recipe.basicPasswordEmpty ? apiKey : apiKey;
      if (username || password) {
        headers['authorization'] = `Basic ${btoa(`${username}:${password}`)}`;
      }
      break;
    }
    case 'query_key':
    case 'none':
      break;
    default:
      break;
  }
  return headers;
}

function appendQueryKey(url: string, recipe: AgentTestConnectionRecipe, apiKey: string): string {
  if (recipe.auth !== 'query_key' || !recipe.queryParam || !apiKey) return url;
  const parsed = new URL(url);
  parsed.searchParams.set(recipe.queryParam, apiKey);
  return parsed.toString();
}

function humanizeConnectionFailure(
  recipe: AgentTestConnectionRecipe,
  status: number,
  bodyText: string,
): string {
  const mapped = recipe.userErrorMap?.[status];
  if (mapped) return mapped;
  if (status === 401) return 'Authentication failed. Check the API key.';
  if (status === 403) return 'The API key lacks permission for this request.';
  if (status >= 500) return 'The provider returned a server error. Try again later.';
  const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 160);
  return snippet ? `Request failed (${status}): ${snippet}` : `Request failed with status ${status}.`;
}

async function attemptConnection(
  agent: ProjectAgent,
  recipe: AgentTestConnectionRecipe,
  apiKey: string,
  fetchFn: AgentConnectionFetch,
  path: string,
): Promise<AgentConnectionTestResult> {
  const successCodes = recipe.successHttp ?? [200];
  let url = joinAgentApiUrl(agent.url, path);
  url = appendQueryKey(url, recipe, apiKey);

  const headers = buildAuthHeaders(recipe, apiKey);
  if (recipe.method === 'POST' && recipe.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let response: Awaited<ReturnType<AgentConnectionFetch>>;
  try {
    response = await fetchFn(url, {
      method: recipe.method,
      headers,
      body: recipe.method === 'POST' && recipe.body !== undefined ? JSON.stringify(recipe.body) : undefined,
    });
  } catch {
    return { ok: false, message: 'Could not reach the provider. Check the URL and network.' };
  }

  const bodyText = await response.text();
  if (successCodes.includes(response.status)) {
    return { ok: true, message: 'Connection successful.', httpStatus: response.status };
  }
  return {
    ok: false,
    message: humanizeConnectionFailure(recipe, response.status, bodyText),
    httpStatus: response.status,
  };
}

export async function testProjectAgentConnection(
  agent: ProjectAgent,
  globalCursorApiKey: string,
  fetchFn: AgentConnectionFetch,
): Promise<AgentConnectionTestResult> {
  const definition = getAgentTypeDefinition(agent.type);
  const recipe = definition.testConnection;
  const apiKey = resolveAgentApiKey(agent, globalCursorApiKey);

  if (!apiKey && recipe.auth !== 'none') {
    if (agent.type === 'Cursor Agent') {
      return {
        ok: false,
        message: 'Save a Cursor API key in the Cursor API key panel or on this agent.',
      };
    }
    return { ok: false, message: 'Enter an API key before testing the connection.' };
  }

  const primary = await attemptConnection(agent, recipe, apiKey, fetchFn, recipe.path);
  if (primary.ok) return primary;

  const fallbackPath = recipe.fallbackPath ?? recipe.altPath;
  if (!fallbackPath) return primary;

  const fallback = await attemptConnection(agent, recipe, apiKey, fetchFn, fallbackPath);
  return fallback.ok ? fallback : primary;
}
