import { describe, expect, it, vi } from 'vitest';
import * as geminiAuth from './gemini-service-account';
import { getAgentTypeDefinition } from './agent-types';
import {
  agentConnectionUserMessage,
  applyDynamicModelsToOptions,
  buildAgentTestConnectionRequest,
  filterOpenAiSelectableModelIds,
  joinAgentApiUrl,
  listAgentModels,
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
  it('builds Gemini GET /models with Bearer access token', () => {
    const definition = getAgentTypeDefinition('Gemini');
    const request = buildAgentTestConnectionRequest(definition, 'ya29.test-token');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(request.headers).toEqual({ accept: 'application/json', Authorization: 'Bearer ya29.test-token' });
  });

  it('respects a custom base URL for Gemini', () => {
    const definition = getAgentTypeDefinition('Gemini');
    const request = buildAgentTestConnectionRequest(
      definition,
      'token',
      'https://generativelanguage.googleapis.com/v1beta/',
    );
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(request.headers.Authorization).toBe('Bearer token');
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

  it('uses live OpenAI models when loaded, else static fallback', () => {
    expect(
      selectChoicesForOption('OpenAI', 'model', ['gpt-4.1-mini'], ['gpt-4o', 'gpt-4.1-nano']),
    ).toEqual(['gpt-4o', 'gpt-4.1-nano']);
    expect(
      selectChoicesForOption('OpenAI', 'model', ['gpt-4.1-mini'], []),
    ).toEqual(['gpt-4.1-mini']);
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

describe('filterOpenAiSelectableModelIds', () => {
  it('removes embeddings and audio models', () => {
    expect(
      filterOpenAiSelectableModelIds([
        'gpt-4o',
        'text-embedding-3-small',
        'whisper-1',
        'o3-mini',
      ]),
    ).toEqual(['gpt-4o', 'o3-mini']);
  });
});

describe('runAgentConnectionTest (OpenAI)', () => {
  it('passes GET /v1/models with Bearer token when the key is valid', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.openai.com/v1/models');
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Authorization']).toBe('Bearer sk-valid');
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 });
    });

    const result = await runAgentConnectionTest(
      { type: 'OpenAI', url: 'https://api.openai.com/v1', apiKey: 'sk-valid' },
      fetchFn,
    );

    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/model\(s\) available/i);
    expect(result.models).toEqual(['gpt-4o']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('listAgentModels returns filtered chat models for OpenAI', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }],
        }),
        { status: 200 },
      ),
    );
    const models = await listAgentModels(
      { type: 'OpenAI', url: 'https://api.openai.com/v1', apiKey: 'sk-valid' },
      fetchFn,
    );
    expect(models).toEqual(['gpt-4o']);
  });

  it('returns a stable mapped error for invalid keys until a later success', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"invalid_api_key"}', { status: 401 }));

    const invalid = await runAgentConnectionTest(
      { type: 'OpenAI', url: 'https://api.openai.com/v1', apiKey: 'sk-bad' },
      fetchFn,
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toMatch(/Invalid API key/i);
    expect(invalid.message).not.toMatch(/sk-/);

    fetchFn.mockImplementationOnce(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const valid = await runAgentConnectionTest(
      { type: 'OpenAI', url: 'https://api.openai.com/v1', apiKey: 'sk-good' },
      fetchFn,
    );
    expect(valid.ok).toBe(true);
  });
});

describe('runAgentConnectionTest (Gemini service account)', () => {
  const serviceAccountJson = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    client_email: 'agent@test-project.iam.gserviceaccount.com',
    client_id: '123',
    token_uri: 'https://oauth2.googleapis.com/token',
  });

  it('lists models using OAuth bearer from service account JSON', async () => {
    vi.spyOn(geminiAuth, 'geminiAccessTokenFromCredentialsJson').mockResolvedValue('ya29.gemini-test');
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ya29.gemini-test');
      return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }] }), { status: 200 });
    });
    const result = await runAgentConnectionTest(
      {
        type: 'Gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: serviceAccountJson,
      },
      fetchFn,
    );
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['gemini-2.5-flash']);
    vi.restoreAllMocks();
  });
});
