import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (mode !== 'local' && mode !== 'agent') {
  console.error("Usage: node scripts/deploy-all.mjs <local|agent>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const areas = ['projects', 'tasks', 'outputs', 'chat', 'agents'];

for (const area of areas) {
  const result = spawnSync('npm', ['run', `deploy:${mode}`], {
    cwd: path.join(root, area),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
