import type { LifecyclePhase, OutputType } from './models';
import type { TaskNodeKind } from './task-node-kind';
import { normalizeTaskNodeKind } from './task-node-kind';

/** Workflow stencil kinds for Generate Tasks (mindmap shapes). */
export const WORKFLOW_TASK_KINDS = [
  'brainstorming',
  'research',
  'critiquing',
  'code',
  'architect',
] as const;

export type WorkflowTaskKind = (typeof WORKFLOW_TASK_KINDS)[number];

export interface WorkflowKindMapping {
  output_type: OutputType;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
}

const WORKFLOW_ALIASES: Record<string, WorkflowTaskKind> = {
  brainstorming: 'brainstorming',
  brainstorm: 'brainstorming',
  cloud: 'brainstorming',
  research: 'research',
  data: 'research',
  critiquing: 'critiquing',
  critique: 'critiquing',
  critic: 'critiquing',
  decision: 'critiquing',
  code: 'code',
  architect: 'architect',
  architecture: 'architect',
  process: 'architect',
};

export function normalizeWorkflowTaskKind(value: unknown): WorkflowTaskKind | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase();
  if ((WORKFLOW_TASK_KINDS as readonly string[]).includes(token)) {
    return token as WorkflowTaskKind;
  }
  return WORKFLOW_ALIASES[token];
}

/** Maps a workflow stencil kind to Battleplan task fields. */
export function workflowKindToTaskFields(kind: WorkflowTaskKind): WorkflowKindMapping {
  switch (kind) {
    case 'brainstorming':
      return { output_type: 'research', node_kind: 'brainstorm', lifecycle_phase: 'discover' };
    case 'research':
      return { output_type: 'research', node_kind: 'work', lifecycle_phase: 'discover' };
    case 'critiquing':
      return { output_type: 'research', node_kind: 'decision', lifecycle_phase: 'verify' };
    case 'code':
      return { output_type: 'code', node_kind: 'work', lifecycle_phase: 'build' };
    case 'architect':
      return { output_type: 'research', node_kind: 'architect', lifecycle_phase: 'architect' };
    default:
      return { output_type: 'code', node_kind: 'work' };
  }
}

/** Apply task_kind / workflow_kind when output_type or node_kind omitted. */
export function resolveDraftFieldsFromWorkflow(record: Record<string, unknown>): {
  output_type?: string;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
} {
  const raw = record['task_kind'] ?? record['workflow_kind'] ?? record['kind'];
  const workflow = normalizeWorkflowTaskKind(raw);
  if (!workflow) {
    return {
      node_kind: record['node_kind'] !== undefined ? normalizeTaskNodeKind(record['node_kind']) : undefined,
    };
  }
  const mapped = workflowKindToTaskFields(workflow);
  const output = typeof record['output_type'] === 'string' && record['output_type'].trim()
    ? record['output_type'].trim()
    : mapped.output_type;
  const nodeKind = record['node_kind'] !== undefined
    ? normalizeTaskNodeKind(record['node_kind'])
    : mapped.node_kind;
  return {
    output_type: output,
    node_kind: nodeKind,
    lifecycle_phase: mapped.lifecycle_phase,
  };
}
