import { describe, expect, it } from 'vitest';
import { bindSequentialDraftLinks, linkCreatedTasksUnderParent, prepareGeneratedDrafts } from './generate-task-links';
import type { ProjectTask } from './models';

const task = (partial: Partial<ProjectTask> & Pick<ProjectTask, 'task_id' | 'title'>): ProjectTask => ({
  project_id: 'p1',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'code',
  order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...partial,
});

describe('linkCreatedTasksUnderParent', () => {
  it('links orphan generated tasks under the source task', () => {
    const parent = task({ task_id: 'parent', title: 'Research', output_type: 'research' });
    const child = task({ task_id: 'c1', title: 'Code A', order: 1 });
    linkCreatedTasksUnderParent([parent], [child], 'parent');
    expect(parent.dependencies).toEqual(['c1']);
  });
});

describe('bindSequentialDraftLinks', () => {
  it('creates mutual sibling_dependencies for sequential_with pairs', () => {
    const a = task({ task_id: 'a', title: 'A', order: 0 });
    const b = task({ task_id: 'b', title: 'B', order: 1 });
    bindSequentialDraftLinks([], [a, b], [
      { sequential_with: ['B'] },
      { sequential_with: ['A'] },
    ]);
    expect(a.sibling_dependencies).toEqual(['b']);
    expect(b.sibling_dependencies).toEqual(['a']);
  });
});

describe('prepareGeneratedDrafts', () => {
  it('fills empty depends_on with the source task title', () => {
    const source = task({ task_id: 'r1', title: 'Research parent', output_type: 'research' });
    const drafts = prepareGeneratedDrafts([
      { title: 'A', prompt: 'x', output_type: 'code', depends_on: [] },
    ], source);
    expect(drafts[0].depends_on).toEqual(['Research parent']);
  });
});
