import type { AgentType } from './models';
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

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

function encodeBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(credentials);
  }
  return Buffer.from(credentials, 'utf8').toString('base64');
}

function authHeaders(recipe: AgentTestConnectionRecipe, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { ...(recipe.headers ?? {}) };
  if (recipe.auth === 'bearer') headers['Authorization'] = `Bearer ${apiKey}`;
  if (recipe.auth === 'x-api-key') headers['x-api-key'] = apiKey;
  return headers;
}

function userMessage(recipe: AgentTestConnectionRecipe, status: number, fallback: string): string {
  return recipe.userErrorMap?.[status] ?? fallback;
}

/** Build HTTP request parameters for a registry test-connection recipe. */
export function buildAgentTestConnectionRequest(
  definition: AgentTypeDefinition,
  apiKey: string,
  baseUrl?: string,
): AgentTestConnectionRequest {
  const recipe = definition.testConnection;
  const root = (baseUrl?.trim() || definition.defaultUrl).replace(/\/$/, '');
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

export async function runAgentConnectionTest(input: AgentConnectionInput): Promise<AgentConnectionResult> {
  const recipe = getAgentTypeDefinition(input.type).testConnection;
  const successCodes = recipe.successHttp ?? [200];
  const apiKey = input.apiKey.trim();
  if (recipe.auth !== 'none' && !apiKey) {
    return { ok: false, message: 'Enter an API key before testing the connection.' };
  }

  const attempt = async (
    path: string,
    method = recipe.method,
    body: unknown = recipe.body,
  ): Promise<AgentConnectionResult> => {
    let requestUrl = joinUrl(input.url, path);
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
      const response = await fetch(requestUrl, init);
      if (successCodes.includes(response.status)) {
        return { ok: true, status: response.status, message: 'Connection successful.' };
      }
      return {
        ok: false,
        status: response.status,
        message: userMessage(recipe, response.status, `Connection failed (HTTP ${response.status}).`),
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
