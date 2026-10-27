import { describe, expect, it } from 'vitest';
import type { ProjectTask, TaskDraft } from './models';
import { splitDiscoveryDrafts } from './discovery-cross-graph';

const existing: ProjectTask[] = [{
  task_id: 't1',
  project_id: 'p',
  title: 'Old code task',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'code',
  order: 0,
  created_at: '',
  updated_at: '',
  graph_id: 'graph-a',
}];

describe('splitDiscoveryDrafts', () => {
  it('updates existing task when cross_graph_edit is set', () => {
    const drafts: TaskDraft[] = [{
      title: 'Old code task',
      prompt: 'new brief',
      output_type: 'code',
      depends_on: [],
      cross_graph_edit: true,
      cross_graph_edit_rationale: 'Align with partition B',
    }];
    const { creates, updates } = splitDiscoveryDrafts(drafts, existing);
    expect(creates).toHaveLength(0);
    expect(updates[0].task_id).toBe('t1');
    expect(updates[0].prompt).toBe('new brief');
  });

  it('creates new tasks without cross_graph_edit', () => {
    const drafts: TaskDraft[] = [{ title: 'New', prompt: 'p', output_type: 'code', depends_on: [] }];
    const { creates, updates } = splitDiscoveryDrafts(drafts, existing);
    expect(updates).toHaveLength(0);
    expect(creates).toHaveLength(1);
  });
});
