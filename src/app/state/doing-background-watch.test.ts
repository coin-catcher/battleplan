import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../core/models';
import { doingBackgroundWatchTaskIds, taskNeedsDoingBackgroundPoll } from './doing-background-watch';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id'>): ProjectTask {
  return {
    project_id: 'p1',
    title: 'Task',
    status: 'DOING',
    output_type: 'research',
    order: 0,
    map_x: 0,
    map_y: 0,
    dar: '',
    initial_prompt: '',
    dependencies: [],
    sibling_dependencies: [],
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('taskNeedsDoingBackgroundPoll', () => {
  it('polls code and research tasks in DOING with an agent', () => {
    expect(taskNeedsDoingBackgroundPoll(task({ output_type: 'code', cursor_agent_id: 'a1' }), undefined)).toBe(true);
    expect(taskNeedsDoingBackgroundPoll(task({ cursor_agent_id: 'a1' }), undefined)).toBe(true);
  });

  it('skips non-DOING and DOING without an agent', () => {
    expect(taskNeedsDoingBackgroundPoll(task({ status: 'REVIEW', cursor_agent_id: 'a1' }), undefined)).toBe(false);
    expect(taskNeedsDoingBackgroundPoll(task({ cursor_agent_id: undefined }), undefined)).toBe(false);
  });

  it('polls subproject nodes when the nested project has an agent', () => {
    const sub = task({ output_type: 'subproject', subproject_id: 'sp1', cursor_agent_id: undefined });
    expect(taskNeedsDoingBackgroundPoll(sub, 'agent-sp')).toBe(true);
    expect(taskNeedsDoingBackgroundPoll(sub, undefined)).toBe(false);
  });
});

describe('doingBackgroundWatchTaskIds', () => {
  it('returns task ids that need background polling', () => {
    const tasks = [
      task({ task_id: 't1', cursor_agent_id: 'a1' }),
      task({ task_id: 't2', status: 'TODO', cursor_agent_id: 'a2' }),
      task({ task_id: 't3', output_type: 'subproject', subproject_id: 'sp1' }),
    ];
    const ids = doingBackgroundWatchTaskIds(tasks, (id) => (id === 'sp1' ? 'agent-sp' : undefined));
    expect(ids).toEqual(['t1', 't3']);
  });
});
