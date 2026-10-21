import type { ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import { prerequisitesMet, rebuildGraphEdgesFromLegacy } from './task-graph';
import type { Project } from './models';
import { isDispatchableNodeKind } from './task-node-kind';
import { independentBatch } from './execute-children';

export function graphEdgesForRun(project: Project | null, tasks: ProjectTask[]): TaskGraphEdge[] {
  if (project?.task_graph_edges?.length) return project.task_graph_edges;
  return rebuildGraphEdgesFromLegacy(tasks);
}

export function isAutoDispatchCandidate(
  task: ProjectTask,
  tasks: ProjectTask[],
  edges: TaskGraphEdge[],
): boolean {
  if (task.status === 'BLOCKED') return false;
  if (task.status !== 'TODO') return false;
  if (task.output_type === 'subproject') return false;
  if (!isDispatchableNodeKind(task.node_kind)) return false;
  if (task.cursor_agent_id) return false;
  if (!prerequisitesMet(task, tasks, edges, { includeTree: true })) return false;
  return true;
}

export function tasksReadyForAutoDispatch(tasks: ProjectTask[], edges: TaskGraphEdge[]): ProjectTask[] {
  return tasks.filter((task) => isAutoDispatchCandidate(task, tasks, edges));
}

/** Ready tasks that can start in parallel (respects graph prerequisites). */
export function autoDispatchBatch(tasks: ProjectTask[], edges: TaskGraphEdge[]): ProjectTask[] {
  const ready = tasksReadyForAutoDispatch(tasks, edges);
  return independentBatch(ready, tasks);
}
