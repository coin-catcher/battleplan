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
    const survey = layout.nodes.find((node) => node.id === 'survey');
    const build = layout.nodes.find((node) => node.id === 'build');
    expect(survey && build).toBeTruthy();
    const surveyDistance = Math.hypot(survey!.x - layout.width / 2, survey!.y - layout.height / 2);
    const buildDistance = Math.hypot(build!.x - layout.width / 2, build!.y - layout.height / 2);
    expect(buildDistance).toBeGreaterThan(surveyDistance);
  });
});
