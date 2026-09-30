import { HttpError } from './errors.js';

export interface DependencyNode {
  task_id: string;
  dependencies: string[];
}

export function assertAcyclic(tasks: DependencyNode[]): void {
  const ids = new Set(tasks.map((task) => task.task_id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.task_id, indegree.get(task.task_id) ?? 0);
    outgoing.set(task.task_id, outgoing.get(task.task_id) ?? []);
  }

  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (dependency === task.task_id) {
        throw new HttpError(400, 'A task cannot depend on itself.');
      }
      if (!ids.has(dependency)) {
        throw new HttpError(400, `Dependency ${dependency} is not a task in this project.`);
      }
      outgoing.get(dependency)?.push(task.task_id);
      indegree.set(task.task_id, (indegree.get(task.task_id) ?? 0) + 1);
    }
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    seen += 1;
    for (const next of outgoing.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  if (seen !== tasks.length) {
    throw new HttpError(400, 'Task dependencies contain a cycle.');
  }
}
