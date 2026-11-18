import type { MindmapLinkKind } from './link-relocation';
import type { ProjectTask, TaskStatus } from './models';
import type { TaskGraphEdge } from './task-graph';
import {
  depthByNormalLinks,
  normalChildIds,
  rootTaskIds,
  siblingDependencyIds,
} from './dependencies';
import { mindmapNodeSize, mindmapShapeForTask } from './mindmap-shape';
import { mindmapCanvasCenter, mindmapCanvasWorldSpan } from './project-ui-state';

export type MindmapShape =
  | 'project'
  | 'code'
  | 'research'
  | 'subproject'
  | 'decision'
  | 'gate'
  | 'fog'
  | 'brainstorm'
  | 'architect';

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

export type MindmapLineStroke = 'solid' | 'dashed' | 'dotted';

export interface MindmapEdge {
  kind: MindmapLinkKind;
  from: string;
  to: string;
  stroke: MindmapLineStroke;
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
/** Bumped when persisted map coordinates are re-centered on the world canvas. */
export const MINDMAP_PLACEMENT_VERSION = 3;
export const MINDMAP_CANVAS_MARGIN_PX = 80;

/** Legacy rows used (0,0) before placement migration — not a real user pin. */
export function isMindmapPinSentinel(mapX: number | undefined, mapY: number | undefined): boolean {
  return mapX === 0 && mapY === 0;
}

/** True when stored coordinates should drive layout (not auto-spiral). */
export function hasPersistedMindmapPin(mapX: number | undefined, mapY: number | undefined): boolean {
  return Number.isFinite(mapX) && Number.isFinite(mapY) && !isMindmapPinSentinel(mapX, mapY);
}

export function taskHasPersistedMindmapPin(task: Pick<ProjectTask, 'map_x' | 'map_y'>): boolean {
  return hasPersistedMindmapPin(task.map_x, task.map_y);
}

export function projectOrTasksNeedMindmapRelayout(
  project: Pick<import('./models').Project, 'map_x' | 'map_y'>,
  tasks: Pick<ProjectTask, 'map_x' | 'map_y'>[],
): boolean {
  if (isMindmapPinSentinel(project.map_x, project.map_y)) return true;
  return tasks.some((task) => isMindmapPinSentinel(task.map_x, task.map_y));
}

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

export const CONNECT_ARROW_LENGTH_PX = 100;

/** Point `distancePx` outward from the side anchor (used for initial connection arrow). */
export function offsetFromCardinal(
  node: MindmapNode,
  direction: CardinalDirection,
  distancePx: number,
): { x: number; y: number } {
  const anchor = cardinalAnchor(node, direction);
  const { ux, uy } = CARDINAL_UNIT[direction];
  return { x: anchor.x + ux * distancePx, y: anchor.y + uy * distancePx };
}

/**
 * Hover band for the connect control: middle 40–60% of a side, up to `outsidePx` outside the node.
 */
export function pickConnectHoverSide(
  node: MindmapNode,
  worldX: number,
  worldY: number,
  outsidePx = 10,
): CardinalDirection | null {
  const bounds = mindmapNodeBounds(node);
  const insideX = worldX > bounds.left && worldX < bounds.right;
  const insideY = worldY > bounds.top && worldY < bounds.bottom;
  if (insideX && insideY) return null;

  const midXMin = bounds.left + node.width * 0.4;
  const midXMax = bounds.left + node.width * 0.6;
  const midYMin = bounds.top + node.height * 0.4;
  const midYMax = bounds.top + node.height * 0.6;

  if (worldX >= midXMin && worldX <= midXMax) {
    if (worldY >= bounds.top - outsidePx && worldY <= bounds.top) return 'north';
    if (worldY >= bounds.bottom && worldY <= bounds.bottom + outsidePx) return 'south';
  }
  if (worldY >= midYMin && worldY <= midYMax) {
    if (worldX >= bounds.right && worldX <= bounds.right + outsidePx) return 'east';
    if (worldX >= bounds.left - outsidePx && worldX <= bounds.left) return 'west';
  }
  return null;
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

/** Inset bounds where task node *centers* may sit (entire shape stays inside canvas). */
export function mindmapCanvasPlacementBounds(canvasSpan = mindmapCanvasWorldSpan()): WorldRect {
  const margin = MINDMAP_CANVAS_MARGIN_PX;
  return {
    left: margin,
    top: margin,
    right: canvasSpan - margin,
    bottom: canvasSpan - margin,
  };
}

export function mindmapNodeCenterFitsCanvas(
  x: number,
  y: number,
  width: number,
  height: number,
  canvasSpan = mindmapCanvasWorldSpan(),
): boolean {
  const bounds = mindmapNodeBounds({
    id: '',
    kind: 'task',
    shape: 'code',
    label: '',
    x,
    y,
    width,
    height,
  });
  const inner = mindmapCanvasPlacementBounds(canvasSpan);
  return bounds.left >= inner.left
    && bounds.right <= inner.right
    && bounds.top >= inner.top
    && bounds.bottom <= inner.bottom;
}

/**
 * Single entry point for persisting or computing a task center on the mindmap.
 * Clamps so the full task shape stays inside the world canvas.
 */
export function placeTaskOnMindmap(
  x: number,
  y: number,
  size: { width: number; height: number },
  canvasSpan = mindmapCanvasWorldSpan(),
): { x: number; y: number } {
  const inner = mindmapCanvasPlacementBounds(canvasSpan);
  const halfW = size.width / 2;
  const halfH = size.height / 2;
  const minCx = inner.left + halfW;
  const maxCx = inner.right - halfW;
  const minCy = inner.top + halfH;
  const maxCy = inner.bottom - halfH;
  const cx = minCx > maxCx
    ? canvasSpan / 2
    : Math.min(maxCx, Math.max(minCx, x));
  const cy = minCy > maxCy
    ? canvasSpan / 2
    : Math.min(maxCy, Math.max(minCy, y));
  return { x: Math.round(cx), y: Math.round(cy) };
}

export function placeTaskOnMindmapForTask(
  x: number,
  y: number,
  task: Pick<ProjectTask, 'output_type' | 'node_kind'>,
  canvasSpan = mindmapCanvasWorldSpan(),
): { x: number; y: number } {
  const shape = mindmapShapeForTask(task);
  const size = mindmapNodeSize(shape);
  return placeTaskOnMindmap(x, y, size, canvasSpan);
}

function clampMindmapTaskNodesInPlace(nodes: MindmapNode[], canvasSpan: number): void {
  for (const node of nodes) {
    if (node.kind !== 'task') continue;
    const placed = placeTaskOnMindmap(
      node.x,
      node.y,
      { width: node.width, height: node.height },
      canvasSpan,
    );
    node.x = placed.x;
    node.y = placed.y;
  }
}

export function positionConnectedNode(
  source: MindmapNode,
  direction: CardinalDirection,
  gapPx = 120,
  newTaskShape: MindmapShape = 'code',
): { x: number; y: number } {
  const anchor = cardinalAnchor(source, direction);
  const { ux, uy } = CARDINAL_UNIT[direction];
  const circular = source.shape === 'project' || source.shape === 'subproject';
  const halfW = circular ? source.width / 2 : TASK_WIDTH / 2;
  const halfH = circular ? source.height / 2 : TASK_HEIGHT / 2;
  const outward = Math.max(halfW, halfH) + gapPx + (direction === 'north' || direction === 'south' ? TASK_HEIGHT / 2 : TASK_WIDTH / 2);
  const size = mindmapNodeSize(newTaskShape);
  return placeTaskOnMindmap(anchor.x + ux * outward, anchor.y + uy * outward, size);
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

/** Client rect of the map stage (`Element.getBoundingClientRect()` is compatible). */
export interface MapStageClientRect {
  left: number;
  top: number;
}

export function pointerToWorld(
  clientX: number,
  clientY: number,
  stageRect: MapStageClientRect,
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

export function mindmapNodesWorldExtent(nodes: MindmapNode[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const bounds = mindmapNodeBounds(node);
    minX = Math.min(minX, bounds.left);
    minY = Math.min(minY, bounds.top);
    maxX = Math.max(maxX, bounds.right);
    maxY = Math.max(maxY, bounds.bottom);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return { minX, minY, maxX, maxY };
}

/** Move (and scale uniformly about the project) so the graph is centered and fits the canvas. */
export function applyMindmapCanvasFrame(nodes: MindmapNode[], canvasSpan: number): void {
  const margin = MINDMAP_CANVAS_MARGIN_PX;
  const project = nodes.find((node) => node.id === 'project');
  if (!project) return;
  const target = canvasSpan / 2;
  const dx = target - project.x;
  const dy = target - project.y;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }

  const inner = canvasSpan - margin * 2;
  let extent = mindmapNodesWorldExtent(nodes);
  let width = extent.maxX - extent.minX;
  let height = extent.maxY - extent.minY;
  const scale = Math.min(1, inner / Math.max(width, 1), inner / Math.max(height, 1));
  if (scale < 1) {
    const cx = project.x;
    const cy = project.y;
    for (const node of nodes) {
      node.x = cx + (node.x - cx) * scale;
      node.y = cy + (node.y - cy) * scale;
    }
  }
}

export function layoutMindmap(
  title: string,
  tasks: ProjectTask[],
  projectPin?: { x: number; y: number },
  projectStatus?: TaskStatus,
  graphEdges?: TaskGraphEdge[],
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

  const defaultCenter = mindmapCanvasCenter();
  const projectX = projectPin?.x ?? defaultCenter.x;
  const projectY = projectPin?.y ?? defaultCenter.y;
  const minCanvasSpan = mindmapCanvasWorldSpan();
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
    const pinned = taskHasPersistedMindmapPin(task);
    const shape: MindmapShape = mindmapShapeForTask(task);
    const size = mindmapNodeSize(shape);
    const rawX = pinned ? task.map_x! : projectX + Math.cos(angle) * radius;
    const rawY = pinned ? task.map_y! : projectY + Math.sin(angle) * radius;
    const placed = placeTaskOnMindmap(rawX, rawY, size, minCanvasSpan);
    nodes.push({
      id: task.task_id,
      kind: 'task',
      shape,
      label: task.title,
      status: task.status,
      x: placed.x,
      y: placed.y,
      width: size.width,
      height: size.height,
    });
  }
  separateUnpinned(nodes, tasks);
  clampMindmapTaskNodesInPlace(nodes, minCanvasSpan);
  applyMindmapCanvasFrame(nodes, minCanvasSpan);
  clampMindmapTaskNodesInPlace(nodes, minCanvasSpan);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const project = nodeById.get('project');
  const edges: MindmapEdge[] = [];
  if (project) {
    for (const task of direct) {
      const target = nodeById.get(task.task_id);
      if (target) edges.push(drawEdge('project-root', project, target, 'solid'));
    }
  }
  if (graphEdges?.length) {
    for (const edge of graphEdges) {
      const from = nodeById.get(edge.from_task_id);
      const to = nodeById.get(edge.to_task_id);
      if (!from || !to || from.id === to.id) continue;
      const linkKind = mindmapKindForGraphEdge(edge.kind);
      edges.push(drawEdge(linkKind, from, to, mindmapStrokeForGraphEdgeKind(edge.kind)));
    }
  } else {
    for (const task of tasks) {
      const parent = nodeById.get(task.task_id);
      if (!parent) continue;
      for (const childId of normalChildIds(task, byId)) {
        const child = nodeById.get(childId);
        if (!child || child.id === parent.id) continue;
        edges.push(drawEdge('child', parent, child, 'solid'));
      }
      for (const siblingId of siblingDependencyIds(task)) {
        const sibling = nodeById.get(siblingId);
        if (!sibling || sibling.id === parent.id) continue;
        edges.push(drawEdge('sibling', parent, sibling, 'dotted'));
      }
    }
  }
  return {
    width: minCanvasSpan,
    height: minCanvasSpan,
    nodes,
    edges,
  };
}

function separateUnpinned(nodes: MindmapNode[], tasks: ProjectTask[]): void {
  const pinned = new Set(tasks.filter((task) => taskHasPersistedMindmapPin(task)).map((task) => task.task_id));
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

function mindmapKindForGraphEdge(kind: TaskGraphEdge['kind']): MindmapLinkKind {
  if (kind === 'tree') return 'child';
  if (kind === 'fork' || kind === 'join' || kind === 'cycle' || kind === 'ordering') return kind;
  return 'sibling';
}

/**
 * Mindmap strokes:
 * - solid: parent→child flow (tree, fork, join) — outputs feed inputs on the dependency edge
 * - dashed: rework / back-control (cycle), e.g. critique fail → upstream work
 * - dotted: execution hints only (ordering, cross-graph sibling) — considered for scheduling/scope,
 *   not treated as an output→input dependency between the linked tasks
 */
export function mindmapStrokeForGraphEdgeKind(kind: TaskGraphEdge['kind']): MindmapLineStroke {
  if (kind === 'tree' || kind === 'fork' || kind === 'join') return 'solid';
  if (kind === 'cycle') return 'dashed';
  if (kind === 'ordering') return 'dotted';
  return 'dotted';
}

export function mindmapStrokeForLinkKind(kind: MindmapLinkKind): MindmapLineStroke {
  if (kind === 'child' || kind === 'project-root' || kind === 'fork' || kind === 'join') return 'solid';
  if (kind === 'cycle') return 'dashed';
  return 'dotted';
}

function drawEdge(
  kind: MindmapLinkKind,
  from: MindmapNode,
  to: MindmapNode,
  stroke: MindmapLineStroke,
): MindmapEdge {
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
    stroke,
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
  if (node.shape === 'decision') {
    const denom = Math.abs(ux) / halfWidth + Math.abs(uy) / halfHeight;
    const scale = denom > 0 ? 1 / denom : 0;
    return { x: node.x + ux * scale, y: node.y + uy * scale };
  }
  if (node.shape === 'architect') {
    const scaleX = ux === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(ux);
    const scaleY = uy === 0 ? Number.POSITIVE_INFINITY : (halfHeight * 0.92) / Math.abs(uy);
    const scale = Math.min(scaleX, scaleY);
    return { x: node.x + ux * scale, y: node.y + uy * scale };
  }
  const scaleX = ux === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(ux);
  const scaleY = uy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(uy);
  const scale = Math.min(scaleX, scaleY);
  return { x: node.x + ux * scale, y: node.y + uy * scale };
}
