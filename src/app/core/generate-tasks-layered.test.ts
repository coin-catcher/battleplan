import { describe, expect, it } from 'vitest';
import {
  buildDepthFirstDescentProposalMessage,
  buildPartitionProposalMessage,
  isGenerateTasksEndCommand,
} from './generate-tasks-layered';
import type { GenerateTasksSessionState } from './generate-tasks-layered';
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
    const text = buildPartitionProposalMessage(researchTask(), null, {
      activeGraphId: 'graph-1',
      activeGraphGoal: 'Plan feature',
    });
    expect(text).toMatch(/Start Discovery/i);
    expect(text).toMatch(/approve/i);
    expect(text).toMatch(/disapprove/i);
    expect(text).toMatch(/change/i);
    expect(text).toMatch(/titles only/i);
    expect(text).toMatch(/no JSON yet/i);
    expect(text).toMatch(/partition/i);
    expect(text).toMatch(/Layer 1/i);
  });

  it('depth-first prompt requires linked graphs with inputs, outputs, and edges', () => {
    const session: GenerateTasksSessionState = {
      sourceTaskId: 't1',
      phase: 'depth_first',
      layer: 1,
      activeGraphId: 'graph-partition-1',
      activeGraphGoal: 'Supabase backend foundation',
      partitionTitles: ['Supabase backend foundation', 'MVP Auth'],
      partitionIndex: 0,
      focusPartitionTitle: 'Supabase backend foundation',
    };
    const text = buildDepthFirstDescentProposalMessage(null, session);
    expect(text).toMatch(/directed graph/i);
    expect(text).toMatch(/not a flat checklist/i);
    expect(text).toMatch(/Outputs/i);
    expect(text).toMatch(/Inputs/i);
    expect(text).toMatch(/Spike–Gate/i);
    expect(text).toMatch(/GRAPH DONE/i);
    expect(text).not.toMatch(/titles only/i);
  });
});
