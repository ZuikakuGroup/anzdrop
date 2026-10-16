import { spawn } from 'node:child_process';

// Keep child output and exit status visible to npm and forward terminal shutdown.
export function runCommand(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return child;
}
