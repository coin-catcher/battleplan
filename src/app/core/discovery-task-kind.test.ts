import { describe, expect, it } from 'vitest';
import { inferDiscoveryWorkflowKind, resolveDiscoveryTaskDraftFields } from './discovery-task-kind';

describe('discovery-task-kind', () => {
  it('infers code for layer-2 partition tasks without task_kind', () => {
    expect(inferDiscoveryWorkflowKind({
      title: 'Create MVP allowlist',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/x/outputs/brief.md',
    })).toBe('code');
  });

  it('infers critiquing from title and maps to research + critique node', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      title: 'Critique migration plan',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/x/outputs/brief.md',
    });
    expect(fields.output_type).toBe('research');
    expect(fields.node_kind).toBe('critique');
    expect(fields.task_kind_explicit).toBe(false);
  });

  it('honors explicit task_kind code', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      title: 'Edge function inventory',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/x/outputs/brief.md',
    });
    expect(fields.output_type).toBe('code');
    expect(fields.node_kind).toBe('work');
    expect(fields.task_kind_explicit).toBe(true);
  });

  it('honors explicit task_kind critiquing for review steps', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      title: 'Review migration plan',
      task_kind: 'critiquing',
      id: 'review-migration',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/review-migration/outputs/brief.md',
    });
    expect(fields.output_type).toBe('research');
    expect(fields.node_kind).toBe('critique');
  });
});
