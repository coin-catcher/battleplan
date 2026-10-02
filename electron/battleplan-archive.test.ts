import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '../src/app/core/models';
import { exportProject, importProject } from './battleplan-archive';
import { FileRepository } from './file-repository';

const tempDirs: string[] = [];

function project(id: string): Project {
  return {
    project_id: id,
    title: 'Sample',
    initial_prompt: 'prompt',
    cursor_chat_link: 'https://cursor.com/agents/a',
    created_at: '2026-10-02T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
  };
}

async function makeRepo(): Promise<{ repo: FileRepository; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battleplan-'));
  tempDirs.push(root);
  return { repo: new FileRepository(root), root };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('battleplan archive', () => {
  it('exports and imports a project archive', async () => {
    const { repo, root } = await makeRepo();
    await repo.saveProject(project('p1'));
    const archivePath = path.join(root, 'sample.battleplan');
    await exportProject(repo, 'p1', archivePath);
    const target = await makeRepo();
    const imported = await importProject(target.repo, archivePath, false);
    expect(imported.project_id).toBe('p1');
    expect((await target.repo.listProjects())).toHaveLength(1);
  });

  it('signals when a project already exists', async () => {
    const { repo, root } = await makeRepo();
    await repo.saveProject(project('p1'));
    const archivePath = path.join(root, 'sample.battleplan');
    await exportProject(repo, 'p1', archivePath);
    await expect(importProject(repo, archivePath, false)).rejects.toThrow('PROJECT_EXISTS');
  });
});
