import { describe, expect, it } from 'vitest';
import type { Project } from './models';
import type { ProjectTask } from './models';
import {
  dedupeTaskGraphEdges,
  graphEdgesForDisplay,
  recoverProjectTaskGraphFromStorage,
} from './task-graph-recovery';
import { layoutMindmap } from './mindmap';
import { repairProjectTaskGraph } from './task-graph';

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
    map_x: 120,
    map_y: 340,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function project(edges: Project['task_graph_edges']): Project {
  return {
    project_id: 'p1',
    title: 'P',
    initial_prompt: '',
    cursor_chat_link: '',
    dar: '',
    status: 'TODO',
    created_at: '',
    updated_at: '',
    task_graph_edges: edges,
  };
}

describe('task-graph-recovery', () => {
  it('recovers mindmap layout from storage when ordering forms an accidental cycle', () => {
    const a = task('a', { map_x: 100, map_y: 200, sibling_dependencies: ['c'] });
    const b = task('b', { map_x: 300, map_y: 200 });
    const c = task('c', { map_x: 200, map_y: 400, sibling_dependencies: ['a'] });
    const edges = [
      { edge_id: 'ordering:b->a', from_task_id: 'b', to_task_id: 'a', kind: 'ordering' as const },
      { edge_id: 'ordering:c->b', from_task_id: 'c', to_task_id: 'b', kind: 'ordering' as const },
      { edge_id: 'ordering:a->c', from_task_id: 'a', to_task_id: 'c', kind: 'ordering' as const },
    ];
    const recovered = recoverProjectTaskGraphFromStorage(project(edges), [a, b, c]);
    expect(recovered.issues[0]).toMatch(/Accidental dependency cycle/i);
    expect(recovered.tasks).toHaveLength(3);
    expect(recovered.project.task_graph_edges?.length).toBeGreaterThan(0);

    const displayEdges = graphEdgesForDisplay(recovered.project, recovered.tasks);
    const layout = layoutMindmap('P', recovered.tasks, undefined, undefined, displayEdges);
    expect(layout.nodes.filter((node) => node.kind === 'task')).toHaveLength(3);
    expect(layout.nodes.find((node) => node.id === 'a')).toMatchObject({ x: 100, y: 200 });
    expect(layout.edges.length).toBeGreaterThan(0);
  });

  it('does not throw when repair sees an accidental cycle', () => {
    const a = task('a', { sibling_dependencies: ['b'] });
    const b = task('b', { sibling_dependencies: ['a'] });
    const proj = project([
      { edge_id: 'ordering:a->b', from_task_id: 'a', to_task_id: 'b', kind: 'ordering' },
      { edge_id: 'ordering:b->a', from_task_id: 'b', to_task_id: 'a', kind: 'ordering' },
    ]);
    expect(() => repairProjectTaskGraph(proj, [a, b])).not.toThrow();
    const repaired = repairProjectTaskGraph(proj, [a, b]);
    expect(repaired.project.task_graph_validation_issue).toMatch(/Accidental/i);
  });

  it('dedupes edges by edge_id', () => {
    const edge = {
      edge_id: 'tree:a->b',
      from_task_id: 'a',
      to_task_id: 'b',
      kind: 'tree' as const,
    };
    expect(dedupeTaskGraphEdges([edge, edge])).toHaveLength(1);
  });
});