import { describe, expect, it, vi } from 'vitest';
import { BrowserCursor } from './cursor-browser';

describe('BrowserCursor.createAgent', () => {
  it('never enables platform PR creation or PR-scoped repos', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({
        agent: { id: 'a1', name: 'Test', status: 'ACTIVE', url: 'https://cursor.com/agents/a1' },
        run: { id: 'r1', agentId: 'a1', status: 'CREATING' },
      }), { status: 200 });
    }));
    const client = new BrowserCursor(() => 'test-key');
    await client.createAgent({
      prompt: 'Do work',
      repoUrl: 'https://github.com/org/repo',
      startingRef: 'develop',
      autoCreatePr: true,
      prUrl: 'https://github.com/org/repo/pull/1',
    });
    expect(calls).toHaveLength(1);
    const body = calls[0].body as Record<string, unknown>;
    expect(body['autoCreatePR']).toBe(false);
    expect(body['workOnCurrentBranch']).toBe(false);
    const repos = body['repos'] as Array<Record<string, unknown>>;
    expect(repos[0]['url']).toBe('https://github.com/org/repo');
    expect(repos[0]['startingRef']).toBe('develop');
    expect(repos[0]['prUrl']).toBeUndefined();
    const envVars = body['envVars'] as Record<string, string>;
    expect(envVars['BATTLEPLAN_PR_POLICY']).toContain('must_not_create');
    vi.unstubAllGlobals();
  });
});
