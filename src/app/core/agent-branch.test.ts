import { describe, expect, it } from 'vitest';
import {
  agentBranchPolicyLines,
  branchNamesFromRun,
  mergeConflictRecoveryPrompt,
  pickTaskAgentBranch,
} from './agent-branch';
import type { CursorRun } from '../data/cursor-browser';

describe('branchNamesFromRun', () => {
  it('deduplicates branch names from git metadata', () => {
    const run: CursorRun = {
      id: 'r1',
      agentId: 'a1',
      status: 'FINISHED',
      git: {
        branches: [
          { repoUrl: 'https://github.com/org/repo', branch: 'cursor/a' },
          { repoUrl: 'https://github.com/org/repo', branch: 'cursor/b' },
          { repoUrl: 'https://github.com/org/repo', branch: 'cursor/a' },
        ],
      },
    };
    expect(branchNamesFromRun(run)).toEqual(['cursor/a', 'cursor/b']);
  });
});

describe('pickTaskAgentBranch', () => {
  it('prefers the branch with commits when a stale branch has none', async () => {
    const fetchImpl = async (input: RequestInfo): Promise<Response> => {
      const url = decodeURIComponent(String(input));
      if (url.includes('cursor/stale')) {
        return new Response(JSON.stringify({ ahead_by: 0, commits: [] }), { status: 200 });
      }
      if (url.includes('cursor/active')) {
        return new Response(JSON.stringify({ ahead_by: 3, commits: [{ sha: 'abc', commit: { message: 'x' } }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl as typeof fetch;
    try {
      const picked = await pickTaskAgentBranch({
        branchNames: ['cursor/stale', 'cursor/active'],
        preferred: 'cursor/stale',
        owner: 'org',
        repo: 'repo',
        base: 'develop',
        token: 'pat',
      });
      expect(picked?.branch).toBe('cursor/active');
      expect(picked?.aheadBy).toBe(3);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('agentBranchPolicyLines', () => {
  it('forbids agent-created pull requests', () => {
    const lines = agentBranchPolicyLines({ baseBranch: 'develop', agentBranch: 'cursor/task-1' });
    expect(lines.join('\n')).toContain('Do not create, update, or merge pull requests');
    expect(lines.join('\n')).toContain('cursor/task-1');
  });
});

describe('mergeConflictRecoveryPrompt', () => {
  it('instructs the agent to merge develop and resolve conflicts', () => {
    const text = mergeConflictRecoveryPrompt({ baseBranch: 'develop', agentBranch: 'cursor/task-1' });
    expect(text).toContain('merge conflicts');
    expect(text).toContain('develop');
    expect(text).toContain('cursor/task-1');
    expect(text).toContain('summarize which files conflicted');
  });
});
