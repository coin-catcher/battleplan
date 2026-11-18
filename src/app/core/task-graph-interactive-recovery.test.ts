import { describe, expect, it } from 'vitest';
import type { Project } from './models';
import type { ProjectTask } from './models';
import {
  executionOrderTaskIds,
  initStagedGraphRecoverySession,
  resolveGraphRecoverySession,
  stagedGraphRecoveryStep,
  startInteractiveGraphRecovery,
} from './task-graph-interactive-recovery';

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
    map_x: 50,
    map_y: 60,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('task-graph-interactive-recovery', () => {
  it('starts in connected phase with orphaned ids stored separately', () => {
    const root = task('root', { dependencies: ['child'] });
    const child = task('child');
    const stray = task('stray', {}, 2);
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      dar: '',
      status: 'TODO',
      created_at: '',
      updated_at: '',
      task_graph_edges: [
        { edge_id: 'tree:root->child', from_task_id: 'root', to_task_id: 'child', kind: 'tree' },
      ],
    };
    const session = initStagedGraphRecoverySession(project, [root, child, stray]);
    expect(session.phase).toBe('connected');
    expect(session.orphaned_task_ids).toEqual(['stray']);
    expect(session.connected_task_ids).toContain('root');
  });

  it('confirms safe edges automatically and pauses on an accidental cycle', () => {
    const a = task('a', { sibling_dependencies: ['b'] });
    const b = task('b');
    const c = task('c', { map_x: 400, map_y: 240, sibling_dependencies: ['a'] });
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      dar: '',
      status: 'TODO',
      created_at: '',
      updated_at: '',
      task_graph_edges: [
        { edge_id: 'ordering:a->b', from_task_id: 'a', to_task_id: 'b', kind: 'ordering' },
        { edge_id: 'ordering:c->a', from_task_id: 'c', to_task_id: 'a', kind: 'ordering' },
        { edge_id: 'ordering:b->c', from_task_id: 'b', to_task_id: 'c', kind: 'ordering' },
      ],
    };

    const started = startInteractiveGraphRecovery(project, [a, b, c]);
    expect(started.session.mode).toBe('staged');
    expect(started.session.revealed_task_ids?.length).toBeGreaterThan(0);
    expect(started.tasks.find((item) => item.task_id === 'c')).toMatchObject({ map_x: 400, map_y: 240 });
  });

  it('reveals tasks in execution order for staged recovery', () => {
    const root = task('root', { dependencies: ['child'] });
    const child = task('child', { map_x: 440, map_y: 320 });
    const edges = [
      { edge_id: 'tree:root->child', from_task_id: 'root', to_task_id: 'child', kind: 'tree' as const },
    ];
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      dar: '',
      status: 'TODO',
      created_at: '',
      updated_at: '',
      task_graph_edges: edges,
    };
    const order = executionOrderTaskIds([root, child], edges);
    expect(order.indexOf('root')).toBeLessThan(order.indexOf('child'));
    let session = initStagedGraphRecoverySession(project, [root, child]);
    session = stagedGraphRecoveryStep(project, session, [root, child]);
    expect(session.revealed_task_ids).toEqual(['root']);
    session = stagedGraphRecoveryStep(project, session, [root, child]);
    expect(session.revealed_task_ids).toEqual(['root', 'child']);
    expect(session.confirmed_edges.some((edge) => edge.kind === 'tree')).toBe(true);
  });

  it('resumes after the user skips a blocked edge', () => {
    const blocked = { edge_id: 'ordering:a->b', from_task_id: 'a', to_task_id: 'b', kind: 'ordering' as const };
    const tree = { edge_id: 'tree:x->y', from_task_id: 'x', to_task_id: 'y', kind: 'tree' as const };
    const session = {
      active: true,
      confirmed_edges: [],
      remaining_candidates: [blocked, tree],
      skipped: [],
      pending: {
        kind: 'edge',
        edge: blocked,
        issue: 'blocked',
        alternatives: [],
      },
    };

    const resolved = resolveGraphRecoverySession(session, [
      task('a'),
      task('b', { dependencies: ['y'] }),
      task('x', { dependencies: ['y'] }),
      task('y'),
    ], { action: 'skip' });

    expect(resolved.session.skipped).toHaveLength(1);
    expect(resolved.session.pending).toBeUndefined();
    expect(resolved.session.confirmed_edges.some((edge) => edge.kind === 'tree')).toBe(true);
  });
});