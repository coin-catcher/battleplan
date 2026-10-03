import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { availableDescendants, independentBatch, isAvailableDescendant } from './execute-children';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id'>): ProjectTask {
  return {
    project_id: 'p1',
    title: partial.task_id,
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    ...partial,
  };
}

describe('execute children', () => {
  it('offers leaf TODO descendants first', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['leaf', 'branch'] }),
      task({ task_id: 'branch', dependencies: ['leaf'] }),
      task({ task_id: 'leaf' }),
    ];
    const available = availableDescendants('parent', tasks);
    expect(available.map((item) => item.task_id)).toEqual(['leaf']);
  });

  it('returns no descendants when every child is finished', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['child'] }),
      task({ task_id: 'child', status: 'DONE' }),
    ];
    expect(availableDescendants('parent', tasks)).toEqual([]);
    expect(isAvailableDescendant(tasks[0], tasks)).toBe(true);
  });

  it('skips sibling-dependent tasks in the same batch', () => {
    const tasks = [
      task({ task_id: 'a', sibling_dependencies: ['b'] }),
      task({ task_id: 'b' }),
    ];
    const available = [tasks[0], tasks[1]];
    const batch = independentBatch(available, tasks);
    expect(batch.map((item) => item.task_id)).toEqual(['b']);
  });
});
