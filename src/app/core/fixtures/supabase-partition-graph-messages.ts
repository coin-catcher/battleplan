/** Real Discovery chat excerpt: GRAPH DONE + partition graph JSON (Supabase backend foundation). */
export const SUPABASE_GRAPH_DONE_USER_MESSAGE = `1. approve
2. approve
3. approve - soft dependency on #1
4. approve
5. approve
6. approve
7. approve
8. approve
GRAPH DONE`;

export const SUPABASE_PARTITION_GRAPH_JSON = {
  graph_id: 'graph-be27cdb1-b55d-468c-bf38-c2e82bd45db6',
  partition_id: 'partition-01-supabase-backend-foundation',
  project_id: 'switch-to-supabase',
  parent_partition_task_id: 'partition-01-supabase-backend-foundation',
  tasks: [
    {
      id: 'sbf-create-mvp-allowlist',
      title: 'Create MVP allowlist',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-create-mvp-allowlist/outputs/brief.md'],
      pattern_id: null,
      outputs: ['mvp-supabase-allowlist.md'],
      inputs: ['partition-01-supabase-backend-foundation'],
    },
    {
      id: 'sbf-reconcile-mvp-allowlist',
      title: 'Reconcile MVP allowlist',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-reconcile-mvp-allowlist/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-reconcile-mvp-allowlist/outputs/brief.md'],
      pattern_id: 'spike-gate',
      outputs: ['migration-reconciliation-plan.md', 'reconciliation-gate-checklist'],
      inputs: ['sbf-create-mvp-allowlist'],
    },
    {
      id: 'sbf-edge-function-inventory',
      title: 'Edge function inventory',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-edge-function-inventory/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-edge-function-inventory/outputs/brief.md'],
      pattern_id: null,
      outputs: ['edge-function-inventory.md'],
      inputs: ['sbf-create-mvp-allowlist'],
    },
    {
      id: 'sbf-edge-function-standard',
      title: 'Edge function standard',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-edge-function-standard/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-edge-function-standard/outputs/brief.md'],
      pattern_id: 'template-instance-cycle',
      outputs: ['edge-function-standard.md'],
      inputs: ['sbf-edge-function-inventory'],
    },
    {
      id: 'sbf-local-workflow',
      title: 'Local workflow',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-local-workflow/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-local-workflow/outputs/brief.md'],
      pattern_id: 'leaf-fan-in-refactor',
      outputs: ['local-workflow-checklist', 'supabase/README.md'],
      inputs: [
        'sbf-create-mvp-allowlist',
        'sbf-reconcile-mvp-allowlist',
        'sbf-edge-function-inventory',
        'sbf-edge-function-standard',
      ],
    },
    {
      id: 'sbf-continuous-integration',
      title: 'Continuous Integration',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-continuous-integration/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-continuous-integration/outputs/brief.md'],
      pattern_id: null,
      outputs: ['ci-supabase-spec', 'types.gen.ts policy'],
      inputs: ['sbf-local-workflow'],
    },
    {
      id: 'sbf-continuous-delivery',
      title: 'Continuous Delivery',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-continuous-delivery/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-continuous-delivery/outputs/brief.md'],
      pattern_id: null,
      outputs: ['cd-supabase-runbook'],
      inputs: ['sbf-continuous-integration'],
    },
    {
      id: 'sbf-post-mvp',
      title: 'Post-MVP',
      task_kind: 'code',
      layer: 2,
      brief_path: 'battleplan/projects/switch-to-supabase/tasks/sbf-post-mvp/outputs/brief.md',
      git_paths: ['battleplan/projects/switch-to-supabase/tasks/sbf-post-mvp/outputs/brief.md'],
      pattern_id: null,
      outputs: ['post-mvp-supabase-auth-spec.md'],
      inputs: [
        'sbf-create-mvp-allowlist',
        'sbf-reconcile-mvp-allowlist',
        'sbf-edge-function-inventory',
        'sbf-edge-function-standard',
        'sbf-local-workflow',
        'sbf-continuous-integration',
        'sbf-continuous-delivery',
      ],
    },
  ],
  edges: [
    { from: 'sbf-create-mvp-allowlist', to: 'sbf-reconcile-mvp-allowlist', kind: 'hard' },
    { from: 'sbf-create-mvp-allowlist', to: 'sbf-edge-function-inventory', kind: 'soft' },
    { from: 'sbf-edge-function-inventory', to: 'sbf-edge-function-standard', kind: 'hard' },
    { from: 'sbf-create-mvp-allowlist', to: 'sbf-local-workflow', kind: 'hard' },
    { from: 'sbf-reconcile-mvp-allowlist', to: 'sbf-local-workflow', kind: 'hard' },
    { from: 'sbf-edge-function-inventory', to: 'sbf-local-workflow', kind: 'hard' },
    { from: 'sbf-edge-function-standard', to: 'sbf-local-workflow', kind: 'hard' },
    { from: 'sbf-local-workflow', to: 'sbf-continuous-integration', kind: 'hard' },
    { from: 'sbf-continuous-integration', to: 'sbf-continuous-delivery', kind: 'hard' },
    { from: 'sbf-continuous-delivery', to: 'sbf-post-mvp', kind: 'hard' },
  ],
} as const;

export function buildSupabasePartitionGraphAssistantMessage(): string {
  const preamble = [
    'Partition graph summary',
    'Graph: graph-be27cdb1-b55d-468c-bf38-c2e82bd45db6 · Partition: partition-01-supabase-backend-foundation',
    'Spine: Allowlist → Reconcile (Spike–Gate) | Inventory → Standard (Template–Instance) → Local workflow (fan-in) → CI → CD → Post-MVP.',
    '',
    'Completed task graph index',
    'graph_id\tpartition\ttasks',
    'graph-be27cdb1-b55d-468c-bf38-c2e82bd45db6\tSupabase backend foundation\t8',
    'Prior Layer 1 partitions unchanged. No cross-graph edits.',
    '',
    'Branch: cursor/coin-catcher-release-preparation-8e79 (e768a4e)',
    '',
  ].join('\n');
  return `${preamble}${JSON.stringify(SUPABASE_PARTITION_GRAPH_JSON, null, 2)}`;
}

export const LAYER1_PARTITION_TITLES = [
  'Supabase backend foundation',
  'Next partition title',
  'Third partition',
] as const;
