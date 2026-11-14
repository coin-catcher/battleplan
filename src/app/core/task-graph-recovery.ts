import type { Project, ProjectTask } from './models';
import type { TaskGraphEdge } from './task-graph';
import {
  applyGraphEdgesToLegacyFields,
  mergeLegacyTreeOrderingIntoGraph,
  rebuildGraphEdgesFromLegacy,
  stripOrphanTaskReferences,
  taskGraphValidationIssues,
} from './task-graph';

export { taskGraphValidationIssues } from './task-graph';

export function dedupeTaskGraphEdges(edges: TaskGraphEdge[]): TaskGraphEdge[] {
  const seen = new Set<string>();
  const out: TaskGraphEdge[] = [];
  for (const edge of edges) {
    const key = edge.edge_id?.trim() || `${edge.kind}:${edge.from_task_id}->${edge.to_task_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

/**
 * Best-effort graph from local project + task records (positions on tasks unchanged).
 * Merges stored `task_graph_edges` with legacy dependency fields so the mindmap can render
 * even when validation fails (e.g. accidental ordering cycles).
 */
export function recoverProjectTaskGraphFromStorage(
  project: Project,
  tasks: ProjectTask[],
): { project: Project; tasks: ProjectTask[]; changed: boolean; issues: string[] } {
  const taskIds = new Set(tasks.map((task) => task.task_id));
  const stripped = stripOrphanTaskReferences(tasks, taskIds);

  const stored = (project.task_graph_edges ?? []).filter(
    (edge) => taskIds.has(edge.from_task_id) && taskIds.has(edge.to_task_id),
  );
  let edges = mergeLegacyTreeOrderingIntoGraph(stored, stripped.tasks);
  const legacy = rebuildGraphEdgesFromLegacy(stripped.tasks);
  edges = dedupeTaskGraphEdges([...edges, ...legacy]);

  const issues = taskGraphValidationIssues(edges, taskIds);
  const synced = applyGraphEdgesToLegacyFields(stripped.tasks, edges);

  const validationIssue = issues[0];
  const projectNext: Project = {
    ...project,
    task_graph_edges: edges,
    ...(validationIssue ? { task_graph_validation_issue: validationIssue } : {}),
  };
  if (!validationIssue && project.task_graph_validation_issue) {
    delete projectNext.task_graph_validation_issue;
  }

  const changed = JSON.stringify(project.task_graph_edges ?? []) !== JSON.stringify(edges)
    || project.task_graph_validation_issue !== projectNext.task_graph_validation_issue
    || stripped.changed
    || JSON.stringify(tasks) !== JSON.stringify(synced);

  return { project: projectNext, tasks: synced, changed, issues };
}

/** Edges for mindmap when stored graph may be partial or invalid — union with legacy fields. */
export function graphEdgesForDisplay(project: Project | null, tasks: ProjectTask[]): TaskGraphEdge[] {
  const taskIds = new Set(tasks.map((task) => task.task_id));
  const stored = (project?.task_graph_edges ?? []).filter(
    (edge) => taskIds.has(edge.from_task_id) && taskIds.has(edge.to_task_id),
  );
  if (stored.length === 0) return rebuildGraphEdgesFromLegacy(tasks);
  const legacy = rebuildGraphEdgesFromLegacy(tasks);
  return dedupeTaskGraphEdges([...stored, ...legacy]);
}