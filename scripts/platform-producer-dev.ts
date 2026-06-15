/**
 * Dev helper: run scheduler + executor in one terminal (Producer tier-3).
 * Tier1/2 workers (ingest-fast, ingest, embed) still need separate terminals if used.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

declare const process: { env: Record<string, string | undefined>; platform: string };

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children: ChildProcess[] = [];

function start(label: string, script: string): ChildProcess {
  const child = spawn(npmCmd, ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    console.log(`[platform:producer] ${label} exited`, { code, signal });
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(code = 0): void {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[platform:producer] starting scheduler + executor (Ctrl+C to stop both)');
children.push(start('scheduler', 'platform:scheduler'));
children.push(start('executor', 'platform:executor'));
