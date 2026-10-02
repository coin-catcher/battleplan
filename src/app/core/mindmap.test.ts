import { describe, expect, it } from 'vitest';
import type { ProjectTask } from './models';
import { layoutMindmap } from './mindmap';

function task(id: string, dependencies: string[], order = 0): ProjectTask {
  return {
    task_id: id,
    project_id: 'project',
    title: id,
    prompt: 'Do the work.',
    dependencies,
    status: 'TODO',
    output_type: 'code',
    order,
    created_at: '2026-09-30T12:00:00.000Z',
    updated_at: '2026-09-30T12:00:00.000Z',
  };
}

describe('mindmap', () => {
  it('points a solid arrow from the project to each root task', () => {
    const layout = layoutMindmap('Plan', [task('survey', []), task('build', [], 1)]);
    const solid = layout.edges.filter((edge) => !edge.dashed);
    expect(solid.map((edge) => edge.to).sort()).toEqual(['build', 'survey']);
    expect(solid.every((edge) => edge.from === 'project')).toBe(true);
    expect(layout.nodes.find((node) => node.id === 'project')?.kind).toBe('project');
  });

  it('draws a dashed arrow from a dependency to the task that depends on it', () => {
    const layout = layoutMindmap('Plan', [task('survey', []), task('build', ['survey'], 1)]);
    const dashed = layout.edges.filter((edge) => edge.dashed);
    expect(dashed).toEqual([expect.objectContaining({ from: 'survey', to: 'build', dashed: true })]);
    expect(layout.edges.some((edge) => edge.to === 'build' && !edge.dashed)).toBe(false);
    const project = layout.nodes.find((node) => node.id === 'project');
    const survey = layout.nodes.find((node) => node.id === 'survey');
    const build = layout.nodes.find((node) => node.id === 'build');
    expect(project && survey && build).toBeTruthy();
    const surveyDistance = Math.hypot(survey!.x - project!.x, survey!.y - project!.y);
    const buildDistance = Math.hypot(build!.x - project!.x, build!.y - project!.y);
    expect(buildDistance).toBeGreaterThan(surveyDistance);
  });

  it('moves an unpinned root when another root is added', () => {
    const alone = layoutMindmap('Plan', [task('survey', [])]);
    const pair = layoutMindmap('Plan', [task('survey', []), task('notes', [], 1)]);
    const before = alone.nodes.find((node) => node.id === 'survey');
    const after = pair.nodes.find((node) => node.id === 'survey');
    expect(before && after).toBeTruthy();
    expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(40);
  });

  it('keeps a dragged task in place and rebalances the others', () => {
    const pinned = task('survey', []);
    pinned.map_x = 400;
    pinned.map_y = 500;
    const before = layoutMindmap('Plan', [pinned, task('notes', [], 1)]);
    const after = layoutMindmap('Plan', [pinned, task('notes', [], 1), task('build', [], 2)]);
    const stayed = after.nodes.find((node) => node.id === 'survey');
    expect(stayed).toMatchObject({ x: 400, y: 500 });
    const notesBefore = before.nodes.find((node) => node.id === 'notes');
    const notesAfter = after.nodes.find((node) => node.id === 'notes');
    expect(notesBefore && notesAfter).toBeTruthy();
    expect(notesAfter!.x === notesBefore!.x && notesAfter!.y === notesBefore!.y).toBe(false);
  });
});
