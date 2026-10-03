import type { ProjectTask } from './models';
import { normalChildIds } from './dependencies';

/** All normal child descendants of `rootTaskId` (does not include the root). */
export function descendantTaskIds(rootTaskId: string, tasks: ProjectTask[]): string[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const collected = new Set<string>();
  const walk = (taskId: string): void => {
    const task = byId.get(taskId);
    if (!task) return;
    for (const childId of normalChildIds(task, byId)) {
      collected.add(childId);
      walk(childId);
    }
  };
  walk(rootTaskId);
  return [...collected];
}

/** Every normal child in this task's subtree is DONE or ABANDONED. */
export function childSubtreeClosed(taskId: string, tasks: ProjectTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const visit = (id: string): boolean => {
    const task = byId.get(id);
    if (!task) return true;
    for (const childId of normalChildIds(task, byId)) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.status !== 'DONE' && child.status !== 'ABANDONED') return false;
      if (!visit(childId)) return false;
    }
    return true;
  };
  return visit(taskId);
}

export function isAvailableDescendant(task: ProjectTask, tasks: ProjectTask[]): boolean {
  if (task.status !== 'TODO') return false;
  if (task.cursor_agent_id) return false;
  const byId = new Map(tasks.map((item) => [item.task_id, item]));
  const children = normalChildIds(task, byId);
  if (children.length === 0) return true;
  return childSubtreeClosed(task.task_id, tasks);
}

export function availableDescendants(rootTaskId: string, tasks: ProjectTask[]): ProjectTask[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  return descendantTaskIds(rootTaskId, tasks)
    .map((id) => byId.get(id))
    .filter((task): task is ProjectTask => Boolean(task))
    .filter((task) => isAvailableDescendant(task, tasks));
}

/** Drop tasks that sibling-depend on another still-TODO task in the same available set. */
export function independentBatch(available: ProjectTask[], tasks: ProjectTask[]): ProjectTask[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const availableIds = new Set(available.map((task) => task.task_id));
  return available.filter((task) => {
    for (const siblingId of task.sibling_dependencies ?? []) {
      if (!availableIds.has(siblingId)) continue;
      const sibling = byId.get(siblingId);
      if (sibling?.status === 'TODO') return false;
    }
    return true;
  });
}
