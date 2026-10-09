import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('electron-builder packaging', () => {
  it('ships shared main-process modules compiled under dist-electron/src', () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: { files?: string[] };
    };
    const files = pkg.build?.files ?? [];
    expect(files.some((entry) => entry.includes('dist-electron/src'))).toBe(true);
  });
});
