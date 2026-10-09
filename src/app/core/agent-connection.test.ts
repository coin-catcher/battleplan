import { describe, expect, it, vi } from 'vitest';
import {
  applyDynamicModelsToOptions,
  parseOpenAiModelIds,
  runAgentConnectionTest,
  selectChoicesForOption,
  type AgentHttpFetch,
} from './agent-connection';
import { localLlmHealthUrl, localLlmModelsUrl } from './local-llm';

describe('LocalLLM connection', () => {
  it('loads models after successful health check', async () => {
    const health = localLlmHealthUrl('http://127.0.0.1:8000/v1');
    const models = localLlmModelsUrl('http://127.0.0.1:8000/v1');
    const fetchFn: AgentHttpFetch = vi.fn(async (url) => {
      if (url === health) return { status: 200, bodyText: 'ok' };
      if (url === models) {
        return {
          status: 200,
          bodyText: JSON.stringify({ data: [{ id: 'meta-llama/Llama-3.1-8B' }, { id: 'other' }] }),
        };
      }
      return { status: 404, bodyText: 'not found' };
    });

    const result = await runAgentConnectionTest(
      { type: 'LocalLLM', url: 'http://127.0.0.1:8000/v1' },
      fetchFn,
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['meta-llama/Llama-3.1-8B', 'other']);
  });

  it('falls back to /v1/models when /health fails', async () => {
    const health = localLlmHealthUrl('http://127.0.0.1:8000/v1');
    const models = localLlmModelsUrl('http://127.0.0.1:8000/v1');
    const fetchFn: AgentHttpFetch = async (url) => {
      if (url === health) return { status: 404, bodyText: '' };
      if (url === models) {
        return { status: 200, bodyText: JSON.stringify({ data: [{ id: 'demo' }] }) };
      }
      return { status: 500, bodyText: '' };
    };

    const result = await runAgentConnectionTest(
      { type: 'LocalLLM', url: 'http://127.0.0.1:8000/v1' },
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
