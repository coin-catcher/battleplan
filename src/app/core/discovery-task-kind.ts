import type { LifecyclePhase } from './models';
import type { TaskNodeKind } from './task-node-kind';
import {
  normalizeWorkflowTaskKind,
  resolveDraftFieldsFromWorkflow,
  workflowKindToTaskFields,
  type WorkflowTaskKind,
} from './workflow-task-kind';

export interface DiscoveryTaskDraftFields {
  output_type: string;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
  workflow_kind?: WorkflowTaskKind;
  task_kind_explicit: boolean;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Infer workflow stencil when the agent omitted task_kind (legacy JSON). */
export function inferDiscoveryWorkflowKind(record: Record<string, unknown>): WorkflowTaskKind {
  const title = optionalText(record['title'])?.toLowerCase() ?? '';
  if (/\b(critique|review|audit|verify|gate check)\b/.test(title)) {
    return 'critiquing';
  }
  const pattern = optionalText(record['pattern_id'])?.toLowerCase();
  if (pattern === 'critique-retry' || pattern === 'critique_retry_loop') {
    return 'critiquing';
  }
  const layer = record['layer'];
  if (typeof layer === 'number' && layer >= 2) {
    return 'code';
  }
  if (optionalText(record['brief_path'])) {
    return 'code';
  }
  return 'research';
}

function isDiscoveryGraphTaskRow(record: Record<string, unknown>): boolean {
  const layer = record['layer'];
  if (typeof layer === 'number' && layer >= 2) return true;
  if (typeof layer === 'number' && layer <= 1) return false;
  const id = optionalText(record['id'])?.toLowerCase() ?? '';
  if (id.startsWith('partition-')) return false;
  return Boolean(id && optionalText(record['brief_path']));
}

/** Resolve mindmap output_type + node_kind for a discovery JSON task row. */
export function resolveDiscoveryTaskDraftFields(record: Record<string, unknown>): DiscoveryTaskDraftFields {
  const explicitRaw = record['task_kind']
    ?? record['workflow_kind']
    ?? record['task_type']
    ?? record['type'];
  const explicit = normalizeWorkflowTaskKind(explicitRaw);
  const discoveryRow = isDiscoveryGraphTaskRow(record);
  const enriched = explicit
    ? record
    : discoveryRow
      ? { ...record, task_kind: inferDiscoveryWorkflowKind(record) }
      : record;
  const workflow = resolveDraftFieldsFromWorkflow(enriched);
  const inferred = discoveryRow && !explicit
    ? normalizeWorkflowTaskKind(enriched['task_kind'])
    : undefined;
  const output_type = workflow.output_type
    ?? optionalText(record['output_type'])
    ?? (inferred ? workflowKindToTaskFields(inferred).output_type : 'research');
  return {
    output_type,
    node_kind: workflow.node_kind,
    lifecycle_phase: workflow.lifecycle_phase,
    workflow_kind: explicit ?? inferred,
    task_kind_explicit: Boolean(explicit),
  };
}

export function discoveryTaskKindContractLines(): string[] {
  return [
    '- **`task_kind`** (required): one of `code` | `critiquing` | `research` | `architect` | `brainstorming`',
    '  - **code** — implement, configure, migrate, inventory, CI/CD, most partition subgraph work',
    '  - **critiquing** — review upstream artifacts, spike/gate decisions, acceptance checks (mindmap diamond)',
    '  - **research** — only for pure discovery/spike read-only work with no implementation deliverable',
    '  You may set `output_type` + `node_kind` instead; `task_kind` is preferred.',
  ];
}
