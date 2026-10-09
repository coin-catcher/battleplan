import { describe, expect, it, vi } from 'vitest';
import { getAgentTypeDefinition } from './agent-types';
import { buildAgentTestConnectionRequest, joinAgentApiUrl, testProjectAgentConnection } from './agent-connection';
import type { ProjectAgent } from './models';

const cursorAgent = (): ProjectAgent => ({
  agent_id: 'a1',
  kind: 'code',
  type: 'Cursor Agent',
  name: 'Cursor Code Agent',
  url: 'https://api.cursor.com/v1',
  created_at: '2026-10-09T00:00:00.000Z',
  updated_at: '2026-10-09T00:00:00.000Z',
});

describe('joinAgentApiUrl', () => {
  it('dedupes /v1 when base URL already ends with /v1', () => {
    expect(joinAgentApiUrl('https://api.cursor.com/v1', '/v1/me')).toBe('https://api.cursor.com/v1/me');
    expect(joinAgentApiUrl('https://api.openai.com/v1', '/models')).toBe('https://api.openai.com/v1/models');
  });
});

describe('buildAgentTestConnectionRequest', () => {
  it('builds Gemini GET /models with key query param', () => {
    const definition = getAgentTypeDefinition('Gemini');
    const request = buildAgentTestConnectionRequest(definition, 'test-gemini-key');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-gemini-key');
    expect(request.headers).toEqual({ accept: 'application/json' });
  });

  it('respects a custom base URL for Gemini', () => {
    const definition = getAgentTypeDefinition('Gemini');
    const request = buildAgentTestConnectionRequest(
      definition,
      'k',
      'https://generativelanguage.googleapis.com/v1beta/',
    );
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=k');
  });

  it('defines Grok fallback POST /responses for connection testing', () => {
    const recipe = getAgentTypeDefinition('Grok').testConnection;
    expect(recipe.fallbackPath).toBe('/responses');
    expect(recipe.fallbackMethod).toBe('POST');
    expect(recipe.fallbackBody).toMatchObject({
      model: 'grok-4-1-fast-non-reasoning',
      max_output_tokens: 1,
    });
  });
});

describe('testProjectAgentConnection (Cursor Agent)', () => {
  it('succeeds with Basic auth using global Cursor key', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Authorization']).toBe(`Basic ${btoa('cursor-key:')}`);
      return new Response('{}', { status: 200 });
    });
    const result = await testProjectAgentConnection(cursorAgent(), 'cursor-key', fetchFn);
    expect(result.ok).toBe(true);
    expect(calls[0]).toBe('https://api.cursor.com/v1/me');
  });

  it('falls back to /v1/agents when /v1/me fails', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/me')) {
        return new Response('', { status: 404 });
      }
      return new Response('{"items":[]}', { status: 200 });
    });
    const result = await testProjectAgentConnection(cursorAgent(), 'cursor-key', fetchFn);
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports missing Cursor key when neither agent nor global key is set', async () => {
    const result = await testProjectAgentConnection(cursorAgent(), '', vi.fn());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Cursor API key/i);
  });
});
