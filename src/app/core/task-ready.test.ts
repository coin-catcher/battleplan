import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { rebuildGraphEdgesFromLegacy } from './task-graph';
import { autoDispatchBatch, isAutoDispatchCandidate } from './task-ready';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask {
  return {
    project_id: 'p1',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('task-ready auto dispatch', () => {
  it('requires parent DONE before child dispatches', () => {
    const parent = task({ task_id: 'parent', title: 'Parent', status: 'TODO', dependencies: ['child'] });
    const child = task({ task_id: 'child', title: 'Child' });
    const edges = rebuildGraphEdgesFromLegacy([parent, child]);
    expect(isAutoDispatchCandidate(child, [parent, child], edges)).toBe(false);
    parent.status = 'DONE';
    expect(isAutoDispatchCandidate(child, [parent, child], edges)).toBe(true);
  });

  it('never auto-dispatches BLOCKED tasks', () => {
    const parent = task({ task_id: 'p', title: 'P', status: 'DONE', dependencies: ['c'] });
    const child = task({ task_id: 'c', title: 'C', status: 'BLOCKED' });
    const edges = rebuildGraphEdgesFromLegacy([parent, child]);
    expect(isAutoDispatchCandidate(child, [parent, child], edges)).toBe(false);
  });

  it('returns independent batch when siblings satisfied', () => {
    const a = task({ task_id: 'a', title: 'A', status: 'DONE' });
    const b = task({ task_id: 'b', title: 'B', sibling_dependencies: ['a'] });
    const edges = rebuildGraphEdgesFromLegacy([a, b]);
    const batch = autoDispatchBatch([a, b], edges);
    expect(batch.map((item) => item.task_id)).toEqual(['b']);
  });
});
