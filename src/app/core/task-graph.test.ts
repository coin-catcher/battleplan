import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  mnemosyneDefaultRelativePath,
  rebuildGraphEdgesFromLegacy,
  validateTaskGraphEdges,
} from './task-graph';

function task(id: string, partial: Partial<ProjectTask> = {}): ProjectTask {
  return {
    task_id: id,
    project_id: 'p1',
    title: id,
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

describe('task-graph', () => {
  it('rebuilds tree and ordering edges from legacy fields', () => {
    const parent = task('p', { dependencies: ['c'] });
    const child = task('c', { sibling_dependencies: ['x'] });
    const x = task('x');
    const edges = rebuildGraphEdgesFromLegacy([parent, child, x]);
    expect(edges.some((edge) => edge.kind === 'tree' && edge.from_task_id === 'p')).toBe(true);
    expect(edges.some((edge) => edge.kind === 'ordering' && edge.from_task_id === 'x' && edge.to_task_id === 'c')).toBe(true);
  });

  it('requires break_condition on cycle edges', () => {
    const ids = new Set(['a', 'b']);
    expect(() => validateTaskGraphEdges([
      { edge_id: '1', from_task_id: 'a', to_task_id: 'b', kind: 'cycle' },
    ], ids)).toThrow(/break_condition/i);
  });

  it('defaults mnemosyne path per project', () => {
    expect(mnemosyneDefaultRelativePath('abc')).toBe('mnemosyne/abc');
  });
});
