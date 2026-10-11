import { spawn } from 'node:child_process';

// Explicitly pass only the local admin flag; application secrets stay in .dev.vars.
const child = spawn('npx', ['wrangler', 'dev', '--config', 'wrangler.api.jsonc', '--ip', '127.0.0.1', '--port', '8788', '--inspector-port', '9230', '--var', 'ACCOUNT_AUTH_LOCAL_ORIGIN:http://localhost:3000', '--var', `LOCAL_ADMIN_BYPASS:${process.env.LOCAL_ADMIN_BYPASS === 'true'}`, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
