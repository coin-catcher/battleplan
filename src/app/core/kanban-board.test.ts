import { describe, expect, it } from 'vitest';
import { buildKanbanBoard } from './kanban-board';
import type { Project, ProjectTask } from './models';

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
});
