import { describe, expect, it } from 'vitest';
import type { ProjectTask, TaskDraft } from './models';
import { prepareGeneratedDraftsForDiscovery, prepareGeneratedDraftsForLayer } from './generate-task-links';

const source: ProjectTask = {
  task_id: 'research',
  project_id: 'p',
  title: 'Research root',
  prompt: '',
  dependencies: [],
  status: 'DOING',
  output_type: 'research',
  order: 0,
  created_at: '',
  updated_at: '',
};

describe('prepareGeneratedDraftsForLayer', () => {
  it('anchors layer 1 under source task', () => {
    const drafts: TaskDraft[] = [{ title: 'A', prompt: 'p', output_type: 'code', depends_on: [] }];
    const out = prepareGeneratedDraftsForLayer(drafts, source, 1);
    expect(out[0].depends_on).toEqual(['Research root']);
  });

  it('keeps depends_on for layer 2+', () => {
    const drafts: TaskDraft[] = [{ title: 'B', prompt: 'p', output_type: 'code', depends_on: ['A'] }];
    const out = prepareGeneratedDraftsForLayer(drafts, source, 2);
    expect(out[0].depends_on).toEqual(['A']);
  });
});

describe('prepareGeneratedDraftsForDiscovery', () => {
  it('anchors depth-first layer 1 under partition title', () => {
    const drafts: TaskDraft[] = [{ title: 'Child', prompt: 'p', output_type: 'code', depends_on: [] }];
    const out = prepareGeneratedDraftsForDiscovery(drafts, source, {
      phase: 'depth_first',
      layer: 1,
      focusPartitionTitle: 'Partition A',
    });
    expect(out[0].depends_on).toEqual(['Partition A']);
  });
});
