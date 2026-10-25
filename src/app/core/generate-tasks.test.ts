import { describe, expect, it } from 'vitest';
import { prepareGeneratedDrafts } from './generate-task-links';
import {
  generateTasksInstructionForResearchTask,
  generateTasksInstructionForProject,
} from './generate-tasks';
import type { ProjectTask } from './models';

const sourceTask = (): ProjectTask => ({
  task_id: 'r1',
  project_id: 'p1',
  title: 'Research parent',
  prompt: '',
  output_type: 'research',
  dependencies: [],
  status: 'TODO',
  order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('generateTasksInstructionForResearchTask', () => {
  it('asks for a flat list of code tasks with empty depends_on by default', () => {
    const text = generateTasksInstructionForResearchTask('Catalog research');
    expect(text).toContain('one-dimensional list of code tasks');
    expect(text).toContain('depends_on to []');
    expect(text).toContain('complete brief');
    expect(text).toContain('critiquing');
    expect(text).toContain('break_condition');
  });
});

describe('generateTasksInstructionForProject', () => {
  it('includes JSON schema rules', () => {
    const text = generateTasksInstructionForProject();
    expect(text).toContain('"tasks"');
    expect(text).toContain('task_kind');
    expect(text).toContain('fan-in');
  });
});

describe('prepareGeneratedDrafts', () => {
  it('fills empty depends_on with the parent research title', () => {
    const drafts = prepareGeneratedDrafts([
      { title: 'A', prompt: 'Do A', output_type: 'code', depends_on: [] },
      { title: 'B', prompt: 'Do B', output_type: 'code', depends_on: ['Foundation'] },
    ], sourceTask());
    expect(drafts[0].depends_on).toEqual(['Research parent']);
    expect(drafts[1].depends_on).toEqual(['Foundation']);
  });
});
