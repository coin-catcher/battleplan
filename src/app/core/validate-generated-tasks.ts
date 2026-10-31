import {
  bindDraftDependsOn,
  bindSequentialDraftLinks,
  linkCreatedTasksUnderParent,
} from './generate-task-links';
import {
  buildGraphEdgesFromDrafts,
  mergeGraphAfterGenerateTasksImport,
  type GeneratedTaskEdgeDraft,
} from './generate-task-graph';
import type { ParsedGeneratedTasks } from './parse-tasks';
import type { ProjectTask, TaskDraft } from './models';
import { rebuildGraphEdgesFromLegacy, validateTaskGraphEdges } from './task-graph';
import { validateTaskBrief } from './task-brief';
import { validateDiscoveryTaskCollateral } from './discovery-task-schema';
import { validateCritiqueRetryEdges } from './task-patterns';

export interface GeneratedTasksValidationIssue {
  path: string;
  message: string;
}

export interface GeneratedTasksValidationResult {
  valid: boolean;
  issues: GeneratedTasksValidationIssue[];
  payload: ParsedGeneratedTasks;
  summary: string;
  repaired: boolean;
}

const DEFAULT_CYCLE_BREAK = 'human:REVIEW';

function skeletonTask(taskId: string, projectId: string, draft: TaskDraft, order: number): ProjectTask {
  return {
    task_id: taskId,
    project_id: projectId,
    title: draft.title,
    prompt: '',
    dependencies: [],
    sibling_dependencies: [],
    status: 'TODO',
    output_type: draft.output_type as ProjectTask['output_type'],
    order,
    created_at: '',
    updated_at: '',
  };
}

/** Preview graph wiring for a Generate Tasks payload (no persistence). */
export function previewGraphForGeneratedTasks(
  drafts: TaskDraft[],
  edgeDrafts: GeneratedTaskEdgeDraft[],
  existing: ProjectTask[],
  parentTaskId?: string,
): { edges: import('./task-graph').TaskGraphEdge[]; taskIds: Set<string> } {
  const projectId = existing[0]?.project_id ?? 'preview-project';
  const created = drafts.map((draft, index) => skeletonTask(`gen-${index}`, projectId, draft, index));
  const draftCopies = drafts.map((draft) => ({
    depends_on: [...(draft.depends_on ?? [])],
    sequential_with: [...(draft.sequential_with ?? [])],
  }));
  bindDraftDependsOn(existing, created, draftCopies);
  bindSequentialDraftLinks(existing, created, draftCopies);
  if (parentTaskId) {
    linkCreatedTasksUnderParent(existing, created, parentTaskId);
  }
  const all = [...existing, ...created];
  const legacy = rebuildGraphEdgesFromLegacy(all);
  const advanced = edgeDrafts.length ? buildGraphEdgesFromDrafts(existing, created, edgeDrafts) : [];
  const edges = edgeDrafts.length
    ? mergeGraphAfterGenerateTasksImport(legacy, advanced)
    : legacy;
  return { edges, taskIds: new Set(all.map((task) => task.task_id)) };
}

function repairCycleBreakConditions(input: GeneratedTaskEdgeDraft[]): {
  edges: GeneratedTaskEdgeDraft[];
  changed: boolean;
} {
  let changed = false;
  const edges = input.map((edge) => {
    if (edge.kind !== 'cycle') return edge;
    if (edge.break_condition?.trim()) return edge;
    changed = true;
    return { ...edge, break_condition: DEFAULT_CYCLE_BREAK };
  });
  return { edges, changed };
}

export function validateAndRepairGeneratedTasks(
  parsed: ParsedGeneratedTasks,
  options?: {
    existingTasks?: ProjectTask[];
    parentTaskId?: string;
    requireCompleteBrief?: boolean;
    projectId?: string;
  },
): GeneratedTasksValidationResult {
  const issues: GeneratedTasksValidationIssue[] = [];
  const existing = options?.existingTasks ?? [];
  const parentTaskId = options?.parentTaskId;

  if (!parsed.tasks.length) {
    issues.push({ path: 'tasks', message: 'Task list is empty.' });
  }

  parsed.tasks.forEach((draft, index) => {
    const prefix = `tasks[${index}]`;
    if (!draft.title?.trim()) issues.push({ path: `${prefix}.title`, message: 'title is required.' });
    if (!draft.prompt?.trim()) issues.push({ path: `${prefix}.prompt`, message: 'prompt is required.' });
    if (options?.requireCompleteBrief !== false && draft.brief) {
      for (const item of validateTaskBrief(draft.brief)) {
        issues.push({ path: `${prefix}.brief.${item.field}`, message: item.message });
      }
    }
    if (options?.projectId && (draft.brief_path || draft.discovery_task_slug || draft.git_paths?.length)) {
      issues.push(...validateDiscoveryTaskCollateral(options.projectId, draft, index));
    }
  });

  let edgeDrafts = [...parsed.edges];
  let repaired = false;
  const cycleRepair = repairCycleBreakConditions(edgeDrafts);
  if (cycleRepair.changed) {
    edgeDrafts = cycleRepair.edges;
    repaired = true;
  }

  const critiqueTitles = parsed.tasks
    .filter((d) => d.node_kind === 'critique')
    .map((d) => d.title.trim())
    .filter(Boolean);
  for (const item of validateCritiqueRetryEdges(critiqueTitles, edgeDrafts)) {
    issues.push(item);
  }
  parsed.tasks.forEach((draft, index) => {
    if (draft.cross_graph_edit && !draft.cross_graph_edit_rationale?.trim()) {
      issues.push({
        path: `tasks[${index}].cross_graph_edit_rationale`,
        message: 'cross_graph_edit_rationale is required when cross_graph_edit is true.',
      });
    }
  });

  if (issues.length === 0) {
    try {
      const { edges, taskIds } = previewGraphForGeneratedTasks(parsed.tasks, edgeDrafts, existing, parentTaskId);
      validateTaskGraphEdges(edges, taskIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Graph validation failed.';
      issues.push({ path: 'edges', message });
    }
  }

  const valid = issues.length === 0;
  const summary = valid
    ? 'Generate Tasks JSON is valid.'
    : issues.map((item) => `${item.path}: ${item.message}`).join('\n');

  return {
    valid,
    issues,
    payload: { tasks: parsed.tasks, edges: edgeDrafts },
    summary,
    repaired,
  };
}

export function buildGenerateTasksRepairUserMessage(issues: GeneratedTasksValidationIssue[]): string {
  const lines = issues.map((item) => `- ${item.path}: ${item.message}`);
  return [
    'The Generate Tasks JSON failed Battleplan validation before any tasks were created.',
    'Return ONLY a corrected JSON object: { "tasks": [ ... ], "edges": [ ... ] } with no markdown or commentary.',
    '',
    'Fix every issue below:',
    ...lines,
    '',
    'Graph rules:',
    '- Intentional rework loops must use edge kind "cycle" (alias "loop") with break_condition (e.g. human:REVIEW).',
    '- Do not create accidental cycles using only tree, ordering, fork, or join edges.',
    '- Every task needs title, prompt, and a complete brief (all pstack fields) unless discovery brief_path is used.',
    '- Discovery: each task needs stable id, brief_path = battleplan/projects/{project_id}/tasks/{id}/outputs/brief.md, and matching git_paths.',
  ].join('\n');
}

/** Throws with a user-facing message if the payload cannot be imported. */
export function assertGeneratedTasksReady(result: GeneratedTasksValidationResult): void {
  if (!result.valid) throw new Error(result.summary);
}
