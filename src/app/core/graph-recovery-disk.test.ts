import { describe, expect, it } from 'vitest';
import type { Project } from './models';
import type { ProjectTask } from './models';
import { buildTaskRecoveryDiskSnapshot, resolveTaskIdsInRecoverySnapshot } from './graph-recovery-disk';

function task(id: string): ProjectTask {
  return {
    task_id: id,
    project_id: 'p1',
    title: 'Alpha',
    prompt: '',
    dependencies: [],
    status: 'TODO',
    output_type: 'code',
    order: 0,
    created_at: '',
    updated_at: '',
  };
}

describe('graph-recovery-disk', () => {
  it('resolves UUIDs to titles in snapshot text', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const text = resolveTaskIdsInRecoverySnapshot(
      `depends on ${uuid}`,
      [task(uuid)],
    );
    expect(text).toContain('Alpha');
    expect(text).toContain(`[${uuid}]`);
  });

  it('builds a JSON snapshot with positions and edges', () => {
    const child = task('child-id');
    const project: Project = {
      project_id: 'p1',
      title: 'P',
      initial_prompt: '',
      cursor_chat_link: '',
      dar: '',
      status: 'TODO',
      created_at: '',
      updated_at: '',
      task_graph_edges: [
        {
          edge_id: 'tree:root->child',
          from_task_id: 'root-id',
          to_task_id: 'child-id',
          kind: 'tree',
        },
      ],
    };
    child.map_x = 100;
    child.map_y = 200;
    const snapshot = buildTaskRecoveryDiskSnapshot(project, child, [
      task('root-id'),
      child,
    ]);
    expect(snapshot).toContain('map_x');
    expect(snapshot).toContain('incident_graph_edges');
  });
});