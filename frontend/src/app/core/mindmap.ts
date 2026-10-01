import type { ProjectTask, TaskStatus } from './models';

export interface MindmapNode {
  id: string;
  kind: 'project' | 'task';
  label: string;
  status?: TaskStatus;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindmapEdge {
  from: string;
  to: string;
  dashed: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MindmapLayout {
  width: number;
  height: number;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
}

const PROJECT_RADIUS = 58;
const TASK_WIDTH = 156;
const TASK_HEIGHT = 64;

export function layoutMindmap(title: string, tasks: ProjectTask[]): MindmapLayout {
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

  const direct = tasks
    .filter((task) => task.dependencies.every((id) => !byId.has(id) || id === task.task_id))
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  const angleOf = new Map<string, number>();
  direct.forEach((task, index) => {
    angleOf.set(task.task_id, -Math.PI / 2 + (index / Math.max(direct.length, 1)) * Math.PI * 2);
  });

  const childrenOf = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    const dependencies = task.dependencies.filter((id) => byId.has(id) && id !== task.task_id);
    if (dependencies.length === 0) continue;
    const parentId = [...dependencies].sort((left, right) => {
      const byDepth = depthOf(right) - depthOf(left);
      if (byDepth !== 0) return byDepth;
      return (byId.get(left)?.order ?? 0) - (byId.get(right)?.order ?? 0);
    })[0];
    const children = childrenOf.get(parentId) ?? [];
    children.push(task);
    childrenOf.set(parentId, children);
  }
  const placed = new Set(direct.map((task) => task.task_id));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const [parentId, children] of childrenOf) {
      if (!angleOf.has(parentId)) continue;
      children.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
      const base = angleOf.get(parentId) ?? 0;
      children.forEach((child, index) => {
        if (placed.has(child.task_id)) return;
        const offset = children.length === 1 ? 0.35 : (index - (children.length - 1) / 2) * 0.42;
        angleOf.set(child.task_id, base + offset);
        placed.add(child.task_id);
        progressed = true;
      });
    }
  }
  tasks.filter((task) => !angleOf.has(task.task_id)).forEach((task, index) => {
    angleOf.set(task.task_id, index * 0.7);
  });

  const maxDepth = tasks.reduce((max, task) => Math.max(max, depthOf(task.task_id)), 0);
  const outer = 180 + maxDepth * 132 + TASK_WIDTH;
  const size = Math.max(640, outer * 2);
  const center = size / 2;
  const nodes: MindmapNode[] = [{
    id: 'project',
    kind: 'project',
    label: title || 'Project',
    x: center,
    y: center,
    width: PROJECT_RADIUS * 2,
    height: PROJECT_RADIUS * 2,
  }];
  for (const task of tasks) {
    const radius = 180 + depthOf(task.task_id) * 132;
    const angle = angleOf.get(task.task_id) ?? 0;
    nodes.push({
      id: task.task_id,
      kind: 'task',
      label: task.title,
      status: task.status,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
      width: TASK_WIDTH,
      height: TASK_HEIGHT,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const project = nodeById.get('project');
  const edges: MindmapEdge[] = [];
  if (project) {
    for (const task of direct) {
      const target = nodeById.get(task.task_id);
      if (target) edges.push(drawEdge(project, target, false));
    }
  }
  for (const task of tasks) {
    const target = nodeById.get(task.task_id);
    if (!target) continue;
    for (const dependencyId of task.dependencies) {
      const source = nodeById.get(dependencyId);
      if (!source || source.id === target.id) continue;
      edges.push(drawEdge(source, target, true));
    }
  }
  return { width: size, height: size, nodes, edges };
}

function drawEdge(from: MindmapNode, to: MindmapNode, dashed: boolean): MindmapEdge {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = borderPoint(from, ux, uy);
  const end = borderPoint(to, -ux, -uy);
  return {
    from: from.id,
    to: to.id,
    dashed,
    x1: start.x,
    y1: start.y,
    x2: end.x - ux * 6,
    y2: end.y - uy * 6,
  };
}

function borderPoint(node: MindmapNode, ux: number, uy: number): { x: number; y: number } {
  if (node.kind === 'project') {
    const radius = node.width / 2;
    return { x: node.x + ux * radius, y: node.y + uy * radius };
  }
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const scaleX = ux === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(ux);
  const scaleY = uy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(uy);
  const scale = Math.min(scaleX, scaleY);
  return { x: node.x + ux * scale, y: node.y + uy * scale };
}
