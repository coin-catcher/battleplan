import { describe, expect, it } from 'vitest';
import { messageContainsImportableTaskGraph, parseGeneratedTasksPayload } from './parse-tasks';

const SAMPLE = {
  graph_id: 'graph-be27cdb1-b55d-468c-bf38-c2e82bd45db6',
  partition_id: 'partition-01-supabase-backend-foundation',
  project_id: 'switch-to-supabase',
  tasks: [
    {
      id: 'sbf-create-mvp-allowlist',
      title: 'Create MVP allowlist',
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md'],
      pattern_id: null,
      inputs: ['partition-01-supabase-backend-foundation'],
    },
    {
      id: 'sbf-reconcile-mvp-allowlist',
      title: 'Reconcile MVP allowlist',
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-reconcile-mvp-allowlist/outputs/brief.md',
      pattern_id: 'spike-gate',
      inputs: ['sbf-create-mvp-allowlist'],
    },
    {
      id: 'sbf-local-workflow',
      title: 'Local workflow',
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-local-workflow/outputs/brief.md',
      pattern_id: 'leaf-fan-in-refactor',
      inputs: ['sbf-create-mvp-allowlist', 'sbf-reconcile-mvp-allowlist'],
    },
  ],
  edges: [
    { from: 'sbf-create-mvp-allowlist', to: 'sbf-reconcile-mvp-allowlist', kind: 'hard' },
    { from: 'sbf-create-mvp-allowlist', to: 'sbf-local-workflow', kind: 'hard' },
  ],
};

describe('parse-tasks discovery partition graph JSON', () => {
  it('parses agent graph wrapper with id refs, inputs, and hard/soft edges', () => {
    const preamble = 'Partition graph summary\nBranch: cursor/example\n\n';
    const text = `${preamble}${JSON.stringify(SAMPLE, null, 2)}`;
    expect(messageContainsImportableTaskGraph(text)).toBe(true);
    const parsed = parseGeneratedTasksPayload(text);
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.tasks[1]?.depends_on).toContain('Create MVP allowlist');
    expect(parsed.tasks[0]?.depends_on).toEqual([]);
    expect(parsed.tasks[0]?.graph_id).toBe(SAMPLE.graph_id);
    expect(parsed.edges[0]?.from).toBe('Create MVP allowlist');
    expect(parsed.edges[0]?.to).toBe('Reconcile MVP allowlist');
    expect(parsed.edges[0]?.kind).toBe('ordering');
    expect(parsed.edges[1]?.kind).toBe('ordering');
  });
});
