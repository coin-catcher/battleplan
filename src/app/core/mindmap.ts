import type { MindmapLinkKind } from './link-relocation';
import type { ProjectTask, TaskStatus } from './models';
import {
  depthByNormalLinks,
  normalChildIds,
  rootTaskIds,
  siblingDependencyIds,
} from './dependencies';

export type MindmapShape = 'project' | 'code' | 'research' | 'subproject';

export interface MindmapNode {
  id: string;
  kind: 'project' | 'task';
  shape: MindmapShape;
  label: string;
  status?: TaskStatus;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindmapEdge {
  kind: MindmapLinkKind;
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

export const PROJECT_RADIUS = 68;
export const TASK_WIDTH = 156;
export const TASK_HEIGHT = 64;
export const RESEARCH_WIDTH = 168;
export const RESEARCH_HEIGHT = 96;

export type CardinalDirection = 'north' | 'south' | 'east' | 'west';

const CARDINAL_UNIT: Record<CardinalDirection, { ux: number; uy: number }> = {
  north: { ux: 0, uy: -1 },
  south: { ux: 0, uy: 1 },
  east: { ux: 1, uy: 0 },
  west: { ux: -1, uy: 0 },
};

const CARDINAL_ORDER: CardinalDirection[] = ['north', 'east', 'south', 'west'];

export function cardinalAnchor(node: MindmapNode, direction: CardinalDirection): { x: number; y: number } {
  const { ux, uy } = CARDINAL_UNIT[direction];
  return borderPoint(node, ux, uy);
}

export function pickNorthWestCorner(
  node: MindmapNode,
  worldX: number,
  worldY: number,
  thresholdPx: number,
): boolean {
  const cornerX = node.x - node.width / 2;
  const cornerY = node.y - node.height / 2;
  return Math.hypot(worldX - cornerX, worldY - cornerY) <= thresholdPx;
}

export function pickCardinalEdge(
  node: MindmapNode,
  worldX: number,
  worldY: number,
  thresholdPx: number,
): CardinalDirection | null {
  let best: CardinalDirection | null = null;
  let bestDistance = thresholdPx;
  for (const direction of CARDINAL_ORDER) {
    const anchor = cardinalAnchor(node, direction);
    const distance = Math.hypot(worldX - anchor.x, worldY - anchor.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = direction;
    }
  }
  return best;
}

export function positionConnectedNode(
  source: MindmapNode,
  direction: CardinalDirection,
  gapPx = 120,
): { x: number; y: number } {
  const anchor = cardinalAnchor(source, direction);
  const { ux, uy } = CARDINAL_UNIT[direction];
  const circular = source.shape === 'project' || source.shape === 'subproject';
  const halfW = circular ? source.width / 2 : TASK_WIDTH / 2;
  const halfH = circular ? source.height / 2 : TASK_HEIGHT / 2;
  const outward = Math.max(halfW, halfH) + gapPx + (direction === 'north' || direction === 'south' ? TASK_HEIGHT / 2 : TASK_WIDTH / 2);
  return { x: anchor.x + ux * outward, y: anchor.y + uy * outward };
}

/** Convert a pointer position inside map-stage to layout world coordinates. */
export function mindmapNodeAtPoint(nodes: MindmapNode[], x: number, y: number): MindmapNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (Math.abs(x - node.x) <= node.width / 2 && Math.abs(y - node.y) <= node.height / 2) {
      return node;
    }
  }
  return null;
}

export function pointerToWorld(
  clientX: number,
  clientY: number,
  stageRect: DOMRect,
  scrollLeft: number,
  scrollTop: number,
  zoom: number,
): { x: number; y: number } {
  const localX = clientX - stageRect.left + scrollLeft;
  const localY = clientY - stageRect.top + scrollTop;
  return { x: localX / zoom, y: localY / zoom };
}

export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function mindmapNodeBounds(node: MindmapNode): WorldRect {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  return {
    left: node.x - halfW,
    top: node.y - halfH,
    right: node.x + halfW,
    bottom: node.y + halfH,
  };
}

