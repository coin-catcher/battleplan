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
    expect(fields.graph_type).toBe('critique');
    expect(fields.type_explicit).toBe(false);
  });

  it('honors explicit type code', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      title: 'Edge function inventory',
      type: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/x/outputs/brief.md',
    });
    expect(fields.output_type).toBe('code');
    expect(fields.node_kind).toBe('work');
    expect(fields.graph_type).toBe('code');
    expect(fields.type_explicit).toBe(true);
  });

  it('honors explicit type critique for review steps', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      title: 'Review migration plan',
      type: 'critique',
      id: 'review-migration',
      layer: 2,
      brief_path: 'battleplan/projects/p/tasks/review-migration/outputs/brief.md',
    });
    expect(fields.output_type).toBe('research');
    expect(fields.node_kind).toBe('critique');
    expect(fields.graph_type).toBe('critique');
  });

  it('defaults inferred research on partition rows to subgraph mode', () => {
    const fields = resolveDiscoveryTaskDraftFields({
      id: 'partition-01-x',
      title: 'Partition',
      brief_path: 'battleplan/projects/p/tasks/partition-01-x/outputs/brief.md',
    });
    expect(fields.graph_type).toBe('research');
    expect(fields.research_mode).toBe('subgraph');
  });
});
