import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BATTLEPLAN_PROJECT_RESERVED_DIRS,
  isLegacyBattleplanProjectTaskDir,
  isLegacyProjectTaskMetadataDir,
  userDataRootFromProjectsDataRoot,
} from '../src/app/core/local-workspace-layout';

const TASK_CONFIG = 'task_config.json';
const PROJECT_CONFIG = 'project_config.json';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function moveDirectory(source: string, destination: string): Promise<void> {
  if (!(await pathExists(source))) return;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await pathExists(destination)) {
    const nested = await safeReadDir(source);
    for (const entry of nested) {
      await moveDirectory(path.join(source, entry.name), path.join(destination, entry.name));
    }
    await fs.rm(source, { recursive: true, force: true });
    return;
  }
  await fs.rename(source, destination);
}

async function mergeDirectoryInto(source: string, destinationRoot: string): Promise<void> {
  if (!(await pathExists(source))) return;
  const entries = await safeReadDir(source);
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      await mergeDirectoryInto(from, to);
    } else {
      await fs.mkdir(path.dirname(to), { recursive: true });
      if (await pathExists(to)) await fs.rm(to, { force: true });
      await fs.rename(from, to);
    }
  }
  await fs.rm(source, { recursive: true, force: true });
}

export interface LocalWorkspaceMigrationResult {
  metadataTasksMoved: number;
  battleplanTaskDirsMoved: number;
  nestedBattleplanHoisted: number;
}

/** Idempotent: metadata under projects/{id}/tasks/{taskId}/; collateral under userData/battleplan/projects/.../tasks/... */
export async function migrateLocalWorkspaceLayout(projectsDataRoot: string): Promise<LocalWorkspaceMigrationResult> {
  const userDataRoot = userDataRootFromProjectsDataRoot(projectsDataRoot);
  const result: LocalWorkspaceMigrationResult = {
    metadataTasksMoved: 0,
    battleplanTaskDirsMoved: 0,
    nestedBattleplanHoisted: 0,
  };

  const projectEntries = await safeReadDir(projectsDataRoot);
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectId = projectEntry.name;
    const projectPath = path.join(projectsDataRoot, projectId);

    const nestedBattleplan = path.join(projectPath, 'battleplan');
    if (await pathExists(nestedBattleplan)) {
      await mergeDirectoryInto(nestedBattleplan, path.join(userDataRoot, 'battleplan'));
      result.nestedBattleplanHoisted += 1;
    }

    const tasksDir = path.join(projectPath, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    for (const entry of await safeReadDir(projectPath)) {
      if (!entry.isDirectory()) continue;
      if (!isLegacyProjectTaskMetadataDir(entry.name)) continue;
      const legacyTaskPath = path.join(projectPath, entry.name);
      const configPath = path.join(legacyTaskPath, TASK_CONFIG);
      if (!(await pathExists(configPath))) continue;
      const dest = path.join(tasksDir, entry.name);
      if (await pathExists(dest)) continue;
      await moveDirectory(legacyTaskPath, dest);
      result.metadataTasksMoved += 1;
    }
  }

  const battleplanProjectsRoot = path.join(userDataRoot, 'battleplan', 'projects');
  if (!(await pathExists(battleplanProjectsRoot))) return result;

  for (const projectEntry of await safeReadDir(battleplanProjectsRoot)) {
    if (!projectEntry.isDirectory()) continue;
    const projectId = projectEntry.name;
    const projectPath = path.join(battleplanProjectsRoot, projectId);
    const tasksDir = path.join(projectPath, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });

    for (const entry of await safeReadDir(projectPath)) {
      if (!entry.isDirectory()) continue;
      if (!isLegacyBattleplanProjectTaskDir(entry.name)) continue;
      const legacyPath = path.join(projectPath, entry.name);
      const dest = path.join(tasksDir, entry.name);
      if (await pathExists(dest)) {
        await mergeDirectoryInto(legacyPath, dest);
        await fs.rm(legacyPath, { recursive: true, force: true });
      } else {
        await moveDirectory(legacyPath, dest);
      }
      result.battleplanTaskDirsMoved += 1;
    }
  }

  return result;
}

export async function isTaskConfigPath(configPath: string): Promise<boolean> {
  return pathExists(configPath);
}

export { PROJECT_CONFIG, TASK_CONFIG, BATTLEPLAN_PROJECT_RESERVED_DIRS };
