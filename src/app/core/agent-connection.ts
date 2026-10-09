import type { AgentTypeDefinition } from './agent-types';

export interface AgentTestConnectionRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function encodeBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(credentials);
  }
  return Buffer.from(credentials, 'utf8').toString('base64');
}

/** Build HTTP request parameters for a registry test-connection recipe. */
export function buildAgentTestConnectionRequest(
  definition: AgentTypeDefinition,
  apiKey: string,
  baseUrl?: string,
): AgentTestConnectionRequest {
  const recipe = definition.testConnection;
  const root = normalizeBaseUrl(baseUrl?.trim() || definition.defaultUrl);
  const path = recipe.path.startsWith('/') ? recipe.path : `/${recipe.path}`;
  const url = new URL(`${root}${path}`);
  const headers: Record<string, string> = { ...(recipe.headers ?? {}) };

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
      const password = recipe.basicPasswordEmpty ? '' : '';
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
