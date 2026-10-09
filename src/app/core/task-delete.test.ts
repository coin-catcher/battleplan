import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { reparentChildrenOnTaskDelete } from './task-delete';

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

describe('reparentChildrenOnTaskDelete', () => {
  it('moves child tasks to the deleted task parent', () => {
    const tasks = [
      task({ task_id: 'grand', dependencies: ['middle'] }),
      task({ task_id: 'middle', dependencies: ['leaf'] }),
      task({ task_id: 'leaf' }),
    ];
    const next = reparentChildrenOnTaskDelete(tasks, 'middle');
    expect(next.find((item) => item.task_id === 'grand')?.dependencies).toEqual(['leaf']);
    expect(next.find((item) => item.task_id === 'leaf')?.dependencies).toEqual([]);
  });

  it('removes sibling dependency references to the deleted task', () => {
    const tasks = [
      task({ task_id: 'a', sibling_dependencies: ['b'] }),
      task({ task_id: 'b' }),
    ];
    const next = reparentChildrenOnTaskDelete(tasks, 'b');
    expect(next.find((item) => item.task_id === 'a')?.sibling_dependencies).toEqual([]);
  });
});
