import { runCommand } from './run-command.mjs';
const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'check'].includes(command)) throw new Error('Unsupported Astro command');
runCommand('npm', ['--prefix', 'apps/public', 'run', command, '--', ...args], { stdio: 'inherit', env: process.env });
