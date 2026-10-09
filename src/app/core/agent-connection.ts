import { resolveAgentApiKey } from './agent-api-key';
import type { AgentType, ProjectAgent } from './models';
import { getAgentTypeDefinition, type AgentTestConnectionRecipe, type AgentTypeDefinition } from './agent-types';

export interface AgentConnectionInput {
  type: AgentType;
  url: string;
  apiKey: string;
}

export interface AgentConnectionResult {
  ok: boolean;
  status?: number;
  message: string;
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
  const credentials = `${username}:${password}`;
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(credentials);
  }
  return Buffer.from(credentials, 'utf8').toString('base64');
}

function authHeaders(recipe: AgentTestConnectionRecipe, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...(recipe.headers ?? {}), accept: 'application/json' };
  if (recipe.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
  if (recipe.auth === 'x-api-key') headers['x-api-key'] = apiKey;
  return headers;
}

function userMessage(recipe: AgentTestConnectionRecipe, status: number, bodyText: string): string {
  const mapped = recipe.userErrorMap?.[status];
  if (mapped) return mapped;
  if (status === 401) return 'Authentication failed. Check the API key.';
  if (status === 403) return 'The API key lacks permission for this request.';
  if (status >= 500) return 'The provider returned a server error. Try again later.';
  const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 160);
  return snippet ? `Request failed (${status}): ${snippet}` : `Connection failed (HTTP ${status}).`;
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
      headers.Authorization = `Bearer ${apiKey}`;
      break;
    case 'x-api-key':
      headers['x-api-key'] = apiKey;
      break;
    case 'query_key':
      if (recipe.queryParam) url.searchParams.set(recipe.queryParam, apiKey);
      break;
    case 'basic': {
      const password = recipe.basicPasswordEmpty ? '' : apiKey;
      headers.Authorization = `Basic ${encodeBasicAuth(apiKey, password)}`;
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

export async function runAgentConnectionTest(
  input: AgentConnectionInput,
  fetchFn: AgentConnectionFetch = fetch,
): Promise<AgentConnectionResult> {
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
      if (successCodes.includes(response.status)) {
        return { ok: true, status: response.status, message: 'Connection successful.' };
      }
      return {
        ok: false,
        status: response.status,
        message: userMessage(recipe, response.status, bodyText),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Network error';
      return { ok: false, message: `Could not reach the server (${detail}).` };
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
