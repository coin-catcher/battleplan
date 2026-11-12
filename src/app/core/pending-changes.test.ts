import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './models';
import {
  buildPendingChangesFromCommits,
  parseMergePullNumber,
  releaseSourceBranch,
  releaseTargetBranch,
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

  it('resolves release source and target branches with defaults', () => {
    expect(releaseSourceBranch(project)).toBe('develop');
    expect(releaseTargetBranch(project)).toBe('main');
    expect(releaseSourceBranch({ ...project, starting_ref: 'main' })).toBe('develop');
    expect(releaseSourceBranch({ ...project, starting_ref: 'feature/x' })).toBe('feature/x');
    expect(releaseSourceBranch({
      ...project,
      release_source_ref: 'release',
      starting_ref: 'feature/x',
    })).toBe('release');
    expect(releaseTargetBranch({ ...project, release_target_ref: 'production' })).toBe('production');
  });

  it('parses merge commit messages for pull numbers', () => {
    expect(parseMergePullNumber('Merge pull request #34 from org/branch')).toBe(34);
    expect(parseMergePullNumber('chore: bump version')).toBeNull();
  });

  it('builds pending rows from compare commits', async () => {
    const rows = await buildPendingChangesFromCommits({
      owner: 'coin-catcher',
      repo: 'battleplan',
      commits: [{
        sha: 'abc123',
        html_url: 'https://github.com/coin-catcher/battleplan/commit/abc123',
        message: 'Merge pull request #34 from coin-catcher/bugfix\n\nFix pending changes.',
      }],
      tasks: [],
      codeOutputs: {},
      researchOutputs: {},
      loadPull: async () => ({
        merged: true,
        baseRef: 'develop',
        title: 'Fix pending changes sync',
        body: 'Uses GitHub compare to list develop-only commits.',
      }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.change_id).toBe('abc123');
    expect(rows[0]?.task_title).toBe('Fix pending changes sync');
    expect(rows[0]?.summary).toContain('Fix pending changes sync');
  });

  it('returns no rows when compare commits are empty', async () => {
    const rows = await buildPendingChangesFromCommits({
      owner: 'coin-catcher',
      repo: 'battleplan',
      commits: [],
      tasks: [],
      codeOutputs: {},
      researchOutputs: {},
      loadPull: async () => null,
    });

    expect(rows).toEqual([]);
  });
});
