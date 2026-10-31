import { describe, expect, it } from 'vitest';
import {
  normalizeTaskGraphType,
  parseCritiqueDecisionMode,
  taskGraphTypeFromRecord,
  validateDiscoveryTaskDraft,
} from './task-graph-type';
import type { TaskDraft } from './models';

describe('task-graph-type', () => {
  it('normalizes aliases onto canonical type', () => {
    expect(normalizeTaskGraphType('critique')).toBe('critique');
    expect(normalizeTaskGraphType('critiquing')).toBe('critique');
    expect(taskGraphTypeFromRecord({ task_kind: 'code' })).toBe('code');
    expect(taskGraphTypeFromRecord({ type: 'research' })).toBe('research');
  });

  it('requires two outputs for critique drafts', () => {
    const draft: TaskDraft = {
      title: 'Gate review',
      prompt: 'Decide',
      output_type: 'research',
      depends_on: [],
      graph_type: 'critique',
      node_kind: 'critique',
      brief_path: 'battleplan/projects/p/tasks/g/outputs/brief.md',
      discovery_outputs: ['proceed'],
    };
    const issues = validateDiscoveryTaskDraft(draft, 0);
    expect(issues.some((item) => item.path.endsWith('outputs'))).toBe(true);
  });

  it('accepts critique with two decision outputs', () => {
    const draft: TaskDraft = {
      title: 'Gate review',
      prompt: 'Decide',
      output_type: 'research',
      depends_on: [],
      graph_type: 'critique',
      graph_type_explicit: true,
      node_kind: 'critique',
      decision_mode: 'yes_no',
      discovery_outputs: ['pass-quality-gate', 'fail-rework'],
    };
    expect(validateDiscoveryTaskDraft(draft, 0)).toHaveLength(0);
  });

  it('parses decision_mode aliases from JSON records', () => {
    expect(parseCritiqueDecisionMode({ decision_mode: 'one_of' })).toBe('one_of');
    expect(parseCritiqueDecisionMode({ decision_type: 'multi-choice' })).toBe('multi');
  });
});
