import { describe, expect, it } from 'vitest';
import type { ProjectTask, ChatMessage } from '../core/models';
import {
  agentSessionWatchTaskIds,
  taskNeedsAgentSessionWatch,
} from './agent-session-watch';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id'>): ProjectTask {
  return {
    project_id: 'p1',
    title: 'T',
    status: 'REVIEW',
    output_type: 'code',
    order: 0,
    map_x: 0,
    map_y: 0,
    dar: '',
    initial_prompt: '',
    dependencies: [],
    sibling_dependencies: [],
    created_at: '',
    updated_at: '',
    cursor_agent_id: 'a1',
    latest_run_id: 'run-1',
    ...partial,
  };
}

describe('taskNeedsAgentSessionWatch', () => {
  it('keeps watch for REVIEW task awaiting workflow terminal reply', () => {
    const messages: ChatMessage[] = [
      {
        message_id: 'u1',
        scope: 'task',
        project_id: 'p1',
        task_id: 't1',
        role: 'user',
        content: 'go',
        created_at: '',
        run_id: 'run-1',
      },
      {
        message_id: 'a1',
        scope: 'task',
        project_id: 'p1',
        task_id: 't1',
        role: 'assistant',
        content: 'Working on that now.',
        created_at: '',
        run_id: 'run-1',
      },
    ];
    expect(taskNeedsAgentSessionWatch(task({ task_id: 't1' }), messages, undefined)).toBe(true);
  });

  it('includes force-pending task ids in watch list', () => {
    const tasks = [task({ task_id: 't1', status: 'TODO', cursor_agent_id: undefined })];
    const ids = agentSessionWatchTaskIds(tasks, () => undefined, ['t2']);
    expect(ids).toContain('t2');
  });
});