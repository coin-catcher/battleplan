import { describe, expect, it } from 'vitest';
import { canRunGenerateTasks } from './task-generate-eligibility';
import type { ProjectTask } from './models';

function task(partial: Partial<ProjectTask>): ProjectTask {
  return {
    task_id: 't',
    project_id: 'p',
    title: 'T',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'research',
    order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('canRunGenerateTasks', () => {
  it('allows brainstorm and plain research', () => {
    expect(canRunGenerateTasks(task({ node_kind: 'brainstorm', output_type: 'research' }))).toBe(true);
    expect(canRunGenerateTasks(task({ output_type: 'research' }))).toBe(true);
  });

  it('blocks code and subproject', () => {
    expect(canRunGenerateTasks(task({ output_type: 'code' }))).toBe(false);
    expect(canRunGenerateTasks(task({ output_type: 'subproject' }))).toBe(false);
  });
});
