import type { LifecyclePhase } from './models';
import type { TaskNodeKind } from './task-node-kind';
import {
  normalizeWorkflowTaskKind,
  workflowKindToTaskFields,
  type WorkflowTaskKind,
} from './workflow-task-kind';

/** Canonical discovery / generate-tasks type (prefer JSON field **`type`**). */
export const TASK_GRAPH_TYPES = ['research', 'code', 'critique'] as const;
export type TaskGraphType = (typeof TASK_GRAPH_TYPES)[number];

/** How a research task delivers value on the graph frontier. */
export const RESEARCH_OUTPUT_MODES = ['subgraph', 'document'] as const;
export type ResearchOutputMode = (typeof RESEARCH_OUTPUT_MODES)[number];

export interface TaskGraphTypeFields {
  graph_type: TaskGraphType;
  output_type: string;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
  research_mode?: ResearchOutputMode;
  type_explicit: boolean;
}

const GRAPH_TYPE_ALIASES: Record<string, TaskGraphType> = {
  research: 'research',
  data: 'research',
  discover: 'research',
  code: 'code',
  implement: 'code',
  critique: 'critique',
  critiquing: 'critique',
  critic: 'critique',
  decision: 'critique',
  review: 'critique',
  architect: 'research',
  architecture: 'research',
  brainstorming: 'research',
  brainstorm: 'research',
};

export function normalizeTaskGraphType(value: unknown): TaskGraphType | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const token = value.trim().toLowerCase();
  if ((TASK_GRAPH_TYPES as readonly string[]).includes(token)) {
    return token as TaskGraphType;
  }
  return GRAPH_TYPE_ALIASES[token];
}

/** Read canonical type from agent JSON (aliases consolidated here). */
export function taskGraphTypeFromRecord(record: Record<string, unknown>): TaskGraphType | undefined {
  const raw = record['type']
    ?? record['task_kind']
    ?? record['task_type']
    ?? record['workflow_kind'];
  const direct = normalizeTaskGraphType(raw);
  if (direct) return direct;
  const workflow = normalizeWorkflowTaskKind(raw);
  if (workflow === 'code') return 'code';
  if (workflow === 'critiquing') return 'critique';
  if (workflow === 'brainstorming' || workflow === 'research' || workflow === 'architect') return 'research';
  if (typeof record['output_type'] === 'string') {
    const out = record['output_type'].trim().toLowerCase();
    if (out === 'code') return 'code';
    if (record['node_kind'] !== undefined) {
      const node = String(record['node_kind']).trim().toLowerCase();
      if (node === 'critique') return 'critique';
    }
  }
  return undefined;
}

export function parseResearchOutputMode(record: Record<string, unknown>): ResearchOutputMode | undefined {
  const raw = record['research_mode'] ?? record['research_output'] ?? record['research_role'];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const token = raw.trim().toLowerCase();
  if (token === 'subgraph' || token === 'graph' || token === 'child_graph' || token === 'task_graph') {
    return 'subgraph';
  }
  if (token === 'document' || token === 'doc' || token === 'distillation' || token === 'summary') {
    return 'document';
  }
  return undefined;
}

export function taskGraphTypeToMindmapFields(type: TaskGraphType): {
  output_type: string;
  node_kind?: TaskNodeKind;
  lifecycle_phase?: LifecyclePhase;
} {
  switch (type) {
    case 'code':
      return workflowKindToTaskFields('code');
    case 'critique':
      return workflowKindToTaskFields('critiquing');
    case 'research':
    default:
      return workflowKindToTaskFields('research');
  }
}

export function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}

export function discoveryTaskTypeContractLines(): string[] {
  return [
    '- **`type`** (required): `research` | `code` | `critique` — canonical task graph type.',
    '  Aliases accepted: `task_kind`, `task_type` (legacy). Battleplan maps to mindmap `output_type` + `node_kind`.',
    '  - **research** — unknown frontier: explore options and/or produce planning artifacts.',
    '    - `research_mode`: `subgraph` (spawn/defer a child task graph after discovery) | `document` (distilled report/summary for downstream code/architecture).',
    '    - Use when uncertainty is high; collected data supports later planning and complements existing codebase context.',
    '  - **code** — implement or change the codebase; deliverables include a change summary and the agent branch with commits.',
    '  - **critique** — decision from inputs + codebase; list at least **two** named `outputs` (e.g. approve path vs rework path).',
    '    When acting as an **approval gate**, add a **cycle** edge (critique → upstream work) with `break_condition` (e.g. human:REVIEW).',
    '  Do not set conflicting `output_type`/`node_kind` unless you intend to override the mapping.',
  ];
}

export interface DiscoveryTaskTypeValidationIssue {
  path: string;
  message: string;
}

export function validateDiscoveryTaskDraft(
  draft: import('./models').TaskDraft,
  index: number,
): DiscoveryTaskTypeValidationIssue[] {
  const prefix = `tasks[${index}]`;
  const issues: DiscoveryTaskTypeValidationIssue[] = [];
  const isDiscovery = Boolean(draft.brief_path || draft.discovery_task_slug);
  if (!isDiscovery || !draft.graph_type) return issues;

  if (draft.graph_type === 'research' && draft.graph_type_explicit && !draft.research_mode) {
    issues.push({
      path: `${prefix}.research_mode`,
      message: 'Explicit research tasks must set research_mode to subgraph or document.',
    });
  }
  if (draft.graph_type === 'critique') {
    const outputs = draft.discovery_outputs ?? [];
    if (outputs.length < 2) {
      issues.push({
        path: `${prefix}.outputs`,
        message: 'Critique tasks need at least two named outputs (decision branches, e.g. proceed vs rework).',
      });
    }
  }
  return issues;
}

export function validateDiscoveryTaskTypeRow(
  record: Record<string, unknown>,
  index: number,
): DiscoveryTaskTypeValidationIssue[] {
  const prefix = `tasks[${index}]`;
  const issues: DiscoveryTaskTypeValidationIssue[] = [];
  const type = taskGraphTypeFromRecord(record);
  if (!type && isTypedDiscoveryRow(record)) {
    issues.push({
      path: `${prefix}.type`,
      message: 'Set type to research, code, or critique (preferred over output_type alone).',
    });
  }
  if (type === 'research') {
    const mode = parseResearchOutputMode(record);
    if (isTypedDiscoveryRow(record) && !mode) {
      issues.push({
        path: `${prefix}.research_mode`,
        message: 'Research tasks should set research_mode to subgraph or document.',
      });
    }
  }
  if (type === 'critique') {
    const outputs = parseStringList(record['outputs']);
    if (outputs.length < 2) {
      issues.push({
        path: `${prefix}.outputs`,
        message: 'Critique tasks need at least two named outputs (decision branches, e.g. proceed vs rework).',
      });
    }
  }
  if (type === 'code') {
    const outputs = parseStringList(record['outputs']);
    if (outputs.length > 0 && !outputs.some((name) => /summary|changelog|branch/i.test(name))) {
      // Soft nudge only when outputs present but none look like summary — skip hard fail to avoid noise
    }
  }
  return issues;
}

function isTypedDiscoveryRow(record: Record<string, unknown>): boolean {
  const layer = record['layer'];
  if (typeof layer === 'number' && layer >= 2) return true;
  const id = typeof record['id'] === 'string' ? record['id'].trim().toLowerCase() : '';
  if (id.startsWith('partition-')) return false;
  return Boolean(id && typeof record['brief_path'] === 'string' && record['brief_path'].trim());
}
