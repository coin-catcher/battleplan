import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLocalWorkspaceLayout } from './local-workspace-migrate';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('migrateLocalWorkspaceLayout', () => {
  it('moves battleplan/projects/{id}/{task}/ into tasks/{task}/', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bp-user-'));
    tempDirs.push(userData);
    const projectsRoot = path.join(userData, 'projects');
    const legacyTask = path.join(userData, 'battleplan', 'projects', 'p1', 'partition-a', 'outputs');
    await fs.mkdir(legacyTask, { recursive: true });
    await fs.writeFile(path.join(legacyTask, 'brief.md'), '# brief');

    const result = await migrateLocalWorkspaceLayout(projectsRoot);
    expect(result.battleplanTaskDirsMoved).toBe(1);
    expect(await fs.readFile(
      path.join(userData, 'battleplan', 'projects', 'p1', 'tasks', 'partition-a', 'outputs', 'brief.md'),
      'utf8',
    )).toContain('brief');
  });
});
