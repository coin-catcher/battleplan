/** Git-relative Battleplan storage layout (v2). Local BATTLEPLAN_ROOT mirrors these paths under each project workspace. */

export const BATTLEPLAN_STORAGE_VERSION = 2;

export function battleplanProjectsRoot(): string {
  return 'battleplan/projects';
}

export function battleplanProjectDir(projectId: string): string {
  return `${battleplanProjectsRoot()}/${projectId}`;
}

export function battleplanTaskDir(projectId: string, taskId: string): string {
  return `${battleplanProjectDir(projectId)}/tasks/${taskId}`;
}

export function battleplanTaskOutputsDir(projectId: string, taskId: string): string {
  return `${battleplanTaskDir(projectId, taskId)}/outputs`;
}

export function battleplanTaskRepoPath(projectId: string, taskId: string): string {
  return `${battleplanTaskOutputsDir(projectId, taskId)}/`;
}

export function battleplanSubprojectTasksDir(projectId: string, subprojectId: string): string {
  return `${battleplanProjectDir(projectId)}/subprojects/${subprojectId}/tasks`;
}

export function battleplanWorkflowsDir(projectId: string): string {
  return `${battleplanProjectDir(projectId)}/workflows`;
}

export function battleplanTaskTemplatesDir(projectId: string): string {
  return `${battleplanProjectDir(projectId)}/task_templates`;
}

/** Legacy research folder under repo root (v1). */
export function legacyResearchTaskPath(projectId: string, taskId: string): string {
  return `research/${projectId}/${taskId}/`;
}

export function isLegacyResearchRepoPath(path: string): boolean {
  return /^research\/[^/]+\/[^/]+\/?$/.test(path.replace(/\\/g, '/'));
}

export interface TaskOutputManifestEntry {
  path: string;
  description?: string;
  from_task_id?: string;
  edge_kind?: string;
  created_at?: string;
  mime?: string;
}

export interface TaskOutputManifest {
  entries: TaskOutputManifestEntry[];
  updated_at: string;
}
