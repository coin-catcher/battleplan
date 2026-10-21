import type { OutputType, TaskDraft } from './models';
import type { TaskBrief } from './task-brief';
import { normalizeTaskBrief } from './task-brief';
import type { LoopMode, TaskNodeKind } from './task-node-kind';
import { normalizeLoopMode, normalizeTaskNodeKind } from './task-node-kind';

/** Proposed plan-graph change before human accept/reject (graph-delta pipeline). */
export type GraphDeltaSource =
  | 'generate_tasks'
  | 'grill_session'
  | 'hermes_decomposer'
  | 'import_tickets'
  | 'import_units'
  | 'runtime_proposal'
  | 'manual';

export type GraphDeltaOp =
  | { op: 'add_node'; temp_id: string; draft: GraphDeltaNodeDraft }
  | { op: 'add_edge'; from: string; to: string; edge_kind: GraphEdgeKind }
  | { op: 'patch_node'; task_id: string; patch: GraphDeltaNodePatch }
  | { op: 'resolve_decision'; task_id: string; resolution: string }
  | { op: 'graduate_fog'; temp_id: string; draft: GraphDeltaNodeDraft };

export const GRAPH_EDGE_KINDS = ['tree', 'ordering', 'data_flow', 'serialization', 'stack'] as const;
export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export interface GraphDeltaNodeDraft {
  title: string;
  prompt: string;
  output_type: OutputType | string;
  depends_on?: string[];
  sequential_with?: string[];
  node_kind?: TaskNodeKind;
  loop_mode?: LoopMode;
  brief?: TaskBrief;
}

export interface GraphDeltaNodePatch {
  title?: string;
  prompt?: string;
  brief?: TaskBrief;
  node_kind?: TaskNodeKind;
  loop_mode?: LoopMode;
}

export interface GraphDeltaProposal {
  proposal_id: string;
  source: GraphDeltaSource;
  created_at: string;
  ops: GraphDeltaOp[];
}

export interface GraphDeltaValidationIssue {
  path: string;
  message: string;
}

export function graphDeltaFromTaskDrafts(drafts: TaskDraft[], source: GraphDeltaSource = 'generate_tasks'): GraphDeltaProposal {
  const ops: GraphDeltaOp[] = drafts.map((draft, index) => ({
    op: 'add_node',
    temp_id: `draft-${index + 1}`,
    draft: {
      title: draft.title,
      prompt: draft.prompt,
      output_type: draft.output_type,
      depends_on: draft.depends_on,
      sequential_with: draft.sequential_with,
      node_kind: draft.node_kind,
      loop_mode: draft.loop_mode,
      brief: draft.brief,
    },
  }));
  return {
    proposal_id: `proposal-${source}`,
    source,
    created_at: new Date().toISOString(),
    ops,
  };
}

export function validateGraphDeltaProposal(proposal: GraphDeltaProposal): GraphDeltaValidationIssue[] {
  const issues: GraphDeltaValidationIssue[] = [];
  if (!proposal.ops.length) {
    issues.push({ path: 'ops', message: 'Proposal must include at least one operation.' });
  }
  proposal.ops.forEach((op, index) => {
    const prefix = `ops[${index}]`;
    if (op.op === 'add_node' || op.op === 'graduate_fog') {
      if (!op.draft.title?.trim()) issues.push({ path: `${prefix}.draft.title`, message: 'title is required.' });
      if (!op.draft.prompt?.trim()) issues.push({ path: `${prefix}.draft.prompt`, message: 'prompt is required.' });
    }
    if (op.op === 'add_edge') {
      if (!op.from?.trim() || !op.to?.trim()) {
        issues.push({ path: prefix, message: 'add_edge requires from and to.' });
      }
      if (op.from === op.to) {
        issues.push({ path: prefix, message: 'add_edge cannot self-loop.' });
      }
    }
    if (op.op === 'patch_node' && !op.task_id?.trim()) {
      issues.push({ path: prefix, message: 'patch_node requires task_id.' });
    }
  });
  return issues;
}

export function parseGraphDeltaNodeDraft(record: Record<string, unknown>): GraphDeltaNodeDraft {
  const title = requiredString(record['title'], 'title');
  const prompt = requiredString(record['prompt'], 'prompt');
  const output = requiredString(record['output_type'], 'output_type');
  const depends = stringArray(record['depends_on'] ?? record['dependencies']);
  const sequential = stringArray(
    record['sequential_with'] ?? record['sibling_dependencies'] ?? record['conflicts_with'],
  );
  return {
    title,
    prompt,
    output_type: output,
    depends_on: depends,
    sequential_with: sequential,
    node_kind: record['node_kind'] !== undefined ? normalizeTaskNodeKind(record['node_kind']) : undefined,
    loop_mode: normalizeLoopMode(record['loop_mode']),
    brief: normalizeTaskBrief(record['brief']) ?? undefined,
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean);
}
