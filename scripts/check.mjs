import { spawnSync } from 'node:child_process';

const checks = {
  lint: ['npm', ['run', 'lint']],
  types: ['npx', ['tsc', '--noEmit']],
  router: ['npm', ['run', 'check:router']],
  public: ['npm', ['run', 'check:public']],
  test: ['npm', ['test']],
};
const selected = process.argv[2];
if (selected && !Object.hasOwn(checks, selected)) throw new Error('Unknown check');
for (const [command, args] of selected ? [checks[selected]] : Object.values(checks)) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
