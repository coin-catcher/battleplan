import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendPendingChangeRows } from './pending-changes';
import { createPullRequest, mergePullRequest } from './github-client';

describe('appendPendingChangeRows', () => {
  it('merges rows by change_id', () => {
    const current = [{
      change_id: 'a',
      task_id: 't1',
      task_title: 'One',
      summary: 'First',
      merged_to_develop_at: '2026-01-02T00:00:00.000Z',
    }];
    const rows = [{
      change_id: 'b',
      task_id: 't2',
      task_title: 'Two',
      summary: 'Second',
      merged_to_develop_at: '2026-01-03T00:00:00.000Z',
    }];
    const merged = appendPendingChangeRows(current, rows);
    expect(merged.map((item) => item.change_id).sort()).toEqual(['a', 'b']);
  });
});

describe('github-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a pull request when none is open', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes('/pulls?state=open')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/pulls') && !url.includes('commits')) {
        return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/pull/7' }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const pull = await createPullRequest({
      owner: 'o',
      repo: 'r',
      head: 'cursor/feature',
      base: 'develop',
      title: 'Feature',
      token: 'ghp_test',
    });
    expect(pull.number).toBe(7);
  });

  it('merges an existing pull request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ merged: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await mergePullRequest('o', 'r', 7, 'ghp_test');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
