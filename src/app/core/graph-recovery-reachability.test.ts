import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { canRevealTaskOnMindmap } from './graph-recovery-reachability';

function task(id: string, extra: Partial<ProjectTask> = {}): ProjectTask {
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
    ...extra,
  };
}

describe('graph-recovery-reachability', () => {
  it('allows project roots without upstream links', () => {
    const root = task('root');
    const pool = [{ edge_id: 't', from_task_id: 'root', to_task_id: 'child', kind: 'tree' as const }];
    expect(canRevealTaskOnMindmap('root', [root], pool, new Set(), [])).toBe(true);
  });

  it('blocks orphans until a parent is revealed', () => {
    const root = task('root', { dependencies: ['child'] });
    const child = task('child');
    const pool = [{ edge_id: 't', from_task_id: 'root', to_task_id: 'child', kind: 'tree' as const }];
    expect(canRevealTaskOnMindmap('child', [root, child], pool, new Set(['root']), [])).toBe(true);
    expect(canRevealTaskOnMindmap('child', [root, child], pool, new Set(), [])).toBe(false);
  });
});