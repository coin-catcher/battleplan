import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import extract from 'extract-zip';
import type { Project } from '../src/app/core/models';
import { FileRepository } from './file-repository';

const MANIFEST = 'battleplan.manifest.json';

export interface BattleplanManifest {
  format: 'battleplan';
  version: 1;
  project_id: string;
  title: string;
  exported_at: string;
}

export async function exportProject(repo: FileRepository, projectId: string, destinationFile: string): Promise<void> {
  const project = await repo.getProject(projectId);
  if (!project) throw new Error('Project was not found.');
  const sourceDir = path.join(repo.root(), projectId);
  await fsPromises.mkdir(path.dirname(destinationFile), { recursive: true });
  const manifest: BattleplanManifest = {
    format: 'battleplan',
    version: 1,
    project_id: project.project_id,
    title: project.title,
    exported_at: new Date().toISOString(),
  };
  const staging = path.join(path.dirname(destinationFile), `.export-${projectId}-${process.pid}`);
  await fsPromises.rm(staging, { recursive: true, force: true });
  await fsPromises.cp(sourceDir, staging, { recursive: true });
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
    const projectId = manifest.project_id;
    const targetDir = path.join(repo.root(), projectId);
    const exists = fs.existsSync(path.join(targetDir, 'project_config.json'));
    if (exists && !overwrite) throw new Error('PROJECT_EXISTS');
    if (exists) await fsPromises.rm(targetDir, { recursive: true, force: true });
    await fsPromises.mkdir(targetDir, { recursive: true });
    const entries = await fsPromises.readdir(staging, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === MANIFEST) continue;
      await fsPromises.cp(path.join(staging, entry.name), path.join(targetDir, entry.name), { recursive: true });
    }
    const project = await repo.getProject(projectId);
    if (!project) throw new Error('Imported project could not be loaded.');
    return project;
  } finally {
    await fsPromises.rm(staging, { recursive: true, force: true });
  }
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
