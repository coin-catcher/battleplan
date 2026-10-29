import {
  battleplanTaskDir,
  battleplanTaskInputsDir,
  battleplanTaskOutputsDir,
} from './battleplan-storage';

/** App userData directory (Electron). Collateral lives under userData/battleplan/... */
export function userDataRootFromProjectsDataRoot(projectsDataRoot: string): string {
  const normalized = projectsDataRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.endsWith('/projects')) {
    return normalized.slice(0, -'/projects'.length);
  }
  return projectsDataRoot;
}

export function localGitRelativeTaskWorkspace(projectId: string, taskId: string): string {
  return battleplanTaskDir(projectId, taskId);
}

export function localGitRelativeTaskInputs(projectId: string, taskId: string): string {
  return battleplanTaskInputsDir(projectId, taskId);
}

export function localGitRelativeTaskOutputs(projectId: string, taskId: string): string {
  return battleplanTaskOutputsDir(projectId, taskId);
}

export const PROJECT_METADATA_RESERVED_DIRS = new Set(['tasks', 'battleplan']);

export const BATTLEPLAN_PROJECT_RESERVED_DIRS = new Set([
  'tasks',
  'task_templates',
  'workflows',
  'subprojects',
]);

export function isLegacyProjectTaskMetadataDir(name: string): boolean {
  if (!name || PROJECT_METADATA_RESERVED_DIRS.has(name)) return false;
  if (name.endsWith('.json')) return false;
  return true;
}

export function isLegacyBattleplanProjectTaskDir(name: string): boolean {
  if (!name || BATTLEPLAN_PROJECT_RESERVED_DIRS.has(name)) return false;
  return true;
}
