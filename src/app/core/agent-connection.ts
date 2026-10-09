import type { AgentType } from './models';
import { getAgentTypeDefinition, type AgentTestConnectionRecipe } from './agent-types';

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

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
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

export async function runAgentConnectionTest(input: AgentConnectionInput): Promise<AgentConnectionResult> {
  const recipe = getAgentTypeDefinition(input.type).testConnection;
  const successCodes = recipe.successHttp ?? [200];
  const apiKey = input.apiKey.trim();
  if (recipe.auth !== 'none' && !apiKey) {
    return { ok: false, message: 'Enter an API key before testing the connection.' };
  }

  const attempt = async (path: string, method = recipe.method): Promise<AgentConnectionResult> => {
    let requestUrl = joinUrl(input.url, path);
    const init: RequestInit = { method, headers: authHeaders(recipe, apiKey) };
    if (recipe.auth === 'basic') {
      const password = recipe.basicPasswordEmpty ? '' : apiKey;
      const credentials = `${apiKey}:${password}`;
      const token = typeof btoa === 'function'
        ? btoa(credentials)
        : (globalThis as typeof globalThis & { Buffer?: { from(s: string): { toString(enc: string): string } } }).Buffer?.from(credentials).toString('base64') ?? '';
      init.headers = { ...init.headers, Authorization: `Basic ${token}` };
    }
    if (recipe.auth === 'query_key' && recipe.queryParam) {
      const url = new URL(requestUrl);
      url.searchParams.set(recipe.queryParam, apiKey);
      requestUrl = url.toString();
    }
    if (method === 'POST' && recipe.body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(recipe.body);
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
    result = await attempt(recipe.fallbackPath);
  }
  if (!result.ok && recipe.altPath) {
    result = await attempt(recipe.altPath);
  }
  return result;
}
