import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const areas = ['projects', 'tasks', 'outputs', 'chat', 'agents'];

for (const area of areas) {
  const dir = path.join(root, area, 'terraform');
  console.log(`\n==> terraform validate ${area}`);
  const init = spawnSync('terraform', ['init', '-backend=false', '-input=false'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (init.status !== 0) process.exit(init.status ?? 1);
  const validate = spawnSync('terraform', ['validate'], { cwd: dir, stdio: 'inherit' });
  if (validate.status !== 0) process.exit(validate.status ?? 1);
}
