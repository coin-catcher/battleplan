import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  coalesceCachedTaskStatus,
  cloneProjectTask,
  shouldCoalesceInboundTaskStatus,
  taskChatAwaitingWorkflowReply,
} from './task-status-coalesce';
import type { ChatMessage } from './models';

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

describe('task-status-coalesce', () => {
  it('preserves DOING when cache says DONE but background poll is active', () => {
    const live = task({ status: 'DOING', cursor_agent_id: 'a1', latest_run_id: 'r1' });
    const cached = task({ status: 'DONE' });
    const merged = coalesceCachedTaskStatus(live, cached, true);
    expect(merged.status).toBe('DOING');
    expect(merged.latest_run_id).toBe('r1');
  });

  it('uses cached status when background poll is not active', () => {
    const live = task({ status: 'DOING', cursor_agent_id: 'a1' });
    const cached = task({ status: 'DONE' });
    expect(coalesceCachedTaskStatus(live, cached, false).status).toBe('DONE');
  });

  it('detects unanswered workflow reply on latest run', () => {
    const messages: ChatMessage[] = [
      {
        message_id: 'u1',
        scope: 'task',
        project_id: 'p1',
        task_id: 't1',
        role: 'user',
        content: 'go',
        run_id: 'r1',
        intent: 'feedback',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(taskChatAwaitingWorkflowReply(messages, 't1', 'r1')).toBe(true);
  });

  it('coalesces when awaiting workflow reply even before background poll registers', () => {
    const live = task({ status: 'DOING', cursor_agent_id: 'a1', latest_run_id: 'r1' });
    const inbound = task({ status: 'REVIEW' });
    const messages: ChatMessage[] = [
      {
        message_id: 'u1',
        scope: 'task',
        project_id: 'p1',
        task_id: 't1',
        role: 'user',
        content: 'go',
        run_id: 'r1',
        intent: 'feedback',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(shouldCoalesceInboundTaskStatus(live, inbound, messages, false)).toBe(true);
  });

  it('cloneProjectTask copies dependency arrays', () => {
    const original = task({ dependencies: ['x'] });
    const copy = cloneProjectTask(original);
    copy.dependencies.push('y');
    expect(original.dependencies).toEqual(['x']);
  });
});
