import type { Project, ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import { rootTaskIds } from './dependencies';

function titleFor(id: string, tasks: ProjectTask[]): string {
  const hit = tasks.find((task) => task.task_id === id);
  if (hit) return `${hit.title} (${id})`;
  return id;
}

/** Replace UUID task ids with titles in a JSON-ish text block for the recovery UI. */
export function resolveTaskIdsInRecoverySnapshot(text: string, tasks: ProjectTask[]): string {
  let out = text;
  const byLength = [...tasks].sort((left, right) => right.task_id.length - left.task_id.length);
  for (const task of byLength) {
    const label = `${task.title} [${task.task_id}]`;
    out = out.split(task.task_id).join(label);
  }
  return out;
}

export interface GraphRecoveryDiskHints {
  tasks: ProjectTask[];
  edges: TaskGraphEdge[];
}

/** Merge on-disk records: legacy fields + project graph edges into task hints. */
export function mergeGraphRecoveryDiskHints(
  project: Project,
  tasks: ProjectTask[],
): GraphRecoveryDiskHints {
  const byId = new Map(tasks.map((task) => [task.task_id, task]));
  const edges = [...(project.task_graph_edges ?? [])];
  const nextTasks = tasks.map((task) => {
    const dependencies = new Set(task.dependencies);
    const sibling = new Set(task.sibling_dependencies ?? []);
    for (const edge of edges) {
      if (edge.kind === 'tree' && edge.from_task_id === task.task_id) {
        dependencies.add(edge.to_task_id);
      }
      if (edge.kind === 'ordering' && edge.to_task_id === task.task_id) {
        sibling.add(edge.from_task_id);
      }
    }
    return {
      ...task,
      dependencies: [...dependencies],
      sibling_dependencies: [...sibling],
    };
  });
  return { tasks: nextTasks, edges };
}

export function buildTaskRecoveryDiskSnapshot(
  project: Project,
  task: ProjectTask,
  tasks: ProjectTask[],
): string {
  const roots = new Set(rootTaskIds(tasks));
  const relatedEdges = (project.task_graph_edges ?? []).filter(
    (edge) => edge.from_task_id === task.task_id || edge.to_task_id === task.task_id,
  );
  const payload = {
    project_id: project.project_id,
    project_title: project.title,
    project_map: { map_x: project.map_x, map_y: project.map_y },
    task_graph_edge_count: project.task_graph_edges?.length ?? 0,
    task: {
      task_id: task.task_id,
      title: task.title,
      output_type: task.output_type,
      node_kind: task.node_kind,
      map_x: task.map_x,
      map_y: task.map_y,
      dependencies: task.dependencies,
      sibling_dependencies: task.sibling_dependencies ?? [],
      brief: task.brief,
      repo_path: task.repo_path,
      discovery_task_slug: task.discovery_task_slug,
      order: task.order,
      connects_as_project_root: roots.has(task.task_id),
    },
    incident_graph_edges: relatedEdges,
    legacy_parent_task_ids: tasks
      .filter((candidate) => candidate.dependencies.includes(task.task_id))
      .map((candidate) => candidate.task_id),
  };
  const raw = JSON.stringify(payload, null, 2);
  return resolveTaskIdsInRecoverySnapshot(raw, tasks);
}