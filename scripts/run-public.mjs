import { spawn } from 'node:child_process';
const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'check'].includes(command)) throw new Error('Unsupported Astro command');
const child = spawn('npm', ['--prefix', 'apps/public', 'run', command, '--', ...args], { stdio: 'inherit', env: process.env });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
