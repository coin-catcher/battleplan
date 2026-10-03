import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic-write';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'battleplan-atomic-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('writeFileAtomic', () => {
  it('creates a new file', async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, 'task_config.json');
    await writeFileAtomic(filePath, '{"task":1}');
    expect(await fs.readFile(filePath, 'utf8')).toBe('{"task":1}');
    expect(await fs.readdir(dir)).toEqual(['task_config.json']);
  });

  it('replaces an existing file without leaving temp files', async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, 'task_config.json');
    await writeFileAtomic(filePath, 'first');
    await writeFileAtomic(filePath, 'second');
    expect(await fs.readFile(filePath, 'utf8')).toBe('second');
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['task_config.json']);
  });

  it('handles concurrent writes to the same path', async () => {
    const dir = await tempDir();
    const filePath = path.join(dir, 'task_config.json');
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeFileAtomic(filePath, `payload-${index}`)));
    const final = await fs.readFile(filePath, 'utf8');
    expect(final.startsWith('payload-')).toBe(true);
  });
});
