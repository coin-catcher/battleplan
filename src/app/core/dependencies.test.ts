import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { migrateLegacyDependencies, migrateMutualLinksToSiblingDependencies, normalChildIds } from './dependencies';

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
  it('ignores deleted child ids when listing normal children', () => {
    const tasks = [task({ task_id: 'parent', dependencies: ['missing', 'child'] }), task({ task_id: 'child' })];
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    expect(normalChildIds(tasks[0], byId)).toEqual(['child']);
  });

  it('treats dependencies as normal child links', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['child'] }),
      task({ task_id: 'child' }),
    ];
    const byId = new Map(tasks.map((item) => [item.task_id, item]));
    expect(normalChildIds(tasks[0], byId)).toEqual(['child']);
  });

  it('migrates legacy prerequisite lists into parent links', () => {
    const tasks = [
      task({ task_id: 'parent', title: 'Parent', order: 0 }),
      task({ task_id: 'child', title: 'Child', order: 1, dependencies: ['parent'] }),
    ];
    expect(migrateLegacyDependencies(tasks)).toBe(true);
    expect(tasks[0].dependencies).toEqual(['child']);
    expect(tasks[1].dependencies).toEqual([]);
  });

  it('migrates mutual dependency links to sibling_dependencies', () => {
    const tasks = [
      task({ task_id: 'a', dependencies: ['b'] }),
      task({ task_id: 'b', dependencies: ['a'] }),
    ];
    expect(migrateMutualLinksToSiblingDependencies(tasks)).toBe(true);
    expect(tasks[0].dependencies).toEqual([]);
    expect(tasks[0].sibling_dependencies).toEqual(['b']);
    expect(tasks[1].dependencies).toEqual([]);
    expect(tasks[1].sibling_dependencies).toEqual(['a']);
  });
});
