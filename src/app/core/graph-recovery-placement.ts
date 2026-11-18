import { PROJECT_RADIUS, TASK_HEIGHT, TASK_WIDTH } from './mindmap';
import { mindmapCanvasCenter } from './project-ui-state';
import type { Project, ProjectTask } from './models';

type Rect = { x: number; y: number; width: number; height: number };

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

/** Assign map_x/map_y near the project when missing; avoid overlapping revealed shapes. */
export function withRecoveryMapPositions(
  project: Project,
  tasks: ProjectTask[],
  revealed: Set<string>,
): ProjectTask[] {
  const center = mindmapCanvasCenter();
  const projectX = Number.isFinite(project.map_x) ? project.map_x! : center.x;
  const projectY = Number.isFinite(project.map_y) ? project.map_y! : center.y;
  const placed: Rect[] = [{
    x: projectX,
    y: projectY,
    width: PROJECT_RADIUS * 2,
    height: PROJECT_RADIUS * 2,
  }];

  for (const task of tasks) {
    if (!revealed.has(task.task_id)) continue;
    if (Number.isFinite(task.map_x) && Number.isFinite(task.map_y)) {
      placed.push(taskRect(task));
    }
  }

  return tasks.map((task) => {
    if (!revealed.has(task.task_id)) return task;
    if (Number.isFinite(task.map_x) && Number.isFinite(task.map_y)) return task;

    const radiusStart = PROJECT_RADIUS + 80;
    let angle = 0;
    let spot = { x: projectX + radiusStart, y: projectY };
    const candidate = taskRect({ ...task, map_x: spot.x, map_y: spot.y });
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const rect = { ...candidate, x: spot.x, y: spot.y };
      if (!placed.some((other) => overlaps(rect, other))) {
        placed.push(rect);
        return { ...task, map_x: Math.round(spot.x), map_y: Math.round(spot.y) };
      }
      angle += Math.PI / 6;
      const radius = radiusStart + Math.floor(attempt / 6) * 56;
      spot = {
        x: projectX + Math.cos(angle) * radius,
        y: projectY + Math.sin(angle) * radius,
      };
    }
    placed.push({ ...candidate, x: spot.x, y: spot.y });
    return { ...task, map_x: Math.round(spot.x), map_y: Math.round(spot.y) };
  });
}