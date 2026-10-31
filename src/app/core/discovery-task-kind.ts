import type { LifecyclePhase } from './models';
import type { TaskNodeKind } from './task-node-kind';
import {
  discoveryTaskTypeContractLines,
  normalizeTaskGraphType,
  parseResearchOutputMode,
  taskGraphTypeFromRecord,
  taskGraphTypeToMindmapFields,
  type ResearchOutputMode,
  type TaskGraphType,
} from './task-graph-type';
import { normalizeWorkflowTaskKind, type WorkflowTaskKind } from './workflow-task-kind';

export interface DiscoveryTaskDraftFields {
  output_type: string;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
  graph_type?: TaskGraphType;
  research_mode?: ResearchOutputMode;
  type_explicit: boolean;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Infer graph type when the agent omitted `type` (legacy JSON). */
export function inferDiscoveryGraphType(record: Record<string, unknown>): TaskGraphType {
  const title = optionalText(record['title'])?.toLowerCase() ?? '';
  if (/\b(critique|review|audit|verify|gate check)\b/.test(title)) {
    return 'critique';
  }
  const pattern = optionalText(record['pattern_id'])?.toLowerCase();
  if (pattern === 'critique-retry' || pattern === 'critique_retry_loop') {
    return 'critique';
  }
  const layer = record['layer'];
  if (typeof layer === 'number' && layer >= 2) {
    return 'code';
  }
  const id = optionalText(record['id'])?.toLowerCase() ?? '';
  if (id.startsWith('partition-')) {
    return 'research';
  }
  if (optionalText(record['brief_path']) && id) {
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

/** Resolve mindmap fields from canonical `type` (+ legacy aliases). */
export function resolveDiscoveryTaskDraftFields(record: Record<string, unknown>): DiscoveryTaskDraftFields {
  const explicit = taskGraphTypeFromRecord(record);
  const discoveryRow = isDiscoveryGraphTaskRow(record);
  const id = optionalText(record['id'])?.toLowerCase() ?? '';
  const partitionRow = id.startsWith('partition-') && Boolean(optionalText(record['brief_path']));
  const graphType = explicit ?? ((discoveryRow || partitionRow) ? inferDiscoveryGraphType(record) : undefined);
  const mapped = graphType ? taskGraphTypeToMindmapFields(graphType) : undefined;
  const output_type = mapped?.output_type
    ?? optionalText(record['output_type'])
    ?? 'research';
  let research_mode = graphType === 'research' ? parseResearchOutputMode(record) : undefined;
  if (graphType === 'research' && !research_mode) {
    const id = optionalText(record['id'])?.toLowerCase() ?? '';
    research_mode = id.startsWith('partition-') ? 'subgraph' : 'document';
  }
  const nodeKindOverride = record['node_kind'] !== undefined
    ? undefined
    : mapped?.node_kind;
  return {
    output_type,
    node_kind: nodeKindOverride ?? mapped?.node_kind,
    lifecycle_phase: mapped?.lifecycle_phase,
    graph_type: graphType,
    research_mode,
    type_explicit: Boolean(explicit),
  };
}

/** @deprecated use inferDiscoveryGraphType */
export function inferDiscoveryWorkflowKind(record: Record<string, unknown>): WorkflowTaskKind {
  const type = inferDiscoveryGraphType(record);
  if (type === 'code') return 'code';
  if (type === 'critique') return 'critiquing';
  return 'research';
}

export function discoveryTaskKindContractLines(): string[] {
  return discoveryTaskTypeContractLines();
}

export { normalizeTaskGraphType };
