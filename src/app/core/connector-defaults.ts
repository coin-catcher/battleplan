import type { Project, ProjectTask, TaskConnectorKind } from './models';

/** Default execution backend when task.connector_kind is unset (Round 2 Q3). */
export function defaultConnectorForTask(task: ProjectTask, project: Project): TaskConnectorKind {
  if (task.connector_kind) return task.connector_kind;
  if (task.output_type === 'code') return 'cursor';
  if (task.output_type === 'research') return 'research_http';
  if (task.output_type === 'subproject' && project.default_hermes_connector_id?.trim()) {
    return 'hermes';
  }
  if (task.output_type === 'subproject') return 'hermes';
  return 'research_http';
}
