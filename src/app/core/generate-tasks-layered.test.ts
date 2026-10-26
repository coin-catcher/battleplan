import { describe, expect, it } from 'vitest';
import {
  buildLayeredGenerateTasksProposalMessage,
  isGenerateTasksEndCommand,
} from './generate-tasks-layered';
import type { ProjectTask } from './models';

function researchTask(): ProjectTask {
  return {
    task_id: 't1',
    project_id: 'p1',
    title: 'Plan feature',
    prompt: '',
    dependencies: [],
    status: 'DOING',
    output_type: 'research',
    order: 0,
    created_at: '',
    updated_at: '',
  };
}

describe('generate-tasks-layered', () => {
  it('detects END command', () => {
    expect(isGenerateTasksEndCommand('END')).toBe(true);
    expect(isGenerateTasksEndCommand('end')).toBe(true);
    expect(isGenerateTasksEndCommand('approve 1')).toBe(false);
  });

  it('layer proposal mentions approve/disapprove/change and titles only', () => {
    const text = buildLayeredGenerateTasksProposalMessage(researchTask(), 1);
    expect(text).toMatch(/approve/i);
    expect(text).toMatch(/disapprove/i);
    expect(text).toMatch(/change/i);
    expect(text).toMatch(/titles only/i);
    expect(text).toMatch(/no JSON yet/i);
  });
});