export function normalizeWorldRect(x1: number, y1: number, x2: number, y2: number): WorldRect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function worldRectsIntersect(left: WorldRect, right: WorldRect): boolean {
  return left.left <= right.right
    && left.right >= right.left
    && left.top <= right.bottom
    && left.bottom >= right.top;
}

export function mindmapNodesInWorldRect(nodes: MindmapNode[], rect: WorldRect): string[] {
  return nodes
    .filter((node) => worldRectsIntersect(mindmapNodeBounds(node), rect))
    .map((node) => node.id);
}

const WORLD_X = 1600;
const WORLD_Y = 1200;

export function layoutMindmap(
  title: string,
  tasks: ProjectTask[],
  projectPin?: { x: number; y: number },
  projectStatus?: TaskStatus,
): MindmapLayout {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const depth = depthByNormalLinks(tasks);
  const depthOf = (taskId: string): number => depth.get(taskId) ?? 0;

  const rootIds = new Set(rootTaskIds(tasks));
  const direct = tasks
    .filter((task) => rootIds.has(task.task_id))
    .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  const angleOf = new Map<string, number>();
  const rootCount = Math.max(direct.length, 1);
  const rootStep = (Math.PI * 2) / rootCount;
  const rootStart = -Math.PI / 2 - ((rootCount - 1) * rootStep) / 2;
  direct.forEach((task, index) => {
    angleOf.set(task.task_id, rootStart + index * rootStep);
  });

  const childrenOf = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    for (const childId of normalChildIds(task, byId)) {
      const child = byId.get(childId);
      if (!child) continue;
      const children = childrenOf.get(task.task_id) ?? [];
      children.push(child);
      childrenOf.set(task.task_id, children);
    }
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
    shape: 'project',
    label: title || 'Project',
    status: projectStatus,
    x: projectX,
    y: projectY,
    width: PROJECT_RADIUS * 2,
    height: PROJECT_RADIUS * 2,
  }];
  for (const task of tasks) {
    const radius = 200 + depthOf(task.task_id) * 150;
    const angle = angleOf.get(task.task_id) ?? 0;
    const pinned = Number.isFinite(task.map_x) && Number.isFinite(task.map_y);
    const shape: MindmapShape = task.output_type === 'research'
      ? 'research'
      : task.output_type === 'subproject'
        ? 'subproject'
        : 'code';
    const research = shape === 'research';
    nodes.push({
      id: task.task_id,
      kind: 'task',
      shape,
      label: task.title,
      status: task.status,
      x: pinned ? task.map_x! : projectX + Math.cos(angle) * radius,
      y: pinned ? task.map_y! : projectY + Math.sin(angle) * radius,
      width: research ? RESEARCH_WIDTH : TASK_WIDTH,
      height: research ? RESEARCH_HEIGHT : TASK_HEIGHT,
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
      if (target) edges.push(drawEdge('project-root', project, target, false));
    }
  }
  for (const task of tasks) {
    const parent = nodeById.get(task.task_id);
    if (!parent) continue;
    for (const childId of normalChildIds(task, byId)) {
      const child = nodeById.get(childId);
      if (!child || child.id === parent.id) continue;
      edges.push(drawEdge('child', parent, child, false));
    }
    for (const siblingId of siblingDependencyIds(task)) {
      const sibling = nodeById.get(siblingId);
      if (!sibling || sibling.id === parent.id) continue;
      edges.push(drawEdge('sibling', parent, sibling, true));
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
      if (node.shape === 'project' || pinned.has(node.id)) continue;
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

function drawEdge(kind: MindmapLinkKind, from: MindmapNode, to: MindmapNode, dashed: boolean): MindmapEdge {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = borderPoint(from, ux, uy);
  const end = borderPoint(to, -ux, -uy);
  return {
    kind,
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
  if (node.shape === 'project' || node.shape === 'subproject') {
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
