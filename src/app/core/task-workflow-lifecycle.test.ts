import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  inferWorkflowKindFromTask,
  workflowExecutionPreamble,
  workflowFeedbackPreamble,
} from './task-workflow-lifecycle';

const project = { title: 'Demo', project_id: 'p1' } as import('./models').Project;

const task = (partial: Partial<ProjectTask>): ProjectTask => ({
  task_id: 't1',
  project_id: 'p1',
  title: 'T',
  prompt: '',
  dependencies: [],
  status: 'TODO',
  output_type: 'research',
  order: 0,
  created_at: '',
  updated_at: '',
  ...partial,
});

describe('task-workflow-lifecycle', () => {
  it('infers workflow kinds from node_kind', () => {
    expect(inferWorkflowKindFromTask(task({ node_kind: 'brainstorm' }))).toBe('brainstorming');
    expect(inferWorkflowKindFromTask(task({ node_kind: 'critique' }))).toBe('critiquing');
    expect(inferWorkflowKindFromTask(task({ output_type: 'code' }))).toBe('code');
  });

  it('includes grilling instructions in brainstorm preamble', () => {
    const text = workflowExecutionPreamble('brainstorming', task({ node_kind: 'brainstorm' }), project);
    expect(text).toMatch(/Start Discovery/i);
    expect(text).toMatch(/distilled understanding/i);
  });

  it('adds critique rework guidance in feedback preamble', () => {
    const text = workflowFeedbackPreamble(task({ node_kind: 'critique' }));
    expect(text).toMatch(/rubric/i);
  });
});
