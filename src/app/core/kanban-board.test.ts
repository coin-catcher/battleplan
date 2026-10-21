import { describe, expect, it } from 'vitest';
import {
  buildKanbanBoard,
  filterTasksForKanbanScope,
  listKanbanScopeOptions,
} from './kanban-board';
import type { Project, ProjectTask } from './models';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask {
  return {
    project_id: 'p1',
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

describe('kanban-board', () => {
  it('groups tasks by Battleplan status', () => {
    const project = { project_id: 'p1', title: 'P' } as Project;
    const tasks: ProjectTask[] = [
      {
        task_id: 't1',
        project_id: 'p1',
        title: 'Alpha',
        prompt: '',
        dependencies: [],
        status: 'TODO',
        output_type: 'code',
        order: 0,
        created_at: '',
        updated_at: '',
      },
    ];
    const board = buildKanbanBoard(tasks, project, []);
    const todo = board.find((col) => col.status === 'TODO');
    expect(todo?.cards).toHaveLength(1);
    expect(todo?.cards[0]?.connector_kind).toBe('cursor');
  });

  it('lists main plus each subproject as kanban scopes', () => {
    const tasks: ProjectTask[] = [
      task({ task_id: 'sp', title: 'Sub A', output_type: 'subproject', dependencies: ['child'] }),
      task({ task_id: 'child', title: 'Child' }),
    ];
    expect(listKanbanScopeOptions(tasks).map((option) => option.id)).toEqual(['main', 'sp']);
  });

  it('filters main scope to tasks outside subproject subtrees', () => {
    const tasks: ProjectTask[] = [
      task({ task_id: 'root', title: 'Root' }),
      task({ task_id: 'sp', title: 'Sub', output_type: 'subproject', dependencies: ['child', 'done'] }),
      task({ task_id: 'child', title: 'Child' }),
      task({ task_id: 'done', title: 'Old done', status: 'DONE' }),
    ];
    const main = filterTasksForKanbanScope(tasks, 'main');
    expect(main.map((item) => item.task_id)).toEqual(['root']);
    const scoped = filterTasksForKanbanScope(tasks, 'sp');
    expect(scoped.map((item) => item.task_id)).toEqual(['child', 'done']);
  });
});
