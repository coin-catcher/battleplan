import type { ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import { ensureCritiqueBackEdges, prerequisitesMet } from './task-graph';
import { graphEdgesForDisplay, taskGraphValidationIssues } from './task-graph-recovery';
import type { Project } from './models';
import { isDispatchableNodeKind } from './task-node-kind';
import { independentBatch } from './execute-children';

export function graphEdgesForRun(project: Project | null, tasks: ProjectTask[]): TaskGraphEdge[] {
  if (project?.task_graph_edges?.length) return project.task_graph_edges;
  return graphEdgesForDisplay(project, tasks);
}

/** Graph edges for mindmap rendering (includes inferred critique rework back-edges when valid). */
export function graphEdgesForMindmap(project: Project | null, tasks: ProjectTask[]): TaskGraphEdge[] {
  if (project?.graph_recovery_session?.active) {
    return project.graph_recovery_session.confirmed_edges;
  }
  const base = graphEdgesForDisplay(project, tasks);
  const taskIds = new Set(tasks.map((task) => task.task_id));
  if (taskGraphValidationIssues(base, taskIds).length > 0) return base;
  return ensureCritiqueBackEdges(tasks, base);
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
