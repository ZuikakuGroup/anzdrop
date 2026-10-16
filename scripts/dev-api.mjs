import { runCommand } from './run-command.mjs';

// Explicitly pass only the local admin flag; application secrets stay in .dev.vars.
runCommand('npx', ['wrangler', 'dev', '--config', 'wrangler.api.jsonc', '--ip', '127.0.0.1', '--port', '8788', '--inspector-port', '9230', '--var', 'ACCOUNT_AUTH_LOCAL_ORIGIN:http://localhost:3000', '--var', `LOCAL_ADMIN_BYPASS:${process.env.LOCAL_ADMIN_BYPASS === 'true'}`, ...process.argv.slice(2)], { stdio: 'inherit' });
