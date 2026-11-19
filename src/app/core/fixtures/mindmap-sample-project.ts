import type { Project, ProjectTask } from '../models';
import type { TaskGraphEdge } from '../task-graph';
import { mindmapCanvasCenter } from '../project-ui-state';
import { MINDMAP_PLACEMENT_VERSION } from '../mindmap';

const PROJECT_ID = 'mindmap-sample-project';
const NOW = '2026-11-19T12:00:00.000Z';

function task(
  id: string,
  partial: Partial<ProjectTask> = {},
  order = 0,
): ProjectTask {
  return {
    task_id: id,
    project_id: PROJECT_ID,
    title: id,
    prompt: `Work for ${id}.`,
    dependencies: partial.dependencies ?? [],
    sibling_dependencies: partial.sibling_dependencies,
    status: partial.status ?? 'TODO',
    output_type: partial.output_type ?? 'code',
    node_kind: partial.node_kind,
    order,
    created_at: NOW,
    updated_at: NOW,
    map_x: partial.map_x,
    map_y: partial.map_y,
    ...partial,
  };
}

/** Two tasks per mindmap shape (code, research, subproject, decision, gate, brainstorm, architect). */
export const MINDMAP_SAMPLE_TASKS: ProjectTask[] = [
  task('code-a', { output_type: 'execute' }, 0),
  task('code-b', { output_type: 'add_workflow' }, 1),
  task('research-a', { output_type: 'research' }, 2),
  task('research-b', { output_type: 'research', node_kind: 'brainstorm' }, 3),
  task('sub-a', { output_type: 'subproject' }, 4),
  task('sub-b', { output_type: 'subproject' }, 5),
  task('decision-a', { output_type: 'research', node_kind: 'critique' }, 6),
  task('decision-b', { output_type: 'research', node_kind: 'decision' }, 7),
  task('gate-a', { output_type: 'code', node_kind: 'gate' }, 8),
  task('gate-b', { output_type: 'code', node_kind: 'gate' }, 9),
  task('brain-a', { output_type: 'research', node_kind: 'brainstorm' }, 10),
  task('brain-b', { output_type: 'research', node_kind: 'fog' }, 11),
  task('arch-a', { output_type: 'code', node_kind: 'architect' }, 12),
  task('arch-b', { output_type: 'code', node_kind: 'architect' }, 13),
];

/** Two edges per {@link TaskGraphEdge} kind (tree, ordering, fork, join, cycle). */
export const MINDMAP_SAMPLE_GRAPH_EDGES: TaskGraphEdge[] = [
  {
    edge_id: 'tree:code-a->code-b',
    from_task_id: 'code-a',
    to_task_id: 'code-b',
    kind: 'tree',
  },
  {
    edge_id: 'tree:research-a->research-b',
    from_task_id: 'research-a',
    to_task_id: 'research-b',
    kind: 'tree',
  },
  {
    edge_id: 'ordering:gate-a->gate-b',
    from_task_id: 'gate-a',
    to_task_id: 'gate-b',
    kind: 'ordering',
  },
  {
    edge_id: 'ordering:sub-a->sub-b',
    from_task_id: 'sub-a',
    to_task_id: 'sub-b',
    kind: 'ordering',
  },
  {
    edge_id: 'fork:decision-a->brain-a',
    from_task_id: 'decision-a',
    to_task_id: 'brain-a',
    kind: 'fork',
  },
  {
    edge_id: 'fork:decision-b->brain-b',
    from_task_id: 'decision-b',
    to_task_id: 'brain-b',
    kind: 'fork',
  },
  {
    edge_id: 'join:arch-a->code-a',
    from_task_id: 'arch-a',
    to_task_id: 'code-a',
    kind: 'join',
  },
  {
    edge_id: 'join:arch-b->research-a',
    from_task_id: 'arch-b',
    to_task_id: 'research-a',
    kind: 'join',
  },
  {
    edge_id: 'cycle:decision-a->code-a',
    from_task_id: 'decision-a',
    to_task_id: 'code-a',
    kind: 'cycle',
    break_condition: 'human:REVIEW',
  },
  {
    edge_id: 'cycle:decision-b->research-a',
    from_task_id: 'decision-b',
    to_task_id: 'research-a',
    kind: 'cycle',
    break_condition: 'human:REVIEW',
  },
];

const center = mindmapCanvasCenter();

export const MINDMAP_SAMPLE_PROJECT: Project = {
  project_id: PROJECT_ID,
  title: 'Mindmap Sample',
  initial_prompt: 'Sample project for mindmap unit and UI tests.',
  cursor_chat_link: '',
  repo_url: 'https://github.com/example/mindmap-sample',
  status: 'TODO',
  map_x: center.x,
  map_y: center.y,
  mindmap_placement_version: MINDMAP_PLACEMENT_VERSION,
  task_graph_edges: MINDMAP_SAMPLE_GRAPH_EDGES,
  created_at: NOW,
  updated_at: NOW,
};

/**
 * Applies spiral-ish pins around the project center for framed-coordinate layout tests.
 * Call after an initial {@link layoutMindmap} with `useFramedCoordinates: false` migration.
 */
export function mindmapSampleTasksWithLayoutPins(
  nodes: { id: string; x: number; y: number }[],
): ProjectTask[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return MINDMAP_SAMPLE_TASKS.map((item) => {
    const node = byId.get(item.task_id);
    if (!node) return item;
    return { ...item, map_x: Math.round(node.x), map_y: Math.round(node.y) };
  });
}