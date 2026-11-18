import { PROJECT_RADIUS, TASK_HEIGHT, TASK_WIDTH } from './mindmap';
import { mindmapCanvasCenter } from './project-ui-state';
import type { Project, ProjectTask } from './models';

type Rect = { x: number; y: number; width: number; height: number };

/** Max distance from project center for a stored pin to count as “near” the project node. */
export const RECOVERY_NEAR_PROJECT_MAX_DISTANCE = 560;
/** Scale divisor for legacy pins saved before the world canvas resize. */
export const RECOVERY_LEGACY_COORDINATE_SCALE = 4;

function overlaps(a: Rect, b: Rect, gap = 28): boolean {
  const halfA = { w: a.width / 2 + gap, h: a.height / 2 + gap };
  const halfB = { w: b.width / 2 + gap, h: b.height / 2 + gap };
  return Math.abs(a.x - b.x) < halfA.w + halfB.w && Math.abs(a.y - b.y) < halfA.h + halfB.h;
}

function taskRect(task: ProjectTask, defaultW = TASK_WIDTH, defaultH = TASK_HEIGHT): Rect {
  return {
    x: task.map_x ?? 0,
    y: task.map_y ?? 0,
    width: defaultW,
    height: defaultH,
  };
}

function projectCenter(project: Project): { x: number; y: number } {
  const center = mindmapCanvasCenter();
  return {
    x: Number.isFinite(project.map_x) ? project.map_x! : center.x,
    y: Number.isFinite(project.map_y) ? project.map_y! : center.y,
  };
}

export function isNearProjectShape(
  taskX: number,
  taskY: number,
  projectX: number,
  projectY: number,
  maxDistance = RECOVERY_NEAR_PROJECT_MAX_DISTANCE,
): boolean {
  const dx = taskX - projectX;
  const dy = taskY - projectY;
  return Math.hypot(dx, dy) <= maxDistance;
}

/** Scale down distant stored coordinates (pre–world-canvas pins). */
export function scaledRecoveryCoordinatesIfFar(
  task: ProjectTask,
  projectX: number,
  projectY: number,
): { x: number; y: number } | null {
  if (!Number.isFinite(task.map_x) || !Number.isFinite(task.map_y)) return null;
  let x = task.map_x!;
  let y = task.map_y!;
  if (isNearProjectShape(x, y, projectX, projectY)) {
    return { x, y };
  }
  x /= RECOVERY_LEGACY_COORDINATE_SCALE;
  y /= RECOVERY_LEGACY_COORDINATE_SCALE;
  return { x, y };
}

function spiralPlacementNearProject(
  projectX: number,
  projectY: number,
  placed: Rect[],
  start?: { x: number; y: number },
): { x: number; y: number } {
  const radiusStart = PROJECT_RADIUS + 80;
  let angle = start
    ? Math.atan2(start.y - projectY, start.x - projectX)
    : 0;
  let spot = start ?? { x: projectX + radiusStart, y: projectY };
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const rect: Rect = {
      x: spot.x,
      y: spot.y,
      width: TASK_WIDTH,
      height: TASK_HEIGHT,
    };
    if (!placed.some((other) => overlaps(rect, other))) {
      return spot;
    }
    angle += Math.PI / 6;
    const radius = radiusStart + Math.floor(attempt / 6) * 56;
    spot = {
      x: projectX + Math.cos(angle) * radius,
      y: projectY + Math.sin(angle) * radius,
    };
  }
  return spot;
}

function placeRevealedTask(
  task: ProjectTask,
  projectX: number,
  projectY: number,
  placed: Rect[],
): { task: ProjectTask; rect: Rect } {
  const scaled = scaledRecoveryCoordinatesIfFar(task, projectX, projectY);
  let preferred = scaled && isNearProjectShape(scaled.x, scaled.y, projectX, projectY)
    ? scaled
    : undefined;
  const spot = spiralPlacementNearProject(projectX, projectY, placed, preferred);
  const next = {
    ...task,
    map_x: Math.round(spot.x),
    map_y: Math.round(spot.y),
  };
  const rect = taskRect(next);
  return { task: next, rect };
}

/**
 * Assign map_x/map_y near the project for revealed tasks: scale far legacy pins, then de-overlap.
 */
export function withRecoveryMapPositions(
  project: Project,
  tasks: ProjectTask[],
  revealed: Set<string>,
): ProjectTask[] {
  const { x: projectX, y: projectY } = projectCenter(project);
  const placed: Rect[] = [{
    x: projectX,
    y: projectY,
    width: PROJECT_RADIUS * 2,
    height: PROJECT_RADIUS * 2,
  }];

  return tasks.map((task) => {
    if (!revealed.has(task.task_id)) return task;

    const farStored = Number.isFinite(task.map_x)
      && Number.isFinite(task.map_y)
      && !isNearProjectShape(task.map_x!, task.map_y!, projectX, projectY);
    const needsPlacement = !Number.isFinite(task.map_x)
      || !Number.isFinite(task.map_y)
      || farStored;

    if (!needsPlacement) {
      const rect = taskRect(task);
      if (!placed.some((other) => overlaps(rect, other))) {
        placed.push(rect);
        return task;
      }
    }

    const { task: next, rect } = placeRevealedTask(task, projectX, projectY, placed);
    placed.push(rect);
    return next;
  });
}

/** Persist recovery pins for all revealed tasks (returns tasks with updated coordinates). */
export function applyRecoveryMapPositions(
  project: Project,
  tasks: ProjectTask[],
  revealed: Set<string>,
): ProjectTask[] {
  if (revealed.size === 0) return tasks;
  const revealedList = new Set(revealed);
  const patched = withRecoveryMapPositions(project, tasks, revealedList);
  const byId = new Map(patched.map((task) => [task.task_id, task]));
  return tasks.map((task) => byId.get(task.task_id) ?? task);
}