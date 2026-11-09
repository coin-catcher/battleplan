import { describe, expect, it } from 'vitest';
import type { ProjectTask } from '../core/models';
import { sessionKindForTask } from './agent-communications.service';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id'>): ProjectTask {
  return {
    project_id: 'p1',
    title: 'Task',
    status: 'DOING',
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
    ...partial,
  };
}

describe('sessionKindForTask', () => {
  it('maps output types to session kinds', () => {
    expect(sessionKindForTask(task({ output_type: 'subproject' }))).toBe('cursor');
    expect(sessionKindForTask(task({ output_type: 'research', research_agent_id: 'a1' }))).toBe('research');
    expect(sessionKindForTask(task({ output_type: 'code' }))).toBe('cursor');
  });
});
