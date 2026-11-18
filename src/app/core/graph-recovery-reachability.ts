import { rootTaskIds } from './dependencies';
import type { ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';

const STRUCTURAL_KINDS = new Set<TaskGraphEdge['kind']>(['tree', 'fork', 'join']);

function incomingStructural(
  taskId: string,
  pool: TaskGraphEdge[],
): TaskGraphEdge[] {
  return pool.filter(
    (edge) => edge.to_task_id === taskId && STRUCTURAL_KINDS.has(edge.kind),
  );
}

/** Task attaches to the project node when it is a root (no structural parent in the full task set). */
export function isProjectRootTask(taskId: string, tasks: ProjectTask[]): boolean {
  return rootTaskIds(tasks).includes(taskId);
}

/** Subproject roots may attach via parent_project_id (already on project graph). */
export function isSubprojectTask(task: ProjectTask): boolean {
  return task.output_type === 'subproject';
}

/**
 * Whether `taskId` can appear on the mindmap: a project/subproject root, or structurally
 * linked to an already-revealed upstream task / confirmed edge.
 */
export function canRevealTaskOnMindmap(
  taskId: string,
  tasks: ProjectTask[],
  pool: TaskGraphEdge[],
  revealed: Set<string>,
  confirmed: TaskGraphEdge[],
): boolean {
  const task = tasks.find((item) => item.task_id === taskId);
  if (!task) return false;
  if (isProjectRootTask(taskId, tasks) || isSubprojectTask(task)) return true;

  for (const edge of [...confirmed, ...pool]) {
    if (!STRUCTURAL_KINDS.has(edge.kind)) continue;
    if (edge.to_task_id !== taskId) continue;
    if (revealed.has(edge.from_task_id)) return true;
  }

  const legacyParent = tasks.find((candidate) => candidate.dependencies.includes(taskId));
  if (legacyParent && revealed.has(legacyParent.task_id)) {
    return true;
  }

  return false;
}

/**
 * Split on-disk tasks into the project-connected component vs orphans that cannot reach a root.
 */
export function partitionTasksForRecovery(
  tasks: ProjectTask[],
  pool: TaskGraphEdge[],
): { connected: string[]; orphaned: string[] } {
  const byId = new Set(tasks.map((task) => task.task_id));
  const roots = tasks
    .filter((task) => isProjectRootTask(task.task_id, tasks) || isSubprojectTask(task))
    .map((task) => task.task_id);
  const anchorRoots = roots.filter((rootId) => {
    const task = tasks.find((item) => item.task_id === rootId);
    if (!task) return false;
    if (isSubprojectTask(task)) return true;
    const hasStructural = pool.some(
      (edge) => STRUCTURAL_KINDS.has(edge.kind)
        && (edge.from_task_id === rootId || edge.to_task_id === rootId),
    );
    const hasChildren = task.dependencies.length > 0;
    return hasStructural || hasChildren;
  });
  const startRoots = anchorRoots.length > 0 ? anchorRoots : roots;
  const reachable = new Set<string>(startRoots);
  const queue = [...startRoots];

  const visit = (id: string): void => {
    for (const edge of pool) {
      if (!STRUCTURAL_KINDS.has(edge.kind)) continue;
      if (!byId.has(edge.from_task_id) || !byId.has(edge.to_task_id)) continue;
      const neighbors: string[] = [];
      if (edge.from_task_id === id) neighbors.push(edge.to_task_id);
      if (edge.to_task_id === id) neighbors.push(edge.from_task_id);
      for (const neighbor of neighbors) {
        if (reachable.has(neighbor)) continue;
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
    for (const task of tasks) {
      if (!reachable.has(task.task_id)) continue;
      for (const childId of task.dependencies) {
        if (!byId.has(childId)) continue;
        if (!reachable.has(childId)) {
          reachable.add(childId);
          queue.push(childId);
        }
      }
    }
  };

  while (queue.length > 0) {
    const id = queue.shift()!;
    visit(id);
  }

  const connected = tasks.filter((task) => reachable.has(task.task_id)).map((task) => task.task_id);
  const orphaned = tasks.filter((task) => !reachable.has(task.task_id)).map((task) => task.task_id);
  return { connected, orphaned };
}