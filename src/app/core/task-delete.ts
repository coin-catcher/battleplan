import type { ProjectTask } from './models';
import { assertAcyclicNormalLinks, normalChildIds } from './dependencies';

/** Reparent normal child links and remove references when a task is deleted. */
export function reparentChildrenOnTaskDelete(tasks: ProjectTask[], deletedId: string): ProjectTask[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const deleted = byId.get(deletedId);
  if (!deleted) return tasks;

  const childIds = normalChildIds(deleted, byId);
  const next = tasks.map((task) => {
    if (task.task_id === deletedId) return task;
    let dependencies = [...task.dependencies];
    let sibling_dependencies = [...(task.sibling_dependencies ?? [])];
    let changed = false;

    if (dependencies.includes(deletedId)) {
      dependencies = dependencies.filter((id) => id !== deletedId);
      for (const childId of childIds) {
        if (childId !== task.task_id && !dependencies.includes(childId)) dependencies.push(childId);
      }
      changed = true;
    }

    if (sibling_dependencies.includes(deletedId)) {
      sibling_dependencies = sibling_dependencies.filter((id) => id !== deletedId);
      changed = true;
    }

    if (!changed) return task;
    return { ...task, dependencies, sibling_dependencies };
  });

  const remaining = next.filter((task) => task.task_id !== deletedId);
  assertAcyclicNormalLinks(remaining);
  return next;
}
