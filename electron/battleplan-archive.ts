import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import extract from 'extract-zip';
import type { Project, ProjectTask } from '../src/app/core/models';
import { FileRepository } from './file-repository';

const MANIFEST = 'battleplan.manifest.json';

export interface BattleplanManifest {
  format: 'battleplan';
  version: 1;
  project_id: string;
  title: string;
  exported_at: string;
  /** Root project and nested subprojects included in this archive. */
  project_ids?: string[];
}

export async function exportProject(repo: FileRepository, projectId: string, destinationFile: string): Promise<void> {
  const project = await repo.getProject(projectId);
  if (!project) throw new Error('Project was not found.');
  const projectIds = await collectProjectTree(repo, projectId);
  const sourceRoot = repo.root();
  await fsPromises.mkdir(path.dirname(destinationFile), { recursive: true });
  const manifest: BattleplanManifest = {
    format: 'battleplan',
    version: 1,
    project_id: project.project_id,
    title: project.title,
    exported_at: new Date().toISOString(),
    project_ids: projectIds,
  };
  const staging = path.join(path.dirname(destinationFile), `.export-${projectId}-${process.pid}`);
  await fsPromises.rm(staging, { recursive: true, force: true });
  await fsPromises.mkdir(staging, { recursive: true });
  for (const id of projectIds) {
    const sourceDir = path.join(sourceRoot, id);
    const targetDir = path.join(staging, 'projects', id);
    await fsPromises.cp(sourceDir, targetDir, { recursive: true });
  }
  await fsPromises.writeFile(path.join(staging, MANIFEST), JSON.stringify(manifest, null, 2));
  await zipDirectory(staging, destinationFile);
  await fsPromises.rm(staging, { recursive: true, force: true });
}

export async function importProject(
  repo: FileRepository,
  archivePath: string,
  overwrite: boolean,
): Promise<Project> {
  const staging = path.join(repo.root(), `.import-${process.pid}-${Date.now()}`);
  await fsPromises.mkdir(staging, { recursive: true });
  try {
    await extract(archivePath, { dir: staging });
    const manifestPath = path.join(staging, MANIFEST);
    const manifestRaw = await fsPromises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as BattleplanManifest;
    if (manifest.format !== 'battleplan') throw new Error('This file is not a battleplan archive.');
    const projectIds = manifest.project_ids?.length
      ? manifest.project_ids
      : [manifest.project_id];
    const bundled = path.join(staging, 'projects');
    const hasBundle = fs.existsSync(bundled);
    for (const projectId of projectIds) {
      const targetDir = path.join(repo.root(), projectId);
      const exists = fs.existsSync(path.join(targetDir, 'project_config.json'));
      if (exists && !overwrite) throw new Error('PROJECT_EXISTS');
      if (exists) await fsPromises.rm(targetDir, { recursive: true, force: true });
      await fsPromises.mkdir(targetDir, { recursive: true });
      const sourceDir = hasBundle
        ? path.join(bundled, projectId)
        : staging;
      if (hasBundle) {
        await fsPromises.cp(sourceDir, targetDir, { recursive: true });
      } else if (projectId === manifest.project_id) {
        const entries = await fsPromises.readdir(staging, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === MANIFEST) continue;
          await fsPromises.cp(path.join(staging, entry.name), path.join(targetDir, entry.name), { recursive: true });
        }
      }
    }
    const project = await repo.getProject(manifest.project_id);
    if (!project) throw new Error('Imported project could not be loaded.');
    return project;
  } finally {
    await fsPromises.rm(staging, { recursive: true, force: true });
  }
}

async function collectProjectTree(repo: FileRepository, projectId: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [projectId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const project = await repo.getProject(id);
    if (!project) continue;
    for (const childId of project.subproject_ids ?? []) {
      if (!seen.has(childId)) queue.push(childId);
    }
    const tasks = await repo.listTasks(id);
    for (const task of tasks) {
      if (task.subproject_id && !seen.has(task.subproject_id)) queue.push(task.subproject_id);
      for (const childId of task.subproject_ids ?? []) {
        if (!seen.has(childId)) queue.push(childId);
      }
    }
  }
  return [...seen];
}

function zipDirectory(sourceDir: string, destinationFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', (error) => reject(error));
    archive.pipe(output);
    archive.directory(sourceDir, false);
    void archive.finalize();
  });
}
