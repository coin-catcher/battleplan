import type { ProjectTask } from './models';
import { assertAcyclicNormalLinks, normalChildIds } from './dependencies';

export type MindmapLinkKind = 'child' | 'sibling' | 'project-root';

export interface MindmapLinkRef {
  kind: MindmapLinkKind;
  from: string;
  to: string;
}

export function linkKey(link: MindmapLinkRef): string {
  return `${link.kind}:${link.from}:${link.to}`;
}

export function applyLinkRelocation(
  tasks: ProjectTask[],
  link: MindmapLinkRef,
  end: 'from' | 'to',
  dropNodeId: string,
): ProjectTask[] {
  if (end === 'from' && dropNodeId === link.to) {
    throw new Error('A link cannot connect a node to itself.');
  }
  if (end === 'to' && dropNodeId === link.from) {
    throw new Error('A link cannot connect a node to itself.');
  }

  if (link.kind === 'project-root') {
    return relocateProjectRootLink(tasks, link, end, dropNodeId);
  }
  if (link.kind === 'child') {
    return relocateChildLink(tasks, link, end, dropNodeId);
  }
  return relocateSiblingLink(tasks, link, end, dropNodeId);
}

function relocateProjectRootLink(
  tasks: ProjectTask[],
  link: MindmapLinkRef,
  end: 'from' | 'to',
  dropNodeId: string,
): ProjectTask[] {
  const rootTaskId = link.to;
  if (end === 'to') {
    if (dropNodeId === 'project' || dropNodeId === rootTaskId) {
      return cloneTasks(tasks);
    }
    return detachTaskFromParents(tasks, dropNodeId);
  }
  if (dropNodeId === 'project') {
    return cloneTasks(tasks);
  }
  if (dropNodeId === rootTaskId) {
    return cloneTasks(tasks);
  }
  const next = attachChildToParent(tasks, dropNodeId, rootTaskId);
  assertAcyclicNormalLinks(next);
  return next;
}

function relocateChildLink(
  tasks: ProjectTask[],
  link: MindmapLinkRef,
  end: 'from' | 'to',
  dropNodeId: string,
): ProjectTask[] {
  const copy = cloneTasks(tasks);
  const byId = new Map(copy.map((task) => [task.task_id, task]));
  const parent = byId.get(link.from);
  const child = byId.get(link.to);
  if (!parent || !child) throw new Error('Link endpoints must be tasks in this project.');
  if (!parent.dependencies.includes(link.to)) throw new Error('Child link was removed. Refresh the mindmap.');

  if (dropNodeId === 'project') {
    parent.dependencies = parent.dependencies.filter((id) => id !== link.to);
    return copy;
  }
  if (!byId.has(dropNodeId)) throw new Error('Unknown task node.');

  if (end === 'to') {
    if (dropNodeId === link.to) return copy;
    parent.dependencies = parent.dependencies.map((id) => (id === link.to ? dropNodeId : id));
    return copy;
  }

  if (dropNodeId === link.from) return copy;
  parent.dependencies = parent.dependencies.filter((id) => id !== link.to);
  const nextParent = byId.get(dropNodeId);
  if (!nextParent) throw new Error('Unknown parent task.');
  nextParent.dependencies = [...new Set([...nextParent.dependencies, link.to])];
  assertAcyclicNormalLinks(copy);
  return copy;
}

function relocateSiblingLink(
  tasks: ProjectTask[],
  link: MindmapLinkRef,
  end: 'from' | 'to',
  dropNodeId: string,
): ProjectTask[] {
  const copy = cloneTasks(tasks);
  const byId = new Map(copy.map((task) => [task.task_id, task]));
  const source = byId.get(link.from);
  if (!source) throw new Error('Link endpoints must be tasks in this project.');
  if (!source.sibling_dependencies?.includes(link.to)) {
    throw new Error('Sibling link was removed. Refresh the mindmap.');
  }

  if (dropNodeId === 'project') {
    source.sibling_dependencies = source.sibling_dependencies.filter((id) => id !== link.to);
    return copy;
  }
  if (!byId.has(dropNodeId)) throw new Error('Unknown task node.');

  if (end === 'to') {
    source.sibling_dependencies = source.sibling_dependencies.map((id) => (id === link.to ? dropNodeId : id));
    return copy;
  }

  if (dropNodeId === link.from) return copy;
  source.sibling_dependencies = source.sibling_dependencies.filter((id) => id !== link.to);
  const nextSource = byId.get(dropNodeId);
  if (!nextSource) throw new Error('Unknown task node.');
  nextSource.sibling_dependencies = [...new Set([...(nextSource.sibling_dependencies ?? []), link.to])];
  return copy;
}

function cloneTasks(tasks: ProjectTask[]): ProjectTask[] {
  return tasks.map((task) => ({
    ...task,
    dependencies: [...task.dependencies],
    sibling_dependencies: [...(task.sibling_dependencies ?? [])],
  }));
}

/** Remove every normal parent→child link pointing at this task so it attaches to the project root. */
function detachTaskFromParents(tasks: ProjectTask[], taskId: string): ProjectTask[] {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  return tasks.map((task) => {
    const childIds = normalChildIds(task, byId);
    if (!childIds.includes(taskId)) return task;
    return {
      ...task,
      dependencies: task.dependencies.filter((id) => id !== taskId),
    };
  });
}

function attachChildToParent(tasks: ProjectTask[], parentId: string, childId: string): ProjectTask[] {
  const detached = detachTaskFromParents(tasks, childId);
  return detached.map((task) => {
    if (task.task_id !== parentId) return task;
    return {
      ...task,
      dependencies: [...new Set([...task.dependencies, childId])],
    };
  });
}
