import { describe, expect, it } from 'vitest';
import { parseGeneratedTasksPayload } from './parse-tasks';

describe('parse-tasks partition agent JSON', () => {
  it('accepts brief_path partition tasks without prompt or output_type', () => {
    const sample = {
      tasks: [
        {
          id: 'partition-01-supabase-backend-foundation',
          title: 'Supabase backend foundation',
          project_id: 'switch-to-supabase',
          brief_path: 'battleplan/projects/switch-to-supabase/tasks/partition-01-supabase-backend-foundation/outputs/brief.md',
        },
        {
          id: 'partition-02-mvp-auth',
          title: 'MVP Auth',
          brief_path: 'battleplan/projects/switch-to-supabase/tasks/partition-02-mvp-auth/outputs/brief.md',
        },
      ],
      edges: [],
    };
    const text = `Cursor\n\n${JSON.stringify(sample, null, 2)}\n\nCommits are on cursor/example branch.`;
    const parsed = parseGeneratedTasksPayload(text);
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0]?.title).toBe('Supabase backend foundation');
    expect(parsed.tasks[0]?.output_type).toBe('research');
    expect(parsed.tasks[0]?.prompt).toMatch(/brief at/i);
    expect(parsed.tasks[0]?.repo_path).toBe(
      'battleplan/projects/switch-to-supabase/tasks/partition-01-supabase-backend-foundation/outputs/',
    );
  });
});
