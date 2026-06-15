import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function toMonorepoImports(source) {
  return source
    .replace(/from '\.\.\/server\/_shared\//g, "from '@hxxworldmonitor/shared/")
    .replace(/from '\.\.\/server\/platform\//g, "from '@hxxworldmonitor/platform-core/")
    .replace(/from "\.\.\/server\/_shared\//g, 'from "@hxxworldmonitor/shared/')
    .replace(/from "\.\.\/server\/platform\//g, 'from "@hxxworldmonitor/platform-core/');
}

const apps = [
  ['scripts/platform-api-server.ts', 'apps/platform-api/src/main.ts'],
  ['scripts/platform-scheduler-worker.ts', 'apps/platform-scheduler/src/main.ts'],
  ['scripts/platform-executor-worker.ts', 'apps/platform-executor/src/main.ts'],
  ['scripts/platform-ingest-worker.ts', 'apps/platform-ingest/src/main.ts'],
  ['scripts/platform-ingest-fast-worker.ts', 'apps/platform-ingest-fast/src/main.ts'],
  ['scripts/platform-embedding-worker.ts', 'apps/platform-embed/src/main.ts'],
  ['scripts/platform-subscription-worker.ts', 'apps/platform-subscription/src/main.ts'],
  ['scripts/platform-admin-init.ts', 'apps/platform-admin-init/src/main.ts'],
  ['scripts/platform-db-init.ts', 'apps/platform-db-init/src/main.ts'],
  ['scripts/platform-db-migrate.ts', 'apps/platform-db-migrate/src/main.ts'],
];

for (const [srcRel, destRel] of apps) {
  const src = path.join(root, srcRel);
  const dest = path.join(root, destRel);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, toMonorepoImports(readFileSync(src, 'utf8')));
}

console.log('App entry points generated');
