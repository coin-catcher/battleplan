import { describe, expect, it, vi } from 'vitest';
import { joinAgentApiUrl, testProjectAgentConnection } from './agent-connection';
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

describe('testProjectAgentConnection (Cursor Agent)', () => {
  it('succeeds with Basic auth using global Cursor key', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url);
      expect(init?.headers?.['authorization']).toBe(`Basic ${btoa('cursor-key:')}`);
      return { ok: true, status: 200, statusText: 'OK', text: async () => '{}' };
    });
    const result = await testProjectAgentConnection(cursorAgent(), 'cursor-key', fetchFn);
    expect(result.ok).toBe(true);
    expect(calls[0]).toBe('https://api.cursor.com/v1/me');
  });

  it('falls back to /v1/agents when /v1/me fails', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/me')) {
        return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
      }
      return { ok: true, status: 200, statusText: 'OK', text: async () => '{"items":[]}' };
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
