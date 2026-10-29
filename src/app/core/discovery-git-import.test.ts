import { describe, expect, it } from 'vitest';
import { taskBriefFromGitFileContent } from './discovery-git-import';

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
