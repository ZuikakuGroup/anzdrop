import { spawn } from 'node:child_process';

// Keep child output and exit status visible to npm and forward terminal shutdown.
export function runCommand(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  const handlers = ['SIGINT', 'SIGTERM'].map(signal => [signal, () => child.kill(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  child.on('close', () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  });
  return child;
}
