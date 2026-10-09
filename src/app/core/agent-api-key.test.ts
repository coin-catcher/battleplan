import { describe, expect, it } from 'vitest';
import { agentApiKeyRequired, agentCredentialFieldLabel, agentUsesServiceAccountJson, resolveAgentApiKey } from './agent-api-key';

describe('resolveAgentApiKey', () => {
  it('uses per-agent key when set', () => {
    expect(resolveAgentApiKey({ type: 'OpenAI', api_key: ' sk-local ' }, 'global')).toBe('sk-local');
  });

  it('falls back to global Cursor key for Cursor Agent', () => {
    expect(resolveAgentApiKey({ type: 'Cursor Agent' }, 'cursor-global')).toBe('cursor-global');
    expect(resolveAgentApiKey({ type: 'Cursor Agent', api_key: 'override' }, 'cursor-global')).toBe('override');
  });

  it('does not fall back for research providers', () => {
    expect(resolveAgentApiKey({ type: 'Anthropic' }, 'cursor-global')).toBe('');
  });

  it('marks Cursor as optional api key on agent record', () => {
    expect(agentApiKeyRequired('Cursor Agent')).toBe(false);
    expect(agentApiKeyRequired('OpenAI')).toBe(true);
  });

  it('uses service account JSON labeling for Gemini', () => {
    expect(agentUsesServiceAccountJson('Gemini')).toBe(true);
    expect(agentUsesServiceAccountJson('OpenAI')).toBe(false);
    expect(agentCredentialFieldLabel('Gemini')).toBe('Service account JSON');
    expect(agentCredentialFieldLabel('OpenAI')).toBe('API key');
  });
});
