import type { Project, ProjectTask } from './models';
import {
  BATTLEPLAN_STORAGE_VERSION,
  battleplanTaskRepoPath,
  isLegacyResearchRepoPath,
  legacyResearchTaskPath,
} from './battleplan-storage';

export interface StorageMigrationResult {
  project: Project;
  tasks: ProjectTask[];
  migratedTasks: number;
}

/** One-time v1 → v2: normalize repo_path on tasks and mark project storage version. */
export function migrateProjectStorageToV2(project: Project, tasks: ProjectTask[]): StorageMigrationResult {
  if ((project.battleplan_storage_version ?? 1) >= BATTLEPLAN_STORAGE_VERSION) {
    return { project, tasks, migratedTasks: 0 };
  }
  let migratedTasks = 0;
  const nextTasks = tasks.map((task) => {
    const legacy = legacyResearchTaskPath(task.project_id, task.task_id);
    const current = task.repo_path?.trim();
    if (!current || current === legacy || isLegacyResearchRepoPath(current)) {
      migratedTasks += 1;
      return {
        ...task,
        repo_path: battleplanTaskRepoPath(task.project_id, task.task_id),
      };
    }
    return task;
  });
  const nextProject: Project = {
    ...project,
    battleplan_storage_version: BATTLEPLAN_STORAGE_VERSION,
    updated_at: new Date().toISOString(),
  };
  return { project: nextProject, tasks: nextTasks, migratedTasks };
}
