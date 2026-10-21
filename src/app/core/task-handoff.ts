/** Standard payload when a task completes (Round 2 Q2 — cross local/cloud handoff). */
export interface TaskHandoff {
  summary: string;
  metadata: Record<string, unknown>;
  branch?: string;
  head_sha?: string;
  artifacts: string[];
  memory_pointer_ids: string[];
  completed_at: string;
}

export function emptyTaskHandoff(completedAt: string): TaskHandoff {
  return {
    summary: '',
    metadata: {},
    artifacts: [],
    memory_pointer_ids: [],
    completed_at: completedAt,
  };
}

export interface TaskHandoffBuildInput {
  summary?: string;
  branch?: string;
  headSha?: string;
  artifacts?: string[];
  memoryPointerIds?: string[];
  metadata?: Record<string, unknown>;
  completedAt: string;
}

export function buildTaskHandoff(input: TaskHandoffBuildInput): TaskHandoff {
  return {
    summary: input.summary?.trim() || 'Task completed.',
    metadata: input.metadata ?? {},
    branch: input.branch?.trim() || undefined,
    head_sha: input.headSha?.trim() || undefined,
    artifacts: [...(input.artifacts ?? [])],
    memory_pointer_ids: [...(input.memoryPointerIds ?? [])],
    completed_at: input.completedAt,
  };
}
