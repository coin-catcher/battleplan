import { describe, expect, it } from 'vitest';
import { getAgentTypeDefinition } from './agent-types';
import { buildAgentTestConnectionRequest } from './agent-connection';

describe('buildAgentTestConnectionRequest', () => {
  it('builds Gemini GET /models with key query param', () => {
    const definition = getAgentTypeDefinition('Gemini');
    const request = buildAgentTestConnectionRequest(definition, 'test-gemini-key');
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=test-gemini-key');
    expect(request.headers).toEqual({});
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
});
