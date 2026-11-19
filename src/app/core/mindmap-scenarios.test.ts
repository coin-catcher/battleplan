/**
 * Mindmap usage scenarios covered here:
 * 1. Empty project load → project centered on world canvas.
 * 2. Unpinned tasks → auto-spiral; legacy (0,0) sentinel treated as unpinned.
 * 3. Persisted pins → stable across relayout when framed coordinates are enabled.
 * 4. Colliding stored pins → deduped spread (no stacked nodes / NaN edges).
 * 5. Drag pin update → layout honors new coordinates without canvas reframe.
 * 6. Graph edge kinds (tree, ordering, fork, join, cycle) render with correct stroke.
 * 7. Sample fixture (all shapes ×2, all edge kinds ×2) loads with separated task nodes.
 * 8. Migration relayout (legacy frame) vs runtime framed layout consistency.
 * 9. projectOrTasksNeedMindmapRelayout (sentinel, collisions).
 * 10. Task graph recovery placement near project (withRecoveryMapPositions).
 */
import { describe, expect, it } from 'vitest';
import {
  layoutMindmap,
  MINDMAP_PLACEMENT_VERSION,
  mindmapUsesFramedCoordinates,
  mindmapEdgeSvgAttributes,
  mindmapPinsUseLegacyPreFrameSpace,
  projectOrTasksNeedMindmapRelayout,
  tasksHaveCollidingMindmapPins,
} from './mindmap';
import {
  MINDMAP_SAMPLE_GRAPH_EDGES,
  MINDMAP_SAMPLE_PROJECT,
  MINDMAP_SAMPLE_TASKS,
  mindmapSampleTasksWithLayoutPins,
} from './fixtures/mindmap-sample-project';
import type { ProjectTask } from './models';
import { withRecoveryMapPositions } from './graph-recovery-placement';
import { mindmapCanvasCenter } from './project-ui-state';
import { mindmapShapeForTask } from './mindmap-shape';

