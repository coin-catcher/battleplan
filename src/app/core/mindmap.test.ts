import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  applyMindmapCanvasFrame,
  cardinalAnchor,
  layoutMindmap,
  MINDMAP_CANVAS_MARGIN_PX,
  mindmapNodesInWorldRect,
  mindmapNodesWorldExtent,
  normalizeWorldRect,
  pickCardinalEdge,
  pickConnectHoverSide,
  pointerToWorld,
  positionConnectedNode,
} from './mindmap';
import type { MindmapNode } from './mindmap';
import { mindmapCanvasCenter, mindmapCanvasWorldSpan } from './project-ui-state';

function task(id: string, partial: Partial<ProjectTask> = {}, order = 0): ProjectTask {
  return {
    task_id: id,
    project_id: 'project',
    title: id,
    prompt: 'Do the work.',
    dependencies: partial.dependencies ?? [],
    sibling_dependencies: partial.sibling_dependencies,
    status: 'TODO',
    output_type: 'code',
    order,
    created_at: '2026-09-30T12:00:00.000Z',
    updated_at: '2026-09-30T12:00:00.000Z',
    ...partial,
  };
}

describe('mindmap', () => {
  it('uses a fixed half-viewport world canvas with the project centered', () => {
    const layout = layoutMindmap('Plan', []);
    const span = mindmapCanvasWorldSpan();
    expect(layout.width).toBe(span);
    expect(layout.height).toBe(span);
    const project = layout.nodes.find((node) => node.id === 'project')!;
    const center = mindmapCanvasCenter();
    expect(project.x).toBeCloseTo(center.x, 0);
    expect(project.y).toBeCloseTo(center.y, 0);
    const extent = mindmapNodesWorldExtent(layout.nodes);
    expect(extent.minX).toBeGreaterThanOrEqual(MINDMAP_CANVAS_MARGIN_PX - 1);
    expect(extent.maxX).toBeLessThanOrEqual(span - MINDMAP_CANVAS_MARGIN_PX + 1);
  });

  it('translates the graph as a rigid body onto the canvas', () => {
    const tasks = [task('a'), task('b', {}, 1)];
    const before = layoutMindmap('Plan', tasks);
    const projectBefore = before.nodes.find((node) => node.id === 'project')!;
    const aBefore = before.nodes.find((node) => node.id === 'a')!;
    const offsetX = aBefore.x - projectBefore.x;
    const offsetY = aBefore.y - projectBefore.y;
    const nodes = before.nodes.map((node) => ({ ...node }));
    nodes.forEach((node) => {
      node.x += 12_000;
      node.y -= 8_000;
    });
    const span = mindmapCanvasWorldSpan();
    applyMindmapCanvasFrame(nodes, span);
    const projectAfter = nodes.find((node) => node.id === 'project')!;
    const aAfter = nodes.find((node) => node.id === 'a')!;
    expect(projectAfter.x).toBeCloseTo(span / 2, 0);
    expect(aAfter.x - projectAfter.x).toBeCloseTo(offsetX, 0);
    expect(aAfter.y - projectAfter.y).toBeCloseTo(offsetY, 0);
  });

  it('points a solid arrow from the project to each root task', () => {
    const layout = layoutMindmap('Plan', [task('survey'), task('build', {}, 1)]);
    const solid = layout.edges.filter((edge) => edge.stroke === 'solid');
    expect(solid.map((edge) => edge.to).sort()).toEqual(['build', 'survey']);
    expect(solid.every((edge) => edge.from === 'project')).toBe(true);
    expect(layout.nodes.find((node) => node.id === 'project')?.kind).toBe('project');
  });

  it('draws a solid arrow from parent to child when the parent lists the child', () => {
    const survey = task('survey', { dependencies: ['build'] });
    const build = task('build');
    const layout = layoutMindmap('Plan', [survey, build]);
    const taskEdges = layout.edges.filter((edge) => edge.stroke === 'solid' && edge.from !== 'project');
    expect(taskEdges).toEqual([expect.objectContaining({ from: 'survey', to: 'build', stroke: 'solid' })]);
    const project = layout.nodes.find((node) => node.id === 'project');
    const surveyNode = layout.nodes.find((node) => node.id === 'survey');
    const buildNode = layout.nodes.find((node) => node.id === 'build');
    expect(project && surveyNode && buildNode).toBeTruthy();
    const surveyDistance = Math.hypot(surveyNode!.x - project!.x, surveyNode!.y - project!.y);
    const buildDistance = Math.hypot(buildNode!.x - project!.x, buildNode!.y - project!.y);
    expect(buildDistance).toBeGreaterThan(surveyDistance);
  });

  it('draws a dotted one-way arrow for sibling dependencies', () => {
    const left = task('alpha', { sibling_dependencies: ['beta'] });
    const right = task('beta', {}, 1);
    const layout = layoutMindmap('Plan', [left, right]);
    const sibling = layout.edges.filter((edge) => edge.stroke === 'dotted');
    expect(sibling).toEqual([expect.objectContaining({ from: 'alpha', to: 'beta', stroke: 'dotted' })]);
  });

  it('uses solid for tree/fork/join, dashed for cycles, dotted for ordering only', () => {
    const work = task('work');
    const critique = task('critique', { output_type: 'research', node_kind: 'critique' });
    const graphEdges = [
      {
        edge_id: 'tree:work->critique',
        from_task_id: 'work',
        to_task_id: 'critique',
        kind: 'tree' as const,
      },
      {
        edge_id: 'cycle:critique->work',
        from_task_id: 'critique',
        to_task_id: 'work',
        kind: 'cycle' as const,
        break_condition: 'human:REVIEW',
      },
      {
        edge_id: 'ordering:x->work',
        from_task_id: 'x',
        to_task_id: 'work',
        kind: 'ordering' as const,
      },
      {
        edge_id: 'fork:work->a',
        from_task_id: 'work',
        to_task_id: 'a',
        kind: 'fork' as const,
      },
      {
        edge_id: 'join:b->work',
        from_task_id: 'b',
        to_task_id: 'work',
        kind: 'join' as const,
      },
    ];
    const extra = task('x', {}, 2);
    const a = task('a', {}, 3);
    const b = task('b', {}, 4);
    const layout = layoutMindmap('Plan', [work, critique, extra, a, b], undefined, undefined, graphEdges);
    expect(layout.edges.find((edge) => edge.kind === 'cycle')).toMatchObject({
      from: 'critique',
      to: 'work',
      stroke: 'dashed',
    });
    expect(layout.edges.find((edge) => edge.kind === 'ordering')).toMatchObject({
      stroke: 'dotted',
    });
    expect(layout.edges.find((edge) => edge.kind === 'child')).toMatchObject({
      stroke: 'solid',
    });
    expect(layout.edges.find((edge) => edge.kind === 'fork')).toMatchObject({
      stroke: 'solid',
    });
    expect(layout.edges.find((edge) => edge.kind === 'join')).toMatchObject({
      stroke: 'solid',
    });
  });

  it('moves an unpinned root when another root is added', () => {
    const alone = layoutMindmap('Plan', [task('survey')]);
    const pair = layoutMindmap('Plan', [task('survey'), task('notes', {}, 1)]);
    const before = alone.nodes.find((node) => node.id === 'survey');
    const after = pair.nodes.find((node) => node.id === 'survey');
    expect(before && after).toBeTruthy();
    expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(40);
  });

  it('places cardinal anchors on project circle and task rectangle', () => {
    const layout = layoutMindmap('Plan', [task('survey')]);
    const project = layout.nodes.find((node) => node.id === 'project')!;
    const survey = layout.nodes.find((node) => node.id === 'survey')!;
    const north = cardinalAnchor(project, 'north');
    expect(north.y).toBeLessThan(project.y);
    expect(north.x).toBeCloseTo(project.x, 0);
    const east = cardinalAnchor(survey, 'east');
    expect(east.x).toBeGreaterThan(survey.x);
  });

  it('picks the nearest cardinal edge within threshold', () => {
    const layout = layoutMindmap('Plan', []);
    const project = layout.nodes.find((node) => node.id === 'project')!;
    const northAnchor = cardinalAnchor(project, 'north');
    expect(pickCardinalEdge(project, northAnchor.x, northAnchor.y, 24)).toBe('north');
    expect(pickCardinalEdge(project, project.x + 500, project.y, 24)).toBeNull();
  });

  it('offsets a connected node outward from the source', () => {
    const layout = layoutMindmap('Plan', []);
    const project = layout.nodes.find((node) => node.id === 'project')!;
    const placed = positionConnectedNode(project, 'east', 80);
    expect(placed.x).toBeGreaterThan(project.x);
    expect(placed.y).toBeCloseTo(project.y, 0);
  });

  it('converts pointer coordinates to world space', () => {
    const rect = { left: 10, top: 10 };
    const world = pointerToWorld(110, 210, rect, 100, 50, 2);
    expect(world).toEqual({ x: 100, y: 125 });
  });

  it('anchors decision nodes on the diamond border', () => {
    const layout = layoutMindmap('Plan', [
      task('critique', { output_type: 'research', node_kind: 'critique' }),
    ]);
    const node = layout.nodes.find((item) => item.id === 'critique')!;
    expect(node.shape).toBe('decision');
    const east = cardinalAnchor(node, 'east');
    expect(east.x).toBeCloseTo(node.x + node.width / 2, 0);
    expect(east.y).toBeCloseTo(node.y, 0);
  });

  it('selects nodes whose bounds intersect a world rectangle', () => {
    const layout = layoutMindmap('Plan', [task('alpha'), task('beta', {}, 1)]);
    const alpha = layout.nodes.find((node) => node.id === 'alpha')!;
    const beta = layout.nodes.find((node) => node.id === 'beta')!;
    const taskNodes = layout.nodes.filter((node) => node.kind === 'task');
    const box = normalizeWorldRect(alpha.x, alpha.y, beta.x, beta.y);
    expect(mindmapNodesInWorldRect(taskNodes, box).sort()).toEqual(['alpha', 'beta']);
    const tiny = normalizeWorldRect(alpha.x, alpha.y, alpha.x + 1, alpha.y + 1);
    expect(mindmapNodesInWorldRect(taskNodes, tiny)).toEqual(['alpha']);
  });

  it('keeps a pinned offset from the project and rebalances unpinned tasks', () => {
    const pinned = task('survey');
    pinned.map_x = 400;
    pinned.map_y = 500;
    const before = layoutMindmap('Plan', [pinned, task('notes', {}, 1)]);
    const after = layoutMindmap('Plan', [pinned, task('notes', {}, 1), task('build', {}, 2)]);
    const projectAfter = after.nodes.find((node) => node.id === 'project')!;
    const stayed = after.nodes.find((node) => node.id === 'survey');
    const projectBefore = before.nodes.find((node) => node.id === 'project')!;
    const stayedBefore = before.nodes.find((node) => node.id === 'survey')!;
    expect(stayed!.x - projectAfter.x).toBeCloseTo(stayedBefore!.x - projectBefore.x, 0);
    expect(stayed!.y - projectAfter.y).toBeCloseTo(stayedBefore!.y - projectBefore.y, 0);
    const notesBefore = before.nodes.find((node) => node.id === 'notes');
    const notesAfter = after.nodes.find((node) => node.id === 'notes');
    expect(notesBefore && notesAfter).toBeTruthy();
    expect(notesAfter!.x === notesBefore!.x && notesAfter!.y === notesBefore!.y).toBe(false);
  });

  it('detects connect hover band on task sides', () => {
    const node: MindmapNode = {
      id: 't1',
      kind: 'task',
      shape: 'code',
      label: 'Task',
      status: 'TODO',
      x: 200,
      y: 200,
      width: 156,
      height: 64,
    };
    const eastMidY = node.y;
    const eastOutsideX = node.x + node.width / 2 + 6;
    expect(pickConnectHoverSide(node, eastOutsideX, eastMidY, 10)).toBe('east');
    expect(pickConnectHoverSide(node, node.x, node.y, 10)).toBe(null);
  });
});
