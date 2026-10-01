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

const PROJECT_RADIUS = 68;
const TASK_WIDTH = 156;
const TASK_HEIGHT = 64;

const WORLD_X = 1600;
const WORLD_Y = 1200;

export function layoutMindmap(
  title: string,
  tasks: ProjectTask[],
  projectPin?: { x: number; y: number },
): MindmapLayout {
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

  const projectX = projectPin?.x ?? WORLD_X;
  const projectY = projectPin?.y ?? WORLD_Y;
  const nodes: MindmapNode[] = [{
    id: 'project',
    kind: 'project',
    label: title || 'Project',
    x: projectX,
    y: projectY,
    width: PROJECT_RADIUS * 2,
    height: PROJECT_RADIUS * 2,
  }];
  for (const task of tasks) {
    const radius = 200 + depthOf(task.task_id) * 150;
    const angle = angleOf.get(task.task_id) ?? 0;
    const pinned = Number.isFinite(task.map_x) && Number.isFinite(task.map_y);
    nodes.push({
      id: task.task_id,
      kind: 'task',
      label: task.title,
      status: task.status,
      x: pinned ? task.map_x! : projectX + Math.cos(angle) * radius,
      y: pinned ? task.map_y! : projectY + Math.sin(angle) * radius,
      width: TASK_WIDTH,
      height: TASK_HEIGHT,
    });
  }
  separateUnpinned(nodes, tasks);

  let maxX = WORLD_X + 800;
  let maxY = WORLD_Y + 600;
  for (const node of nodes) {
    maxX = Math.max(maxX, node.x + node.width / 2 + 80);
    maxY = Math.max(maxY, node.y + node.height / 2 + 80);
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
  return {
    width: Math.max(WORLD_X * 2, maxX),
    height: Math.max(WORLD_Y * 2, maxY),
    nodes,
    edges,
  };
}

function separateUnpinned(nodes: MindmapNode[], tasks: ProjectTask[]): void {
  const pinned = new Set(tasks.filter((task) => Number.isFinite(task.map_x) && Number.isFinite(task.map_y)).map((task) => task.task_id));
  for (let pass = 0; pass < 8; pass += 1) {
    for (const node of nodes) {
      if (node.kind === 'project' || pinned.has(node.id)) continue;
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const distance = Math.hypot(dx, dy) || 1;
        const needed = (node.width + other.width) / 2 + 28;
        if (distance >= needed) continue;
        const push = (needed - distance) / distance;
        node.x += dx * push;
        node.y += dy * push;
      }
    }
  }
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
