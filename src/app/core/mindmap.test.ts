import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import {
  cardinalAnchor,
  layoutMindmap,
  mindmapNodesInWorldRect,
  normalizeWorldRect,
  pickCardinalEdge,
  pointerToWorld,
  positionConnectedNode,
} from './mindmap';

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
  it('points a solid arrow from the project to each root task', () => {
    const layout = layoutMindmap('Plan', [task('survey'), task('build', {}, 1)]);
    const solid = layout.edges.filter((edge) => !edge.dashed);
    expect(solid.map((edge) => edge.to).sort()).toEqual(['build', 'survey']);
    expect(solid.every((edge) => edge.from === 'project')).toBe(true);
    expect(layout.nodes.find((node) => node.id === 'project')?.kind).toBe('project');
  });

  it('draws a solid arrow from parent to child when the parent lists the child', () => {
    const survey = task('survey', { dependencies: ['build'] });
    const build = task('build');
    const layout = layoutMindmap('Plan', [survey, build]);
    const taskEdges = layout.edges.filter((edge) => !edge.dashed && edge.from !== 'project');
    expect(taskEdges).toEqual([expect.objectContaining({ from: 'survey', to: 'build', dashed: false })]);
    const project = layout.nodes.find((node) => node.id === 'project');
    const surveyNode = layout.nodes.find((node) => node.id === 'survey');
    const buildNode = layout.nodes.find((node) => node.id === 'build');
    expect(project && surveyNode && buildNode).toBeTruthy();
    const surveyDistance = Math.hypot(surveyNode!.x - project!.x, surveyNode!.y - project!.y);
    const buildDistance = Math.hypot(buildNode!.x - project!.x, buildNode!.y - project!.y);
    expect(buildDistance).toBeGreaterThan(surveyDistance);
  });

  it('draws a dashed one-way arrow for sibling dependencies', () => {
    const left = task('alpha', { sibling_dependencies: ['beta'] });
    const right = task('beta', {}, 1);
    const layout = layoutMindmap('Plan', [left, right]);
    const sibling = layout.edges.filter((edge) => edge.dashed);
    expect(sibling).toEqual([expect.objectContaining({ from: 'alpha', to: 'beta', dashed: true })]);
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
    const rect = { left: 10, top: 10, width: 800, height: 600 } as DOMRect;
    const world = pointerToWorld(110, 210, rect, 100, 50, 2);
    expect(world).toEqual({ x: 100, y: 125 });
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

  it('keeps a dragged task in place and rebalances the others', () => {
    const pinned = task('survey');
    pinned.map_x = 400;
    pinned.map_y = 500;
    const before = layoutMindmap('Plan', [pinned, task('notes', {}, 1)]);
    const after = layoutMindmap('Plan', [pinned, task('notes', {}, 1), task('build', {}, 2)]);
    const stayed = after.nodes.find((node) => node.id === 'survey');
    expect(stayed).toMatchObject({ x: 400, y: 500 });
    const notesBefore = before.nodes.find((node) => node.id === 'notes');
    const notesAfter = after.nodes.find((node) => node.id === 'notes');
    expect(notesBefore && notesAfter).toBeTruthy();
    expect(notesAfter!.x === notesBefore!.x && notesAfter!.y === notesBefore!.y).toBe(false);
  });
});
