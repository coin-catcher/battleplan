import { describe, expect, it } from 'vitest';
import type { Project, ProjectTask } from './models';
import { mindmapCanvasCenter } from './project-ui-state';
import { hasAnyFramedWorldTaskPin, LEGACY_MINDMAP_PIN_MAX } from './mindmap';
import {
  computeMindmapPlacementPatch,
  layoutNodePositionAfterDragCommit,
  mindmapDragDeltaWorld,
  shouldApplyFramedMindmapLayout,
  worldPointAfterDrag,
} from './mindmap-drag-pipeline';
import { layoutMindmapOptionsForProject } from './mindmap';

function task(id: string, partial: Partial<ProjectTask> = {}): ProjectTask {
  return {
    task_id: id,
    project_id: 'p',
    title: id,
    prompt: 'x',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function project(partial: Partial<Project> = {}): Project {
  return {
    project_id: 'p',
    title: 'Plan',
    initial_prompt: 'x',
    cursor_chat_link: '',
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('mindmap drag pipeline', () => {
  it('converts pointer movement to world delta using zoom', () => {
    expect(mindmapDragDeltaWorld(100, 100, 150, 130, 0.5)).toEqual({ dx: 100, dy: 60 });
    expect(mindmapDragDeltaWorld(0, 0, 40, 0, 2)).toEqual({ dx: 20, dy: 0 });
  });

  it('applies drag delta to layout origin', () => {
    const next = worldPointAfterDrag(5000, 5100, { dx: 120, dy: -80 }, 4);
    expect(next.dragged).toBe(true);
    expect(next.x).toBe(5120);
    expect(next.y).toBe(5020);
  });

  it('detects a single framed world pin among legacy siblings', () => {
    const tasks = [
      task('a', { map_x: 120, map_y: 130 }),
      task('b', { map_x: 128, map_y: 130 }),
      task('c', { map_x: LEGACY_MINDMAP_PIN_MAX + 800, map_y: LEGACY_MINDMAP_PIN_MAX + 700 }),
    ];
    expect(hasAnyFramedWorldTaskPin(tasks)).toBe(true);
  });

  it('keeps framed layout after drag when only one task has world coordinates', () => {
    const center = mindmapCanvasCenter();
    const tasks = [
      task('legacy', { map_x: 120, map_y: 140 }),
      task('moved', { map_x: center.x + 400, map_y: center.y - 200 }),
    ];
    const proj = project({ map_x: 118, map_y: 136, mindmap_placement_version: 3 });
    const options = layoutMindmapOptionsForProject(proj, tasks);
    expect(shouldApplyFramedMindmapLayout(proj, tasks, options, false)).toBe(true);
    expect(shouldApplyFramedMindmapLayout(proj, tasks, options, true)).toBe(true);
  });

  it('layout after drag commit matches committed coordinates (no snap-back)', () => {
    const center = mindmapCanvasCenter();
    const dragged = task('moved', { map_x: center.x + 280, map_y: center.y + 190 });
    const legacy = task('legacy', { map_x: 120, map_y: 140 });
    const proj = project({
      map_x: center.x,
      map_y: center.y,
      mindmap_placement_version: 4,
    });
    const pos = layoutNodePositionAfterDragCommit(
      proj,
      [legacy, dragged],
      'moved',
      dragged.map_x!,
      dragged.map_y!,
    );
    expect(pos?.x).toBeCloseTo(dragged.map_x!, 0);
    expect(pos?.y).toBeCloseTo(dragged.map_y!, 0);
  });

  it('computes a version-only patch when pins are already framed', () => {
    const center = mindmapCanvasCenter();
    const tasks = [
      task('a', { map_x: center.x + 400, map_y: center.y }),
      task('b', { map_x: center.x - 300, map_y: center.y + 200 }, 1),
    ];
    const proj = project({
      map_x: center.x,
      map_y: center.y,
      mindmap_placement_version: 3,
    });
    const patch = computeMindmapPlacementPatch(proj, tasks);
    expect(patch?.tasks).toEqual([]);
    expect(patch?.project.mindmap_placement_version).toBe(4);
  });

  it('computes a migration patch that moves legacy piles into framed world space', () => {
    const tasks = [
      task('a', { map_x: 120, map_y: 140 }),
      task('b', { map_x: 128, map_y: 148 }),
      task('c', { map_x: 136, map_y: 156 }),
    ];
    const legacyProject = project({ map_x: 118, map_y: 136, mindmap_placement_version: 3 });
    const patch = computeMindmapPlacementPatch(legacyProject, tasks);
    expect(patch).toBeTruthy();
    expect(patch!.project.mindmap_placement_version).toBe(4);
    expect(patch!.project.map_x).toBeGreaterThan(LEGACY_MINDMAP_PIN_MAX);
    expect(patch!.tasks.length).toBe(3);
    expect(patch!.tasks.every((row) => (row.map_x ?? 0) > LEGACY_MINDMAP_PIN_MAX)).toBe(true);
    const unique = new Set(patch!.tasks.map((row) => `${row.map_x},${row.map_y}`));
    expect(unique.size).toBe(3);
  });
});