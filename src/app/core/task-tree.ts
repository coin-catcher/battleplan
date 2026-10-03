import type { ProjectTask } from './models';

export interface TaskNode {
  task: ProjectTask;
  children: TaskNode[];
}

export function buildTaskParentMap(tasks: ProjectTask[]): Map<string, string | null> {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (taskId: string): number => {
    const known = depth.get(taskId);
    if (known !== undefined) return known;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const dependencies = (byId.get(taskId)?.dependencies ?? []).filter((id) => byId.has(id) && id !== taskId);
    const value = dependencies.length === 0 ? 0 : Math.max(...dependencies.map((id) => depthOf(id))) + 1;
    visiting.delete(taskId);
    depth.set(taskId, value);
    return value;
  };

  for (const task of tasks) depthOf(task.task_id);

  const parentOf = new Map<string, string | null>();
  for (const task of tasks) {
    const dependencies = task.dependencies.filter((id) => byId.has(id) && id !== task.task_id);
    if (dependencies.length === 0) {
      parentOf.set(task.task_id, null);
      continue;
    }
    const parentId = [...dependencies].sort((left, right) => {
      const byDepth = (depth.get(left) ?? 0) - (depth.get(right) ?? 0);
      if (byDepth !== 0) return byDepth;
      return (byId.get(left)?.order ?? 0) - (byId.get(right)?.order ?? 0);
    }).at(-1);
    parentOf.set(task.task_id, parentId ?? null);
  }

  for (const task of tasks) {
    const chain = new Set<string>([task.task_id]);
    let current = parentOf.get(task.task_id) ?? null;
    while (current) {
      if (chain.has(current)) {
        parentOf.set(task.task_id, null);
        break;
      }
      chain.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  return parentOf;
}

export function buildTaskForest(tasks: ProjectTask[]): TaskNode[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const parentOf = buildTaskParentMap(tasks);

  const nodes = new Map<string, TaskNode>(tasks.map((task) => [task.task_id, { task, children: [] }]));
  const roots: TaskNode[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.task_id);
    if (!node) continue;
    const parent = nodes.get(parentOf.get(task.task_id) ?? '');
    if (!parent || parent === node) roots.push(node);
    else parent.children.push(node);
  }

  const sortNodes = (list: TaskNode[]): void => {
    list.sort((left, right) => left.task.order - right.task.order || left.task.title.localeCompare(right.task.title));
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

export function reorderTaskIds(tasks: ProjectTask[], taskId: string, direction: -1 | 1): string[] | 'edge' | 'missing' {
  const moved = moveNodes(buildTaskForest(tasks), taskId, direction);
  if (moved === 'edge' || moved === 'missing') return moved;
  return flattenIds(moved);
}

function moveNodes(nodes: TaskNode[], taskId: string, direction: -1 | 1): TaskNode[] | 'edge' | 'missing' {
  const index = nodes.findIndex((node) => node.task.task_id === taskId);
  if (index >= 0) {
    const next = index + direction;
    if (next < 0 || next >= nodes.length) return 'edge';
    const copy = [...nodes];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    return copy;
  }
  for (let indexInParent = 0; indexInParent < nodes.length; indexInParent += 1) {
    const child = moveNodes(nodes[indexInParent].children, taskId, direction);
    if (child === 'missing') continue;
    if (child === 'edge') return 'edge';
    return nodes.map((node, nodeIndex) => nodeIndex === indexInParent ? { ...node, children: child } : node);
  }
  return 'missing';
}

function flattenIds(nodes: TaskNode[]): string[] {
  return nodes.flatMap((node) => [node.task.task_id, ...flattenIds(node.children)]);
}