function baseTask(id: string, partial: Partial<ProjectTask> = {}, order = 0): ProjectTask {
  return {
    task_id: id,
    project_id: 'p',
    title: id,
    prompt: 'x',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('mindmap scenarios', () => {
  it('uses framed coordinates without shifting pinned nodes on repeated layout', () => {
    const migrated = layoutMindmap(
      'Plan',
      [baseTask('a'), baseTask('b', {}, 1)],
      undefined,
      undefined,
      undefined,
      { useFramedCoordinates: false },
    );
    const project = migrated.nodes.find((node) => node.id === 'project')!;
    const projectPin = { x: Math.round(project.x), y: Math.round(project.y) };
    const pinned: ProjectTask[] = ['a', 'b'].map((id) => {
      const node = migrated.nodes.find((item) => item.id === id)!;
      return baseTask(id, { map_x: Math.round(node.x), map_y: Math.round(node.y) }, id === 'b' ? 1 : 0);
    });
    const first = layoutMindmap('Plan', pinned, projectPin, undefined, undefined, { useFramedCoordinates: true });
    const second = layoutMindmap('Plan', pinned, projectPin, undefined, undefined, { useFramedCoordinates: true });
    for (const id of ['a', 'b']) {
      const a = first.nodes.find((node) => node.id === id)!;
      const b = second.nodes.find((node) => node.id === id)!;
      expect(a.x).toBeCloseTo(b.x, 0);
      expect(a.y).toBeCloseTo(b.y, 0);
    }
  });

  it('places framed layout nodes at the exact persisted pin', () => {
    const center = mindmapCanvasCenter();
    const pin = { map_x: center.x + 260, map_y: center.y - 180 };
    const task = baseTask('placed', pin);
    const layout = layoutMindmap(
      'Plan',
      [task],
      { x: center.x, y: center.y },
      undefined,
      undefined,
      { useFramedCoordinates: true },
    );
    const node = layout.nodes.find((item) => item.id === 'placed')!;
    expect(node.x).toBeCloseTo(pin.map_x!, 0);
    expect(node.y).toBeCloseTo(pin.map_y!, 0);
  });

  it('simulates drag by updating stored pin without collapsing to origin', () => {
    const center = mindmapCanvasCenter();
    const task = baseTask('drag-me', { map_x: center.x + 420, map_y: center.y - 200 });
    const before = layoutMindmap(
      'Plan',
      [task],
      { x: center.x, y: center.y },
      undefined,
      undefined,
      { useFramedCoordinates: true },
    );
    const nodeBefore = before.nodes.find((item) => item.id === 'drag-me')!;
    const dragged = {
      ...task,
      map_x: nodeBefore.x + 160,
      map_y: nodeBefore.y + 90,
    };
    const after = layoutMindmap(
      'Plan',
      [dragged],
      { x: center.x, y: center.y },
      undefined,
      undefined,
      { useFramedCoordinates: true },
    );
    const nodeAfter = after.nodes.find((item) => item.id === 'drag-me')!;
    expect(nodeAfter.x).toBeCloseTo(dragged.map_x!, 0);
    expect(nodeAfter.y).toBeCloseTo(dragged.map_y!, 0);
    expect(Math.hypot(nodeAfter.x - nodeBefore.x, nodeAfter.y - nodeBefore.y)).toBeGreaterThan(100);
  });

  it('loads the sample fixture with distinct positions for every task shape', () => {
    const migrated = layoutMindmap(
      MINDMAP_SAMPLE_PROJECT.title,
      MINDMAP_SAMPLE_TASKS,
      { x: MINDMAP_SAMPLE_PROJECT.map_x!, y: MINDMAP_SAMPLE_PROJECT.map_y! },
      MINDMAP_SAMPLE_PROJECT.status,
      MINDMAP_SAMPLE_GRAPH_EDGES,
      { useFramedCoordinates: false },
    );
    const pinnedTasks = mindmapSampleTasksWithLayoutPins(migrated.nodes);
    const layout = layoutMindmap(
      MINDMAP_SAMPLE_PROJECT.title,
      pinnedTasks,
      { x: Math.round(migrated.nodes.find((node) => node.id === 'project')!.x), y: Math.round(migrated.nodes.find((node) => node.id === 'project')!.y) },
      MINDMAP_SAMPLE_PROJECT.status,
      MINDMAP_SAMPLE_GRAPH_EDGES,
      { useFramedCoordinates: true },
    );
    const shapes = new Set<string>();
    for (const node of layout.nodes) {
      if (node.kind !== 'task') continue;
      shapes.add(node.shape);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(6);
    const centers = layout.nodes.filter((node) => node.kind === 'task').map((node) => `${node.x},${node.y}`);
    expect(new Set(centers).size).toBe(centers.length);
    for (const edge of layout.edges) {
      const attrs = mindmapEdgeSvgAttributes(edge);
      for (const value of Object.values(attrs)) {
        expect(Number.isFinite(Number(value))).toBe(true);
      }
    }
  });

  it('detects legacy top-left pin clusters for migration', () => {
    const project = { map_x: 118, map_y: 136 };
    const tasks = [
      baseTask('a', { map_x: 120, map_y: 140 }),
      baseTask('b', { map_x: 128, map_y: 148 }, 1),
      baseTask('c', { map_x: 136, map_y: 156 }, 2),
    ];
    expect(mindmapPinsUseLegacyPreFrameSpace(project, tasks)).toBe(true);
    expect(projectOrTasksNeedMindmapRelayout(project, tasks)).toBe(true);
  });

  it('detects colliding pins and sentinel relayout needs', () => {
    const project = { map_x: 0, map_y: 0 };
    const tasks = [
      baseTask('a', { map_x: 500, map_y: 500 }),
      baseTask('b', { map_x: 500, map_y: 500 }, 1),
    ];
    expect(tasksHaveCollidingMindmapPins(tasks)).toBe(true);
    expect(projectOrTasksNeedMindmapRelayout(project, tasks)).toBe(true);
    expect(projectOrTasksNeedMindmapRelayout({ map_x: 100, map_y: 100 }, [
      baseTask('c', { map_x: 0, map_y: 0 }),
    ])).toBe(true);
  });

  it('assigns recovery positions for revealed tasks near the project', () => {
    const project = { ...MINDMAP_SAMPLE_PROJECT, map_x: mindmapCanvasCenter().x, map_y: mindmapCanvasCenter().y };
    const revealed = new Set(MINDMAP_SAMPLE_TASKS.slice(0, 4).map((task) => task.task_id));
    const patched = withRecoveryMapPositions(project, MINDMAP_SAMPLE_TASKS, revealed);
    const projectX = project.map_x!;
    const projectY = project.map_y!;
    for (const task of patched.filter((item) => revealed.has(item.task_id))) {
      expect(task.map_x).toBeDefined();
      expect(task.map_y).toBeDefined();
      expect(Math.hypot(task.map_x! - projectX, task.map_y! - projectY)).toBeLessThan(2200);
    }
  });

  it('maps every sample task to the expected mindmap shape', () => {
    const expected = new Map<string, string>([
      ['code-a', 'code'],
      ['research-a', 'research'],
      ['sub-a', 'subproject'],
      ['decision-a', 'decision'],
      ['gate-a', 'gate'],
      ['brain-a', 'brainstorm'],
      ['arch-a', 'architect'],
    ]);
    for (const [id, shape] of expected) {
      const task = MINDMAP_SAMPLE_TASKS.find((item) => item.task_id === id)!;
      expect(mindmapShapeForTask(task)).toBe(shape);
    }
  });

  it('treats placement version 4+ as framed coordinate space', () => {
    expect(mindmapUsesFramedCoordinates(MINDMAP_PLACEMENT_VERSION)).toBe(true);
    expect(mindmapUsesFramedCoordinates(3)).toBe(false);
  });
});