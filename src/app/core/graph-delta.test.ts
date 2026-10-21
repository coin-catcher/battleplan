import { describe, expect, it } from 'vitest';
import type { TaskDraft } from './models';
import { graphDeltaFromTaskDrafts, validateGraphDeltaProposal } from './graph-delta';

describe('graph-delta', () => {
  it('wraps generate task drafts as add_node ops', () => {
    const drafts: TaskDraft[] = [{
      title: 'Foundation',
      prompt: 'Build schema',
      output_type: 'code',
      depends_on: [],
    }];
    const proposal = graphDeltaFromTaskDrafts(drafts, 'generate_tasks');
    expect(proposal.ops).toHaveLength(1);
    expect(proposal.ops[0]?.op).toBe('add_node');
  });

  it('flags invalid proposals', () => {
    const issues = validateGraphDeltaProposal({
      proposal_id: 'p1',
      source: 'manual',
      created_at: new Date().toISOString(),
      ops: [],
    });
    expect(issues.some((item) => item.path === 'ops')).toBe(true);
  });
});
