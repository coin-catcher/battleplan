import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const areas = process.argv.slice(2);
const selected = areas.length > 0 ? areas : ['projects', 'tasks', 'outputs', 'chat', 'agents'];

for (const area of selected) {
  const outdir = path.join(root, area, 'dist');
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(root, area, 'src', 'handler.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(outdir, 'index.js'),
    external: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
    sourcemap: false,
    logLevel: 'info',
  });
}
