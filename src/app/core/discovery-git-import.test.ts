import { describe, expect, it } from 'vitest';
import { pickBriefPathFromSynced, taskBriefFromGitFileContent } from './discovery-git-import';

describe('discovery-git-import brief parsing', () => {
  it('parses markdown section headings into a task brief', () => {
    const md = [
      '## Goal',
      'Ship auth.',
      '## Scope',
      'Login only.',
      '## Context',
      'Supabase project.',
      '## Acceptance',
      'Users can sign in.',
      '## Verify',
      'Manual test.',
      '## Timebox',
      '2h',
      '## Forbidden',
      'No PRs.',
      '## Report',
      'Summary in chat.',
      '## Standing',
      'Agent branch only.',
    ].join('\n');
    const brief = taskBriefFromGitFileContent(md, 'brief.md');
    expect(brief?.goal).toBe('Ship auth.');
    expect(brief?.scope).toBe('Login only.');
    expect(brief?.forbidden).toBe('No PRs.');
  });

  it('picks brief.md from synced paths', () => {
    const paths = [
      'battleplan/projects/p/tasks/a/outputs/README.md',
      'battleplan/projects/p/tasks/a/outputs/brief.md',
    ];
    expect(pickBriefPathFromSynced(paths)).toBe(paths[1]);
  });

  it('parses task-brief.json', () => {
    const json = JSON.stringify({
      goal: 'G',
      scope: 'S',
      context: 'C',
      acceptance: 'A',
      verify: 'V',
      timebox: 'T',
      forbidden: 'F',
      report: 'R',
      standing: 'ST',
    });
    const brief = taskBriefFromGitFileContent(json, 'task-brief.json');
    expect(brief?.goal).toBe('G');
  });
});

// expose parseTaskBriefMarkdown via taskBriefFromGitFileContent only — test markdown through public API above
