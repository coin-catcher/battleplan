import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { applyLinkRelocation } from './link-relocation';

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

describe('applyLinkRelocation', () => {
  it('moves a child link target to another task', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['child'] }),
      task({ task_id: 'child' }),
      task({ task_id: 'other' }),
    ];
    const next = applyLinkRelocation(tasks, { kind: 'child', from: 'parent', to: 'child' }, 'to', 'other');
    expect(next.find((item) => item.task_id === 'parent')?.dependencies).toEqual(['other']);
  });

  it('moves a child link source to another parent', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['child'] }),
      task({ task_id: 'parent2' }),
      task({ task_id: 'child' }),
    ];
    const next = applyLinkRelocation(tasks, { kind: 'child', from: 'parent', to: 'child' }, 'from', 'parent2');
    expect(next.find((item) => item.task_id === 'parent')?.dependencies).toEqual([]);
    expect(next.find((item) => item.task_id === 'parent2')?.dependencies).toEqual(['child']);
  });

  it('moves a sibling link target', () => {
    const tasks = [
      task({ task_id: 'a', sibling_dependencies: ['b'] }),
      task({ task_id: 'b' }),
      task({ task_id: 'c' }),
    ];
    const next = applyLinkRelocation(tasks, { kind: 'sibling', from: 'a', to: 'b' }, 'to', 'c');
    expect(next.find((item) => item.task_id === 'a')?.sibling_dependencies).toEqual(['c']);
  });

  it('detaches a task from parents for project-root moves', () => {
    const tasks = [
      task({ task_id: 'parent', dependencies: ['child'] }),
      task({ task_id: 'child' }),
    ];
    const next = applyLinkRelocation(tasks, { kind: 'project-root', from: 'project', to: 'child' }, 'to', 'child');
    expect(next.find((item) => item.task_id === 'parent')?.dependencies).toEqual([]);
  });
});
