import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"'))
      || (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

/** Walk up from startDir until a package.json with "workspaces" is found. */
export function findMonorepoRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/**
 * Load env files without overriding existing process.env:
 * 1. `<cwd>/.env.local` (app-specific)
 * 2. `<monorepo-root>/.env.local` (shared fallback)
 */
export function loadEnvLocal(opts?: { cwd?: string }): void {
  const cwd = opts?.cwd ?? process.cwd();
  parseEnvFile(path.join(cwd, '.env.local'));
  parseEnvFile(path.join(findMonorepoRoot(cwd), '.env.local'));
}

/** @deprecated use loadEnvLocal — kept for legacy imports */
export function loadEnvLocalLegacy(): void {
  loadEnvLocal({ cwd: findMonorepoRoot() });
}
