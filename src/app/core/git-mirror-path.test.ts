import { describe, expect, it } from 'vitest';
import { assertBattleplanGitMirrorPath, repoFolderFromDraftPaths } from './git-mirror-path';

describe('git-mirror-path', () => {
  it('derives repo folder from brief_path', () => {
    expect(repoFolderFromDraftPaths(
      undefined,
      'battleplan/projects/p1/tasks/partition-a/outputs/brief.md',
    )).toBe('battleplan/projects/p1/tasks/partition-a/outputs/');
  });

  it('rejects paths outside battleplan/', () => {
    expect(() => assertBattleplanGitMirrorPath('research/x/brief.md')).toThrow(/battleplan/);
  });
});
