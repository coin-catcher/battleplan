import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { isUnionPair, migrateLegacyDependencies, normalChildIds } from './dependencies';

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

describe('dependencies', () => {
  it('detects union pairs', () => {
    const tasks = [
      task({ task_id: 'a', dependencies: ['b'] }),
      task({ task_id: 'b', dependencies: ['a'] }),
    ];
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    expect(isUnionPair(byId, 'a', 'b')).toBe(true);
    expect(normalChildIds(tasks[0], byId)).toEqual([]);
  });

  it('migrates legacy prerequisite lists into parent links', () => {
    const tasks = [
      task({ task_id: 'parent', title: 'Parent' }),
      task({ task_id: 'child', title: 'Child', dependencies: ['parent'] }),
    ];
    expect(migrateLegacyDependencies(tasks)).toBe(true);
    expect(tasks[0].dependencies).toEqual(['child']);
    expect(tasks[1].dependencies).toEqual([]);
  });
});
