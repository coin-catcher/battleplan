import fs from 'node:fs/promises';
import path from 'node:path';
import { assertBattleplanGitMirrorPath } from '../src/app/core/git-mirror-path';
import { battleplanTaskInputsDir } from '../src/app/core/battleplan-storage';
import { userDataRootFromProjectsDataRoot } from '../src/app/core/local-workspace-layout';

async function safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function copyFileIfExists(source: string, dest: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(sourceDir: string, destDir: string): Promise<number> {
  let copied = 0;
  for (const entry of await safeReadDir(sourceDir)) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copied += await copyTree(from, to);
    } else if (entry.isFile()) {
      if (await copyFileIfExists(from, to)) copied += 1;
    }
  }
  return copied;
}

export interface UpstreamInputSpec {
  task_id: string;
  title: string;
  repo_path?: string;
}

/** Copy upstream git-mirrored collateral into this task's local inputs/ folder before execute. */
export async function stageUpstreamInputsForTask(
  projectsDataRoot: string,
  projectId: string,
  taskId: string,
  upstream: UpstreamInputSpec[],
): Promise<number> {
  const userDataRoot = userDataRootFromProjectsDataRoot(projectsDataRoot);
  const inputsGitPrefix = assertBattleplanGitMirrorPath(battleplanTaskInputsDir(projectId, taskId));
  const inputsAbs = path.join(userDataRoot, ...inputsGitPrefix.split('/'));
  await fs.mkdir(inputsAbs, { recursive: true });

  let copied = 0;
  for (const parent of upstream) {
    const repoPath = parent.repo_path?.trim().replace(/\/?$/, '/');
    if (!repoPath) continue;
    const relative = assertBattleplanGitMirrorPath(repoPath.replace(/\/$/, ''));
    const sourceAbs = path.join(userDataRoot, ...relative.split('/'));
    const destAbs = path.join(inputsAbs, parent.task_id);
    copied += await copyTree(sourceAbs, destAbs);
  }
  return copied;
}
