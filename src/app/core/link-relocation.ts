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
  if (link.kind === 'project-root') {
    if (end !== 'to') throw new Error('Only the task end of a project link can be moved.');
    if (dropNodeId === 'project') throw new Error('Drop the link on a task node.');
    return detachTaskFromParents(tasks, dropNodeId);
  }
  if (dropNodeId === 'project') {
    throw new Error('Drop the link on a task node.');
  }
  if (end === 'from' && dropNodeId === link.to) throw new Error('A link cannot connect a node to itself.');
  if (end === 'to' && dropNodeId === link.from) throw new Error('A link cannot connect a node to itself.');

  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  if (!byId.has(dropNodeId)) throw new Error('Unknown task node.');

  const copy = tasks.map((task) => ({
    ...task,
    dependencies: [...task.dependencies],
    sibling_dependencies: [...(task.sibling_dependencies ?? [])],
  }));
  const nextById = new Map(copy.map((task) => [task.task_id, task]));

  if (link.kind === 'child') {
    const parent = nextById.get(link.from);
    const child = nextById.get(link.to);
    if (!parent || !child) throw new Error('Link endpoints must be tasks in this project.');
    if (!parent.dependencies.includes(link.to)) throw new Error('Child link was removed. Refresh the mindmap.');

    if (end === 'to') {
      if (nextById.get(dropNodeId) === child) return copy;
      parent.dependencies = parent.dependencies.map((id) => (id === link.to ? dropNodeId : id));
    } else {
      const nextParent = nextById.get(dropNodeId);
      if (!nextParent) throw new Error('Unknown parent task.');
      if (nextParent.task_id === parent.task_id) return copy;
      parent.dependencies = parent.dependencies.filter((id) => id !== link.to);
      nextParent.dependencies = [...new Set([...nextParent.dependencies, link.to])];
    }
    assertAcyclicNormalLinks(copy);
    return copy;
  }

  const source = nextById.get(link.from);
  if (!source) throw new Error('Link endpoints must be tasks in this project.');
  if (!source.sibling_dependencies?.includes(link.to)) throw new Error('Sibling link was removed. Refresh the mindmap.');

  if (end === 'to') {
    source.sibling_dependencies = source.sibling_dependencies.map((id) => (id === link.to ? dropNodeId : id));
  } else {
    const nextSource = nextById.get(dropNodeId);
    if (!nextSource) throw new Error('Unknown task node.');
    if (nextSource.task_id === source.task_id) return copy;
    source.sibling_dependencies = source.sibling_dependencies.filter((id) => id !== link.to);
    nextSource.sibling_dependencies = [...new Set([...(nextSource.sibling_dependencies ?? []), link.to])];
  }
  return copy;
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
