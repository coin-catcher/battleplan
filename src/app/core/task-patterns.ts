import type { GeneratedTaskEdgeDraft } from './generate-task-graph';

export const TASK_GRAPH_PATTERNS = [
  'critique_retry_loop',
  'leaf_fan_in_refactor',
  'template_instance_cycle',
  'task_templates',
  'spike_gate',
  'parallel_fan_out_in',
  'subproject_boundary',
  'dynamic_deterministic_converter',
] as const;

export type TaskGraphPatternId = (typeof TASK_GRAPH_PATTERNS)[number];

export interface PatternValidationIssue {
  path: string;
  message: string;
}

/** Validate edges for critique-retry: critique nodes should participate in a cycle with break_condition. */
export function validateCritiqueRetryEdges(
  critiqueTitles: string[],
  edges: GeneratedTaskEdgeDraft[],
): PatternValidationIssue[] {
  const issues: PatternValidationIssue[] = [];
  for (const title of critiqueTitles) {
    const back = edges.filter((e) => e.to === title || e.from === title);
    const hasCycle = back.some((e) => e.kind === 'cycle' || e.kind === 'loop');
    if (!hasCycle) {
      issues.push({
        path: `pattern:critique_retry_loop:${title}`,
        message: `Critique task "${title}" should have a cycle edge (critique → work) with break_condition.`,
      });
    }
  }
  return issues;
}
