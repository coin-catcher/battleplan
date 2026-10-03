import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './models';
import {
  parseMergePullNumber,
  syncPendingChangesForProject,
} from './pending-changes';

const project: Project = {
  project_id: 'p1',
  title: 'Battleplan',
  initial_prompt: 'Plan',
  cursor_chat_link: 'https://cursor.com/agents/a1',
  repo_url: 'https://github.com/coin-catcher/battleplan',
  created_at: '2026-10-03T00:00:00.000Z',
  updated_at: '2026-10-03T00:00:00.000Z',
};

describe('pending changes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses merge commit messages for pull numbers', () => {
    expect(parseMergePullNumber('Merge pull request #34 from org/branch')).toBe(34);
    expect(parseMergePullNumber('chore: bump version')).toBeNull();
  });

  it('builds pending rows from develop commits not in main', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/compare/main...develop')) {
        return new Response(JSON.stringify({
          ahead_by: 1,
          commits: [{
            sha: 'abc123',
            html_url: 'https://github.com/coin-catcher/battleplan/commit/abc123',
            commit: { message: 'Merge pull request #34 from coin-catcher/bugfix\n\nFix pending changes.' },
          }],
        }), { status: 200 });
      }
      if (url.includes('/pulls/34')) {
        return new Response(JSON.stringify({
          merged: true,
          base: { ref: 'develop' },
          title: 'Fix pending changes sync',
          body: 'Uses GitHub compare to list develop-only commits.',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const rows = await syncPendingChangesForProject({
      project,
      tasks: [],
      codeOutputs: {},
      researchOutputs: {},
      current: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.change_id).toBe('abc123');
    expect(rows[0]?.task_title).toBe('Fix pending changes sync');
    expect(rows[0]?.summary).toContain('Fix pending changes sync');
  });

  it('clears pending rows when develop matches main', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ahead_by: 0, commits: [] }), { status: 200 })));

    const rows = await syncPendingChangesForProject({
      project,
      tasks: [],
      codeOutputs: {},
      researchOutputs: {},
      current: [{
        change_id: 'old',
        task_id: '',
        task_title: 'Old',
        summary: 'Old change',
      }],
    });

    expect(rows).toEqual([]);
  });
});
