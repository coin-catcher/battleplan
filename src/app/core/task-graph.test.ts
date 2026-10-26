import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  mergeLegacyTreeOrderingIntoGraph,
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

  it('allows intentional rework loop when only cycle edges lack break on non-cycle edges in the loop', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(() => validateTaskGraphEdges([
      { edge_id: 'o1', from_task_id: 'a', to_task_id: 'b', kind: 'ordering' },
      { edge_id: 'c1', from_task_id: 'c', to_task_id: 'a', kind: 'cycle', break_condition: 'human:REVIEW' },
    ], ids)).not.toThrow();
  });

  it('defaults mnemosyne path per project', () => {
    expect(mnemosyneDefaultRelativePath('abc')).toBe('mnemosyne/abc');
  });

  it('preserves fork/join/cycle edges when re-syncing legacy tree/ordering', () => {
    const parent = task('p', { dependencies: ['c'] });
    const child = task('c');
    const cycle = {
      edge_id: 'cycle:c->p',
      from_task_id: 'c',
      to_task_id: 'p',
      kind: 'cycle' as const,
      break_condition: 'human:REVIEW',
    };
    const fork = {
      edge_id: 'fork:p->x',
      from_task_id: 'p',
      to_task_id: 'x',
      kind: 'fork' as const,
    };
    const merged = mergeLegacyTreeOrderingIntoGraph([cycle, fork], [parent, child, task('x')]);
    expect(merged.some((edge) => edge.kind === 'tree')).toBe(true);
    expect(merged.some((edge) => edge.kind === 'cycle')).toBe(true);
    expect(merged.some((edge) => edge.kind === 'fork')).toBe(true);
  });
});
