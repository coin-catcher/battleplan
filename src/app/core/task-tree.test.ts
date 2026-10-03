import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { parseGeneratedTaskList, parseGeneratedTaskListFromSources } from './parse-tasks';
import type { ChatArtifact } from './models';
import { buildTaskForest, reorderTaskIds } from './task-tree';

function task(partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title' | 'order'>): ProjectTask {
  return {
    project_id: 'project-1',
    prompt: partial.title,
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: '2026-09-30T00:00:00.000Z',
    ...partial,
  };
}

describe('task tree', () => {
  it('nests each task under its deepest dependency and sorts siblings by order', () => {
    const forest = buildTaskForest([
      task({ task_id: 'a', title: 'Research', order: 2, output_type: 'research' }),
      task({ task_id: 'c', title: 'Review notes', order: 1, dependencies: ['a'] }),
      task({ task_id: 'b', title: 'Implement', order: 0, dependencies: ['a'] }),
      task({ task_id: 'd', title: 'Ship', order: 3, dependencies: ['b', 'c'] }),
    ]);

    expect(forest.map((node) => node.task.task_id)).toEqual(['a']);
    expect(forest[0].children.map((node) => node.task.task_id)).toEqual(['b', 'c']);
    const review = forest[0].children[1];
    expect(review.children.map((node) => node.task.task_id)).toEqual(['d']);
  });

  it('keeps a cyclic dependency from looping forever', () => {
    const forest = buildTaskForest([
      task({ task_id: 'a', title: 'A', order: 0, dependencies: ['b'] }),
      task({ task_id: 'b', title: 'B', order: 1, dependencies: ['a'] }),
    ]);
    const count = (nodes: ReturnType<typeof buildTaskForest>): number =>
      nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);
    expect(count(forest)).toBe(2);
  });

  it('reorders a task among its siblings', () => {
    const tasks = [
      task({ task_id: 'a', title: 'A', order: 0 }),
      task({ task_id: 'b', title: 'B', order: 1 }),
      task({ task_id: 'c', title: 'C', order: 2, dependencies: ['a'] }),
    ];
    expect(reorderTaskIds(tasks, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(reorderTaskIds(tasks, 'c', 1)).toBe('edge');
  });
});

describe('parse generated tasks', () => {
  it('reads a fenced JSON task list', () => {
    const drafts = parseGeneratedTaskList(`Sure.\n\`\`\`json\n[{"title":"Notes","prompt":"Write notes","output_type":"research","depends_on":[]}]\n\`\`\``);
    expect(drafts).toEqual([
      { title: 'Notes', prompt: 'Write notes', output_type: 'research', depends_on: [] },
    ]);
  });

  it('rejects prose that is still brainstorming', () => {
    expect(() => parseGeneratedTaskList('Let us keep discussing the scope.')).toThrow(/JSON task array/);
  });

  it('reads a JSON task list from a text artifact when the reply is empty', () => {
    const artifacts: ChatArtifact[] = [{
      scope: 'project',
      project_id: 'p1',
      path: 'artifacts/tasks.json',
      name: 'tasks.json',
      size_bytes: 120,
      updated_at: '2026-10-02T00:00:00.000Z',
      content_type: 'text',
      text: '[{"title":"Ship","prompt":"Open the PR","output_type":"code","depends_on":[]}]',
    }];
    const drafts = parseGeneratedTaskListFromSources(
      'The agent finished. Attached files are shown with this conversation.',
      artifacts,
    );
    expect(drafts[0]?.title).toBe('Ship');
  });
});
