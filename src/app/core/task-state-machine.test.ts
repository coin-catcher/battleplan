import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  applyTaskStatusTransition,
  assertTaskTransition,
  taskNeedsDoingBackgroundPoll,
} from './task-state-machine';

function task(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    task_id: 't1',
    project_id: 'p1',
    title: 'Task',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('task-state-machine', () => {
  it('allows automatic workflow transitions from the battleplan spec', () => {
    expect(() => assertTaskTransition('TODO', 'DOING', 'execute_or_send')).not.toThrow();
    expect(() => assertTaskTransition('DOING', 'REVIEW', 'agent_finished')).not.toThrow();
    expect(() => assertTaskTransition('REVIEW', 'DOING', 'execute_or_send')).not.toThrow();
    expect(() => assertTaskTransition('REVIEW', 'DONE', 'approve_merge')).not.toThrow();
    expect(() => assertTaskTransition('DOING', 'DONE', 'approve_merge')).not.toThrow();
    expect(() => assertTaskTransition('REVIEW', 'DOING', 'approve_start')).not.toThrow();
  });

  it('rejects automatic transitions that skip the workflow', () => {
    expect(() => assertTaskTransition('DOING', 'TODO', 'agent_finished')).toThrow();
    expect(() => assertTaskTransition('TODO', 'REVIEW', 'agent_finished')).toThrow();
    expect(() => assertTaskTransition('TODO', 'BLOCKED', 'execute_or_send')).toThrow();
  });

  it('allows any manual status change including from terminal states', () => {
    expect(() => assertTaskTransition('TODO', 'BLOCKED', 'manual')).not.toThrow();
    expect(() => assertTaskTransition('BLOCKED', 'TODO', 'manual')).not.toThrow();
    expect(() => assertTaskTransition('DONE', 'REVIEW', 'manual')).not.toThrow();
    expect(() => assertTaskTransition('ABANDONED', 'TODO', 'manual')).not.toThrow();
  });

  it('applyTaskStatusTransition updates status and clears pending_action', () => {
    const item = task({ status: 'REVIEW', pending_action: 'merge' });
    applyTaskStatusTransition(item, 'DONE', 'approve_merge');
    expect(item.status).toBe('DONE');
    expect(item.pending_action).toBeUndefined();
  });

  it('taskNeedsDoingBackgroundPoll matches DOING tasks with an agent', () => {
    expect(taskNeedsDoingBackgroundPoll(task({ status: 'DOING', cursor_agent_id: 'a1' }), undefined)).toBe(true);
    expect(taskNeedsDoingBackgroundPoll(task({ status: 'REVIEW', cursor_agent_id: 'a1' }), undefined)).toBe(false);
    expect(taskNeedsDoingBackgroundPoll(
      task({ status: 'DOING', output_type: 'subproject', subproject_id: 'sp1' }),
      'agent-sub',
    )).toBe(true);
  });
});
