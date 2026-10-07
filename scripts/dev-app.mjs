import { spawn } from 'node:child_process';

const children = ['dev:api', 'dev:app'].map(command => spawn('npm', ['run', command], { stdio: 'inherit', detached: true }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code ?? 1));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
