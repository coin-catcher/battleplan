import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import {
  appendOrchestrationTransition,
  isOrchestrationRunComplete,
  newGraphOrchestrationRun,
  isOrchestrationDispatchCandidate,
  orchestrationDispatchBatch,
  orchestrationScopeTaskIds,
  planExecutionWaves,
  reconcileRunningTasks,
  terminalTaskIds,
} from './graph-orchestration';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask {
  return {
    project_id: 'p1',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: 't',
    updated_at: 't',
    ...partial,
  };
}

describe('graph-orchestration', () => {
  it('scopes subtree runs to root and descendants', () => {
    const tasks = [
      task({ task_id: 'root', title: 'Root', dependencies: ['child'] }),
      task({ task_id: 'child', title: 'Child' }),
      task({ task_id: 'other', title: 'Other' }),
    ];
    const scope = orchestrationScopeTaskIds('root', tasks);
    expect([...scope].sort()).toEqual(['child', 'root']);
  });

  it('scopes descendants_only runs without the root task', () => {
    const tasks = [
      task({ task_id: 'root', title: 'Root', dependencies: ['child'] }),
      task({ task_id: 'child', title: 'Child' }),
    ];
    const scope = orchestrationScopeTaskIds('root', tasks, { descendantsOnly: true });
    expect([...scope]).toEqual(['child']);
  });

  it('allows descendants_only runs to skip tree prereq from scope root', () => {
    const root = task({ task_id: 'root', title: 'Root', dependencies: ['child'], status: 'TODO' });
    const child = task({ task_id: 'child', title: 'Child', initial_prompt: 'go' });
    const edges: TaskGraphEdge[] = [
      { edge_id: 't', from_task_id: 'root', to_task_id: 'child', kind: 'tree' },
    ];
    const run = newGraphOrchestrationRun('root', 'run-1', '2020-01-01T00:00:00.000Z', { descendantsOnly: true });
    expect(isOrchestrationDispatchCandidate(child, [root, child], edges, run)).toBe(true);
  });

  it('allows re-execute candidates that already have a cursor agent', () => {
    const a = task({ task_id: 'a', title: 'A', initial_prompt: 'go', cursor_agent_id: 'agent-1' });
    const run = newGraphOrchestrationRun(undefined, 'run-1', '2020-01-01T00:00:00.000Z');
    expect(isOrchestrationDispatchCandidate(a, [a], [], run)).toBe(true);
  });

  it('dispatches ready parallel tasks respecting pause list', () => {
    const a = task({ task_id: 'a', title: 'A', initial_prompt: 'go' });
    const b = task({ task_id: 'b', title: 'B', initial_prompt: 'go' });
    const edges: TaskGraphEdge[] = [];
    const run = newGraphOrchestrationRun(undefined, 'run-1', '2020-01-01T00:00:00.000Z');
    run.paused_task_ids = ['b'];
    const batch = orchestrationDispatchBatch([a, b], edges, run);
    expect(batch.map((item) => item.task_id)).toEqual(['a']);
  });

  it('finds terminal nodes in scope', () => {
    const tasks = [
      task({ task_id: 'a', title: 'A', dependencies: ['b'] }),
      task({ task_id: 'b', title: 'B' }),
    ];
    const edges: TaskGraphEdge[] = [
      { edge_id: 'tree:a->b', from_task_id: 'a', to_task_id: 'b', kind: 'tree' },
    ];
    const scope = new Set(['a', 'b']);
    expect(terminalTaskIds(tasks, edges, scope)).toEqual(['b']);
  });

  it('completes when scoped tasks are done and nothing in flight', () => {
    const a = task({ task_id: 'a', title: 'A', status: 'DONE' });
    const b = task({ task_id: 'b', title: 'B', status: 'DONE' });
    const run = newGraphOrchestrationRun(undefined, 'run-1', '2020-01-01T00:00:00.000Z');
    expect(isOrchestrationRunComplete([a, b], [], run)).toBe(true);
  });

  it('plans execution waves from prerequisites', () => {
    const root = task({ task_id: 'root', title: 'Root', dependencies: ['c1', 'c2'] });
    const c1 = task({ task_id: 'c1', title: 'C1' });
    const c2 = task({ task_id: 'c2', title: 'C2' });
    const edges: TaskGraphEdge[] = [
      { edge_id: 't1', from_task_id: 'root', to_task_id: 'c1', kind: 'tree' },
      { edge_id: 't2', from_task_id: 'root', to_task_id: 'c2', kind: 'tree' },
    ];
    const waves = planExecutionWaves([root, c1, c2], edges, new Set(['root', 'c1', 'c2']), new Set());
    expect(waves[0]).toEqual(['root']);
    expect(waves[1]?.sort()).toEqual(['c1', 'c2']);
  });

  it('reconciles active agent runs after reload', () => {
    const doing = task({
      task_id: 't1',
      title: 'T1',
      status: 'DOING',
      cursor_agent_id: 'agent-1',
    });
    let run = newGraphOrchestrationRun(undefined, 'run-1', '2020-01-01T00:00:00.000Z');
    run = appendOrchestrationTransition(run, 'recover', { detail: 'reload' });
    run = reconcileRunningTasks([doing], run);
    expect(run.active_task_ids).toEqual(['t1']);
    expect(run.last_agent_runs[0]?.cursor_agent_id).toBe('agent-1');
  });
});
