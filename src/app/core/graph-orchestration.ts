import { descendantTaskIds } from './execute-children';
import { independentBatch } from './execute-children';
import type { ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import { edgeBlocksExecution, incomingEdges, outgoingEdges, prerequisitesMet } from './task-graph';
import { isDispatchableNodeKind } from './task-node-kind';

export const GRAPH_ORCHESTRATION_STATUSES = [
  'idle',
  'running',
  'paused',
  'stopped',
  'completed',
] as const;
export type GraphOrchestrationRunStatus = (typeof GRAPH_ORCHESTRATION_STATUSES)[number];

export const GRAPH_ORCHESTRATION_TRANSITION_KINDS = [
  'start',
  'dispatch',
  'complete',
  'pause_task',
  'resume_task',
  'pause_run',
  'resume_run',
  'stop',
  'recover',
  'finish',
] as const;
export type GraphOrchestrationTransitionKind = (typeof GRAPH_ORCHESTRATION_TRANSITION_KINDS)[number];

export interface GraphOrchestrationAgentRun {
  task_id: string;
  cursor_agent_id?: string;
  backend_run_id?: string;
  dispatched_at: string;
}

export interface GraphOrchestrationTransition {
  transition_id: string;
  from_task_id: string | null;
  to_task_id: string | null;
  at: string;
  kind: GraphOrchestrationTransitionKind;
  detail?: string;
}

/** Persisted on `Project` while a task graph executes under Battleplan control. */
export interface GraphOrchestrationRunState {
  run_id: string;
  /** When set, only this task and its descendants participate in the run. */
  root_task_id?: string;
  /** When true with `root_task_id`, scope is descendants only (root is not dispatched). */
  descendants_only?: boolean;
  status: GraphOrchestrationRunStatus;
  started_at: string;
  updated_at: string;
  /** Tasks excluded from dispatch for this run (orchestrator "pause"). */
  paused_task_ids: string[];
  /** Tasks currently in flight (DOING / REVIEW with an agent run). */
  active_task_ids: string[];
  last_agent_runs: GraphOrchestrationAgentRun[];
  transitions: GraphOrchestrationTransition[];
}

export function orchestrationScopeTaskIds(
  rootTaskId: string | undefined,
  tasks: ProjectTask[],
  options?: { descendantsOnly?: boolean },
): Set<string> {
  if (!rootTaskId) return new Set(tasks.map((task) => task.task_id));
  const scoped = new Set(descendantTaskIds(rootTaskId, tasks));
  if (!options?.descendantsOnly) scoped.add(rootTaskId);
  return scoped;
}

export function orchestrationScopeForRun(
  run: GraphOrchestrationRunState,
  tasks: ProjectTask[],
): Set<string> {
  return orchestrationScopeTaskIds(run.root_task_id, tasks, {
    descendantsOnly: run.descendants_only,
  });
}

export function tasksInOrchestrationScope(
  tasks: ProjectTask[],
  scope: Set<string>,
): ProjectTask[] {
  return tasks.filter((task) => scope.has(task.task_id));
}

export function isTaskPausedByOrchestration(
  taskId: string,
  run: GraphOrchestrationRunState | undefined,
): boolean {
  return Boolean(run?.paused_task_ids.includes(taskId));
}

export function prerequisitesMetForOrchestration(
  task: ProjectTask,
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  run: GraphOrchestrationRunState,
): boolean {
  const byId = new Map(tasks.map((item) => [item.task_id, item]));
  for (const edge of incomingEdges(task.task_id, edges)) {
    if (run.descendants_only && run.root_task_id
      && edge.kind === 'tree' && edge.from_task_id === run.root_task_id) {
      continue;
    }
    const from = byId.get(edge.from_task_id);
    if (!from) continue;
    if (edgeBlocksExecution(from, edge)) return false;
  }
  return true;
}

export function isOrchestrationDispatchCandidate(
  task: ProjectTask,
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  run: GraphOrchestrationRunState,
): boolean {
  if (task.status === 'BLOCKED') return false;
  if (task.status !== 'TODO') return false;
  if (task.output_type === 'subproject') return false;
  if (!isDispatchableNodeKind(task.node_kind)) return false;
  if (task.cursor_agent_id) return false;
  if (!prerequisitesMetForOrchestration(task, tasks, edges, run)) return false;
  return true;
}

export function orchestrationDispatchBatch(
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  run: GraphOrchestrationRunState,
): ProjectTask[] {
  const scope = orchestrationScopeForRun(run, tasks);
  const scopedTasks = tasksInOrchestrationScope(tasks, scope);
  const ready = scopedTasks.filter(
    (task) => isOrchestrationDispatchCandidate(task, tasks, edges, run)
      && !run.paused_task_ids.includes(task.task_id),
  );
  return independentBatch(ready, tasks);
}

export function terminalTaskIds(
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  scope: Set<string>,
): string[] {
  const terminals: string[] = [];
  for (const taskId of scope) {
    const outgoing = outgoingEdges(taskId, edges).filter((edge) => scope.has(edge.to_task_id));
    if (outgoing.length === 0) terminals.push(taskId);
  }
  return terminals;
}

export function isOrchestrationRunComplete(
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  run: GraphOrchestrationRunState,
): boolean {
  if (run.status === 'stopped' || run.status === 'completed') return true;
  const scope = orchestrationScopeForRun(run, tasks);
  const scoped = tasksInOrchestrationScope(tasks, scope);
  const inFlight = scoped.some(
    (task) => (task.status === 'DOING' || task.status === 'REVIEW') && !run.paused_task_ids.includes(task.task_id),
  );
  if (inFlight) return false;
  return scoped.every((task) => {
    if (run.paused_task_ids.includes(task.task_id)) return true;
    return task.status === 'DONE' || task.status === 'ABANDONED';
  });
}

/** Topological waves of tasks that could run when all upstream work is DONE (planning preview). */
export function planExecutionWaves(
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  scope: Set<string>,
  pausedTaskIds: Set<string>,
): string[][] {
  const scopedIds = [...scope];
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const remaining = new Set(
    scopedIds.filter((id) => {
      const task = byId.get(id);
      if (!task) return false;
      if (pausedTaskIds.has(id)) return false;
      return task.status !== 'DONE' && task.status !== 'ABANDONED';
    }),
  );
  const waves: string[][] = [];
  const simulatedDone = new Set(
    scopedIds.filter((id) => {
      const task = byId.get(id);
      return task?.status === 'DONE' || task?.status === 'ABANDONED';
    }),
  );
  let guard = 0;
  while (remaining.size > 0 && guard < scopedIds.length + 2) {
    guard += 1;
    const wave: string[] = [];
    for (const taskId of remaining) {
      const task = byId.get(taskId);
      if (!task) continue;
      const snapshot = tasks.map((item) => (
        simulatedDone.has(item.task_id) ? { ...item, status: 'DONE' as const } : item
      ));
      const simulated = snapshot.find((item) => item.task_id === taskId) ?? task;
      if (!prerequisitesMet(simulated, snapshot, edges, { includeTree: true })) continue;
      wave.push(taskId);
    }
    if (wave.length === 0) break;
    for (const taskId of wave) {
      remaining.delete(taskId);
      simulatedDone.add(taskId);
    }
    waves.push(wave);
  }
  return waves;
}

export function reconcileRunningTasks(
  tasks: ProjectTask[],
  run: GraphOrchestrationRunState,
): GraphOrchestrationRunState {
  const scope = orchestrationScopeForRun(run, tasks);
  const active_task_ids = tasks
    .filter((task) => scope.has(task.task_id)
      && (task.status === 'DOING' || task.status === 'REVIEW')
      && Boolean(task.cursor_agent_id || task.backend_run_id))
    .map((task) => task.task_id);

  const previousByTask = new Map(run.last_agent_runs.map((item) => [item.task_id, item]));
  const last_agent_runs: GraphOrchestrationAgentRun[] = tasks
    .filter((task) => scope.has(task.task_id) && (task.cursor_agent_id || task.backend_run_id))
    .map((task) => ({
      task_id: task.task_id,
      cursor_agent_id: task.cursor_agent_id,
      backend_run_id: task.backend_run_id,
      dispatched_at: previousByTask.get(task.task_id)?.dispatched_at ?? run.updated_at,
    }));

  return {
    ...run,
    active_task_ids,
    last_agent_runs,
  };
}

export function appendOrchestrationTransition(
  run: GraphOrchestrationRunState,
  kind: GraphOrchestrationTransitionKind,
  options?: {
    from_task_id?: string | null;
    to_task_id?: string | null;
    detail?: string;
    transition_id?: string;
    at?: string;
  },
): GraphOrchestrationRunState {
  const at = options?.at ?? new Date().toISOString();
  const transition: GraphOrchestrationTransition = {
    transition_id: options?.transition_id ?? `tr-${run.transitions.length + 1}`,
    from_task_id: options?.from_task_id ?? null,
    to_task_id: options?.to_task_id ?? null,
    at,
    kind,
    detail: options?.detail,
  };
  const transitions = [...run.transitions, transition];
  return {
    ...run,
    transitions: transitions.length > 500 ? transitions.slice(-500) : transitions,
    updated_at: at,
  };
}

export function newGraphOrchestrationRun(
  rootTaskId: string | undefined,
  runId: string,
  at: string,
  options?: { descendantsOnly?: boolean },
): GraphOrchestrationRunState {
  let run: GraphOrchestrationRunState = {
    run_id: runId,
    root_task_id: rootTaskId,
    descendants_only: options?.descendantsOnly,
    status: 'running',
    started_at: at,
    updated_at: at,
    paused_task_ids: [],
    active_task_ids: [],
    last_agent_runs: [],
    transitions: [],
  };
  run = appendOrchestrationTransition(run, 'start', {
    detail: rootTaskId ? `root ${rootTaskId}` : 'project graph',
    at,
  });
  return run;
}

export function isOrchestrationRunActive(run: GraphOrchestrationRunState | undefined): boolean {
  return run?.status === 'running' || run?.status === 'paused';
}

export function orchestrationRunLabel(run: GraphOrchestrationRunState | undefined): string | null {
  if (!run || run.status === 'idle') return null;
  const scope = run.root_task_id ? `subtree ${run.root_task_id}` : 'project graph';
  return `${run.status} · ${scope}`;
}
