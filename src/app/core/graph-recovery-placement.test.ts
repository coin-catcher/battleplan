import { describe, expect, it } from 'vitest';
import type { Project, ProjectTask } from './models';
import {
  RECOVERY_LEGACY_COORDINATE_SCALE,
  applyRecoveryMapPositions,
  isNearProjectShape,
  scaledRecoveryCoordinatesIfFar,
  withRecoveryMapPositions,
} from './graph-recovery-placement';
import { mindmapCanvasCenter } from './project-ui-state';

function task(id: string, partial: Partial<ProjectTask> = {}): ProjectTask {
  return {
    task_id: id,
    project_id: 'p1',
    title: id,
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('graph-recovery-placement', () => {
  const center = mindmapCanvasCenter();
  const project: Project = {
    project_id: 'p1',
    title: 'P',
    initial_prompt: '',
    cursor_chat_link: '',
    dar: '',
    status: 'TODO',
    created_at: '',
    updated_at: '',
    map_x: center.x,
    map_y: center.y,
  };

  it('scales distant stored coordinates down by 4', () => {
    const far = task('far', { map_x: center.x + 4000, map_y: center.y + 4000 });
    const scaled = scaledRecoveryCoordinatesIfFar(far, center.x, center.y);
    expect(scaled?.x).toBe((center.x + 4000) / RECOVERY_LEGACY_COORDINATE_SCALE);
  });

  it('places revealed tasks near the project and separates overlaps', () => {
    const pile = task('a', { map_x: center.x + 9000, map_y: center.y + 9000 });
    const pileB = task('b', { map_x: center.x + 9000, map_y: center.y + 9000 });
    const revealed = new Set(['a', 'b']);
    const placed = withRecoveryMapPositions(project, [pile, pileB], revealed);
    const nodeA = placed.find((item) => item.task_id === 'a')!;
    const nodeB = placed.find((item) => item.task_id === 'b')!;
    expect(isNearProjectShape(nodeA.map_x!, nodeA.map_y!, center.x, center.y)).toBe(true);
    expect(isNearProjectShape(nodeB.map_x!, nodeB.map_y!, center.x, center.y)).toBe(true);
    expect(Math.hypot(nodeA.map_x! - nodeB.map_x!, nodeA.map_y! - nodeB.map_y!)).toBeGreaterThan(40);
  });

  it('applyRecoveryMapPositions patches only revealed tasks', () => {
    const hidden = task('hidden', { map_x: 1, map_y: 1 });
    const far = task('far', { map_x: center.x + 8000, map_y: center.y + 8000 });
  const out = applyRecoveryMapPositions(project, [hidden, far], new Set(['far']));
    expect(out.find((item) => item.task_id === 'hidden')).toMatchObject({ map_x: 1, map_y: 1 });
    const moved = out.find((item) => item.task_id === 'far')!;
    expect(isNearProjectShape(moved.map_x!, moved.map_y!, center.x, center.y)).toBe(true);
  });
});