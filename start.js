// Runs both services side by side: the front desk (port 3000) and the caller agent (port 4000).
// Each one can also run on its own: `npm run front-desk` / `npm run caller-agent`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const envArgs = existsSync('.env') ? ['--env-file=.env'] : [];
const services = [
  { name: 'front-desk  ', file: 'front-desk/server.js' },
  { name: 'caller-agent', file: 'caller-agent/server.js' },
];

const children = services.map(({ name, file }) => {
  const child = spawn(process.execPath, [...envArgs, file], { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk) => chunk.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  child.stdout.on('data', (c) => process.stdout.write(prefix(c)));
  child.stderr.on('data', (c) => process.stderr.write(prefix(c)));
  child.on('exit', (code) => console.log(`[${name}] exited with code ${code}`));
  return child;
});

const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
