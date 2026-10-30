import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { root } from './root.mjs';

const bin = name => path.join(root, 'node_modules/.bin', name);

export function build() {
  const result = spawnSync(bin('vite'), ['build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('vite build failed');
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

/** `wrangler dev --env local --local` on a free port, persisting to `persistTo` with `vars` set over wrangler.jsonc's; resolves once it serves the app. */
export async function startWorker(persistTo, vars = {}) {
  const port = await freePort();
  const child = spawn(bin('wrangler'), ['dev', '--env', 'local', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0', '--persist-to', persistTo, '--show-interactive-dev-session=false', ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])], {
    cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  for (let tries = 0; tries < 240; tries++) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${log}`);
    try { if ((await fetch(`${origin}/`)).ok) return { origin, stop: () => stopWorker(child), log: () => log }; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  child.kill('SIGKILL');
  throw new Error(`wrangler did not answer on ${origin}:\n${log}`);
}

function stopWorker(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGINT');
  });
}
