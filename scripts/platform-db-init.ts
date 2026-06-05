import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

declare const process: { env: Record<string, string | undefined> };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INIT_DIR = path.join(__dirname, '..', 'deploy', 'init');

async function tryPgVector(client: pg.Client): Promise<void> {
  const vectorPath = path.join(INIT_DIR, '002_schema_pgvector.sql');
  try {
    await client.query(readFileSync(vectorPath, 'utf8'));
    console.log('[platform-db-init] pgvector schema applied:', vectorPath);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '0A000' || code === '58P01') {
      console.warn('[platform-db-init] pgvector not installed — skipped (Phase 1 OK without it)');
      console.warn('[platform-db-init] Install later: https://github.com/pgvector/pgvector#installation');
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('[platform-db-init] DATABASE_URL is required in .env.local');
    process.exit(1);
  }

  const corePath = path.join(INIT_DIR, '001_schema.sql');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('[platform-db-init] connected');
    await client.query(readFileSync(corePath, 'utf8'));
    console.log('[platform-db-init] core schema applied:', corePath);
    await tryPgVector(client);
    console.log('[platform-db-init] done');
  } catch (err) {
    console.error('[platform-db-init] failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
