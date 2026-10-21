import { normalParentIds, siblingDependencyIds } from './dependencies';
import type { ProjectTask } from './models';
import { isDispatchableNodeKind } from './task-node-kind';
import { independentBatch } from './execute-children';

export function parentsDoneForTask(task: ProjectTask, tasks: ProjectTask[]): boolean {
  const parents = normalParentIds(task.task_id, tasks);
  if (parents.length === 0) return true;
  const byId = new Map(tasks.map((item) => [item.task_id, item]));
  return parents.every((parentId) => {
    const parent = byId.get(parentId);
    return parent?.status === 'DONE' || parent?.status === 'ABANDONED';
  });
}

export function siblingsDoneForTask(task: ProjectTask, tasks: ProjectTask[]): boolean {
  const byId = new Map(tasks.map((item) => [item.task_id, item]));
  for (const siblingId of siblingDependencyIds(task)) {
    const other = byId.get(siblingId);
    if (!other || other.status !== 'DONE') return false;
  }
  return true;
}

export function isAutoDispatchCandidate(task: ProjectTask, tasks: ProjectTask[]): boolean {
  if (task.status !== 'TODO') return false;
  if (task.output_type === 'subproject') return false;
  if (!isDispatchableNodeKind(task.node_kind)) return false;
  if (task.cursor_agent_id) return false;
  if (!parentsDoneForTask(task, tasks)) return false;
  if (!siblingsDoneForTask(task, tasks)) return false;
  return true;
}

export function tasksReadyForAutoDispatch(tasks: ProjectTask[]): ProjectTask[] {
  return tasks.filter((task) => isAutoDispatchCandidate(task, tasks));
}

/** Ready tasks that can start in parallel (respects sibling_dependencies). */
export function autoDispatchBatch(tasks: ProjectTask[]): ProjectTask[] {
  const ready = tasksReadyForAutoDispatch(tasks);
  return independentBatch(ready, tasks);
}
