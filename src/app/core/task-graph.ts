import { normalChildIds, normalParentIds, siblingDependencyIds } from './dependencies';
import type { Project, ProjectTask } from './models';

/** Directed edge: `from` must complete before `to` can run (except cycle break rules). */
export const TASK_EDGE_KINDS = ['tree', 'ordering', 'fork', 'join', 'cycle'] as const;
export type TaskEdgeKind = (typeof TASK_EDGE_KINDS)[number];

export interface TaskGraphEdge {
  edge_id: string;
  from_task_id: string;
  to_task_id: string;
  kind: TaskEdgeKind;
  /** Required for `cycle` edges; optional guard for other kinds (e.g. max_iterations:3). */
  break_condition?: string;
}

export function edgeKey(from: string, to: string, kind: TaskEdgeKind): string {
  return `${kind}:${from}->${to}`;
}

export function rebuildGraphEdgesFromLegacy(tasks: ProjectTask[]): TaskGraphEdge[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const edges: TaskGraphEdge[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    for (const childId of normalChildIds(task, byId)) {
      const key = edgeKey(task.task_id, childId, 'tree');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        edge_id: key,
        from_task_id: task.task_id,
        to_task_id: childId,
        kind: 'tree',
      });
    }
    for (const siblingId of siblingDependencyIds(task)) {
      const key = edgeKey(siblingId, task.task_id, 'ordering');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        edge_id: key,
        from_task_id: siblingId,
        to_task_id: task.task_id,
        kind: 'ordering',
      });
    }
  }
  return edges;
}

export function applyGraphEdgesToLegacyFields(tasks: ProjectTask[], edges: TaskGraphEdge[]): ProjectTask[] {
  const copy = tasks.map((task) => ({
    ...task,
    dependencies: [] as string[],
    sibling_dependencies: [] as string[],
  }));
  const byId = new Map(copy.map((task) => [task.task_id, task]));
  for (const edge of edges) {
    if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
    if (edge.kind === 'tree') {
      const parent = byId.get(edge.from_task_id)!;
      parent.dependencies = [...new Set([...parent.dependencies, edge.to_task_id])];
      continue;
    }
    const dependent = byId.get(edge.to_task_id)!;
    if (edge.from_task_id === edge.to_task_id) continue;
    dependent.sibling_dependencies = [...new Set([...(dependent.sibling_dependencies ?? []), edge.from_task_id])];
  }
  return copy;
}

export function incomingEdges(taskId: string, edges: TaskGraphEdge[]): TaskGraphEdge[] {
  return edges.filter((edge) => edge.to_task_id === taskId);
}

export function prerequisiteTaskIds(taskId: string, edges: TaskGraphEdge[]): string[] {
  return [...new Set(incomingEdges(taskId, edges).map((edge) => edge.from_task_id))];
}

export function edgeBlocksExecution(from: ProjectTask, edge: TaskGraphEdge): boolean {
  if (from.status === 'DONE' || from.status === 'ABANDONED') return false;
  if (from.status === 'BLOCKED') return true;
  if (edge.kind === 'cycle' && edge.break_condition?.trim()) {
    if (from.handoff?.completed_at) return false;
    if (from.status === 'REVIEW') return false;
  }
  return true;
}

export function prerequisitesMet(
  task: ProjectTask,
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
  options?: { includeTree?: boolean },
): boolean {
  const includeTree = options?.includeTree !== false;
  const byId = new Map(tasks.map((item) => [item.task_id, item]));
  for (const edge of incomingEdges(task.task_id, edges)) {
    if (!includeTree && edge.kind === 'tree') continue;
    const from = byId.get(edge.from_task_id);
    if (!from) continue;
    if (edgeBlocksExecution(from, edge)) return false;
  }
  return true;
}

export function validateTaskGraphEdges(edges: TaskGraphEdge[], taskIds: Set<string>): void {
  for (const edge of edges) {
    if (!taskIds.has(edge.from_task_id) || !taskIds.has(edge.to_task_id)) {
      throw new Error('Graph edge references an unknown task.');
    }
    if (edge.from_task_id === edge.to_task_id) {
      throw new Error('Graph edge cannot connect a task to itself.');
    }
    if (edge.kind === 'cycle' && !edge.break_condition?.trim()) {
      throw new Error('Cycle edges require a break_condition.');
    }
  }
  const cycles = directedCycleEdgeSets(edges);
  for (const cycleEdges of cycles) {
    const allHaveBreak = cycleEdges.every((edge) => Boolean(edge.break_condition?.trim()));
    if (!allHaveBreak) {
      throw new Error('Every edge in a dependency cycle must declare a break_condition.');
    }
  }
}

function directedCycleEdgeSets(edges: TaskGraphEdge[]): TaskGraphEdge[][] {
  const adj = new Map<string, TaskGraphEdge[]>();
  for (const edge of edges) {
    const list = adj.get(edge.from_task_id) ?? [];
    list.push(edge);
    adj.set(edge.from_task_id, list);
  }
  const cycles: TaskGraphEdge[][] = [];
  const stack: TaskGraphEdge[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (node: string): void => {
    visiting.add(node);
    for (const edge of adj.get(node) ?? []) {
      const next = edge.to_task_id;
      if (visiting.has(next)) {
        const start = stack.findIndex((item) => item.from_task_id === next);
        if (start >= 0) cycles.push(stack.slice(start).concat(edge));
        continue;
      }
      if (visited.has(next)) continue;
      stack.push(edge);
      dfs(next);
      stack.pop();
    }
    visiting.delete(node);
    visited.add(node);
  };

  for (const edge of edges) {
    if (!visited.has(edge.from_task_id)) dfs(edge.from_task_id);
  }
  return cycles;
}

export function ensureProjectTaskGraph(project: Project, tasks: ProjectTask[]): TaskGraphEdge[] {
  if (project.task_graph_edges?.length) return project.task_graph_edges;
  return rebuildGraphEdgesFromLegacy(tasks);
}

export function mnemosyneDefaultRelativePath(projectId: string): string {
  return `mnemosyne/${projectId}`;
}

export function resolveMnemosyneBasePath(project: Project, projectDataDir?: string): string {
  const configured = project.mnemosyne_base_path?.trim();
  if (configured) {
    if (projectDataDir && !configured.startsWith('/') && !/^[A-Za-z]:/.test(configured)) {
      return `${projectDataDir}/${configured}`.replace(/\/+/g, '/');
    }
    return configured;
  }
  const relative = mnemosyneDefaultRelativePath(project.project_id);
  return projectDataDir ? `${projectDataDir}/${relative}`.replace(/\/+/g, '/') : relative;
}

export function seedProjectGraphDefaults(project: Project): boolean {
  let changed = false;
  if (!project.mnemosyne_base_path?.trim()) {
    project.mnemosyne_base_path = mnemosyneDefaultRelativePath(project.project_id);
    changed = true;
  }
  return changed;
}

export function validateAndApplyGraph(project: Project, tasks: ProjectTask[]): ProjectTask[] {
  const edges = project.task_graph_edges?.length
    ? project.task_graph_edges
    : rebuildGraphEdgesFromLegacy(tasks);
  const taskIds = new Set(tasks.map((task) => task.task_id));
  validateTaskGraphEdges(edges, taskIds);
  project.task_graph_edges = edges;
  return applyGraphEdgesToLegacyFields(tasks, edges);
}
