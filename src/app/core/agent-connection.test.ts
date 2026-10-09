import { describe, expect, it, vi } from 'vitest';
import { getAgentTypeDefinition } from './agent-types';
import {
  agentConnectionUserMessage,
  applyDynamicModelsToOptions,
  buildAgentTestConnectionRequest,
  joinAgentApiUrl,
  parseOpenAiModelIds,
  runAgentConnectionTest,
  selectChoicesForOption,
  testProjectAgentConnection,
} from './agent-connection';
import { localLlmHealthUrl, localLlmModelsUrl } from './local-llm';
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

describe('agentConnectionUserMessage', () => {
  it('maps generic HTTP failures', () => {
    const recipe = { ...getAgentTypeDefinition('LocalLLM').testConnection, userErrorMap: undefined };
    expect(agentConnectionUserMessage(recipe, 401, '')).toBe('Authentication failed. Check the API key.');
    expect(agentConnectionUserMessage(recipe, 403, '')).toBe('The API key lacks permission for this request.');
    expect(agentConnectionUserMessage(recipe, 503, '')).toBe('The provider returned a server error. Try again later.');
    expect(agentConnectionUserMessage(recipe, 0, '')).toMatch(/Could not reach the server/);
  });

  it('prefers registry userErrorMap over generic messages', () => {
    const recipe = getAgentTypeDefinition('OpenAI').testConnection;
    expect(agentConnectionUserMessage(recipe, 401, '')).toMatch(/Invalid API key/i);
  });

  it('does not echo API key material in error snippets', () => {
    const recipe = getAgentTypeDefinition('OpenAI').testConnection;
    const message = agentConnectionUserMessage(recipe, 400, 'invalid key sk-abcdefghijklmnopqrstuvwxyz');
    expect(message).not.toMatch(/sk-/);
    expect(message).toContain('400');
  });

  it('uses recipe userErrorMap when present', () => {
    const recipe = {
      ...getAgentTypeDefinition('OpenAI').testConnection,
      userErrorMap: { 429: 'Rate limited — wait and retry.' },
    };
    expect(agentConnectionUserMessage(recipe, 429, '')).toBe('Rate limited — wait and retry.');
  });
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

describe('LocalLLM connection', () => {
  it('loads models after successful health check', async () => {
    const health = localLlmHealthUrl('http://127.0.0.1:8000/v1');
    const models = localLlmModelsUrl('http://127.0.0.1:8000/v1');
    const fetchFn = vi.fn(async (url: string) => {
      if (url === health) return new Response('ok', { status: 200 });
      if (url === models) {
        return new Response(JSON.stringify({ data: [{ id: 'meta-llama/Llama-3.1-8B' }, { id: 'other' }] }), { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const result = await runAgentConnectionTest(
      { type: 'LocalLLM', url: 'http://127.0.0.1:8000/v1', apiKey: '' },
      fetchFn,
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['meta-llama/Llama-3.1-8B', 'other']);
  });

  it('falls back to /v1/models when /health fails', async () => {
    const health = localLlmHealthUrl('http://127.0.0.1:8000/v1');
    const models = localLlmModelsUrl('http://127.0.0.1:8000/v1');
    const fetchFn = async (url: string) => {
      if (url === health) return new Response('', { status: 404 });
      if (url === models) {
        return new Response(JSON.stringify({ data: [{ id: 'demo' }] }), { status: 200 });
      }
      return new Response('', { status: 500 });
    };

    const result = await runAgentConnectionTest(
      { type: 'LocalLLM', url: 'http://127.0.0.1:8000/v1', apiKey: '' },
      fetchFn,
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['demo']);
  });

  it('populates model dropdown choices and selects first model', () => {
    const choices = selectChoicesForOption('LocalLLM', 'model', [], ['alpha', 'beta']);
    expect(choices).toEqual(['alpha', 'beta']);

    const merged = applyDynamicModelsToOptions('LocalLLM', { model: '' }, ['alpha', 'beta']);
    expect(merged.model).toBe('alpha');
  });
});

describe('parseOpenAiModelIds', () => {
  it('extracts unique sorted ids', () => {
    expect(
      parseOpenAiModelIds({
        data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }],
      }),
    ).toEqual(['a', 'b']);
  });
});
