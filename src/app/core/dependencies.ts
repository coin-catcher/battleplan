import type { ProjectTask } from './models';

/** True when both tasks list each other in `dependencies` (union / sibling link). */
export function isUnionPair(byId: Map<string, ProjectTask>, leftId: string, rightId: string): boolean {
  if (leftId === rightId) return false;
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  if (!left || !right) return false;
  return left.dependencies.includes(rightId) && right.dependencies.includes(leftId);
}

/** Parent depends on child: `parent.dependencies` includes `childId` and the link is not a union pair. */
export function isNormalChildLink(
  byId: Map<string, ProjectTask>,
  parentId: string,
  childId: string,
): boolean {
  const parent = byId.get(parentId);
  if (!parent?.dependencies.includes(childId)) return false;
  return !isUnionPair(byId, parentId, childId);
}

export function normalChildIds(task: ProjectTask, byId: Map<string, ProjectTask>): string[] {
  return task.dependencies.filter((id) => isNormalChildLink(byId, task.task_id, id));
}

export function unionPartnerIds(task: ProjectTask, byId: Map<string, ProjectTask>): string[] {
  return task.dependencies.filter((id) => isUnionPair(byId, task.task_id, id));
}

/** Tasks whose parent depends on them via a normal (non-union) link. */
export function normalParentIds(taskId: string, tasks: ProjectTask[]): string[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  return tasks
    .filter((candidate) => isNormalChildLink(byId, candidate.task_id, taskId))
    .map((candidate) => candidate.task_id);
}

export function pickPrimaryParentId(taskId: string, tasks: ProjectTask[]): string | null {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const parents = tasks.filter((candidate) => isNormalChildLink(byId, candidate.task_id, taskId));
  if (parents.length === 0) return null;
  const depth = depthByNormalLinks(tasks);
  parents.sort((left, right) => {
    const byDepth = (depth.get(left.task_id) ?? 0) - (depth.get(right.task_id) ?? 0);
    if (byDepth !== 0) return byDepth;
    return left.order - right.order;
  });
  return parents.at(-1)?.task_id ?? null;
}

export function depthByNormalLinks(tasks: ProjectTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (taskId: string): number => {
    const known = depth.get(taskId);
    if (known !== undefined) return known;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const parents = tasks.filter((candidate) => isNormalChildLink(byId, candidate.task_id, taskId));
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => depthOf(parent.task_id))) + 1;
    visiting.delete(taskId);
    depth.set(taskId, value);
    return value;
  };

  for (const task of tasks) depthOf(task.task_id);
  return depth;
}

/** Root tasks attach directly to the project (not a normal child of another task). */
export function rootTaskIds(tasks: ProjectTask[]): string[] {
  const childIds = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  for (const task of tasks) {
    for (const childId of normalChildIds(task, byId)) childIds.add(childId);
  }
  return tasks.filter((task) => !childIds.has(task.task_id)).map((task) => task.task_id);
}

/**
 * Convert legacy storage where a task listed its prerequisites in `dependencies`
 * into parent-depends-on-child links (and preserved mutual union pairs).
 */
export function migrateLegacyDependencies(tasks: ProjectTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  let changed = false;

  const legacyEdges: Array<{ dependent: string; prerequisite: string }> = [];
  for (const task of tasks) {
    for (const prerequisite of task.dependencies) {
      if (prerequisite === task.task_id) continue;
      if (!byId.has(prerequisite)) continue;
      if (isUnionPair(byId, task.task_id, prerequisite)) continue;
      if (byId.get(prerequisite)?.dependencies.includes(task.task_id)) continue;
      legacyEdges.push({ dependent: task.task_id, prerequisite });
    }
  }

  if (legacyEdges.length === 0) return false;

  for (const { dependent, prerequisite } of legacyEdges) {
    const parent = byId.get(prerequisite);
    const child = byId.get(dependent);
    if (!parent || !child) continue;
    if (!parent.dependencies.includes(dependent)) {
      parent.dependencies = [...parent.dependencies, dependent];
      changed = true;
    }
    if (child.dependencies.includes(prerequisite)) {
      child.dependencies = child.dependencies.filter((id) => id !== prerequisite);
      changed = true;
    }
  }

  return changed;
}

export function assertAcyclicNormalLinks(tasks: ProjectTask[]): void {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const ids = new Set(tasks.map((task) => task.task_id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const task of tasks) {
    for (const childId of normalChildIds(task, byId)) {
      if (!ids.has(childId)) throw new Error(`Dependency ${childId} is not a task in this project.`);
      outgoing.get(task.task_id)?.push(childId);
      indegree.set(childId, (indegree.get(childId) ?? 0) + 1);
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
  if (seen !== tasks.length) throw new Error('Task dependencies contain a cycle.');
}
