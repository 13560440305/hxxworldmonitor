import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { PlatformLogger } from '@hxxworldmonitor/shared/platform-logger.js';
import { createPlatformLogger } from '@hxxworldmonitor/shared/platform-logger.js';
import { runPlatformSeedBootstrap } from './platform-seed-bootstrap.js';

declare const process: { env: Record<string, string | undefined> };

/** Ordered SQL migrations under deploy/init (001 = core schema). */
export const PLATFORM_MIGRATION_FILES = [
  { file: '001_schema.sql', optional: false },
  { file: '002_schema_pgvector.sql', optional: true },
  { file: '003_schema_research.sql', optional: true },
  { file: '004_schema_subscription_catalog.sql', optional: true },
  { file: '005_schema_user_roles.sql', optional: true },
  { file: '006_schema_content_translations.sql', optional: true },
  { file: '007_schema_user_preferred_lang.sql', optional: true },
  { file: '008_schema_email_verification.sql', optional: true },
  { file: '009_schema_workspace_settings.sql', optional: true },
  { file: '010_schema_workspace_settings_enc.sql', optional: true },
  { file: '011_schema_user_account_status.sql', optional: true },
  { file: '012_schema_workspace_subscription_policy.sql', optional: true },
  { file: '013_schema_integration_providers.sql', optional: true },
  { file: '014_schema_integration_providers_model.sql', optional: true },
  { file: '015_schema_integration_providers_custom.sql', optional: true },
  { file: '016_schema_integration_providers_remarks.sql', optional: true },
  { file: '017_schema_subscription_content_delivery_langs.sql', optional: true },
  { file: '018_schema_brief_source_refs.sql', optional: true },
  { file: '019_schema_user_api_keys.sql', optional: true },
  { file: '020_schema_user_delivery_preferences.sql', optional: true },
  { file: '021_schema_user_delivery_schedule_all_modes.sql', optional: true },
  { file: '022_schema_job_scheduler.sql', optional: false },
  { file: '023_schema_job_checkpoints.sql', optional: false },
] as const;

export interface BootstrapResult {
  applied: string[];
  skipped: string[];
  unchanged: string[];
  /** Recorded in ledger without running SQL (DB migrated before auto-bootstrap). */
  stamped: string[];
}

function initDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deploy', 'init');
}

function fileChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function isAutoMigrateEnabled(): boolean {
  const raw = process.env.PLATFORM_DB_AUTO_MIGRATE?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

async function ensureMigrationTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getRecordedChecksum(client: pg.Client, filename: string): Promise<string | null> {
  const res = await client.query<{ checksum: string }>(
    'SELECT checksum FROM schema_migrations WHERE filename = $1',
    [filename],
  );
  return res.rows[0]?.checksum ?? null;
}

async function markApplied(client: pg.Client, filename: string, checksum: string): Promise<void> {
  await client.query(
    `INSERT INTO schema_migrations (filename, checksum, applied_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (filename) DO UPDATE SET
       checksum = EXCLUDED.checksum,
       applied_at = NOW()`,
    [filename, checksum],
  );
}

function isPgVectorMissing(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === '0A000' || code === '58P01';
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return (res.rowCount ?? 0) > 0;
}

async function columnExists(client: pg.Client, table: string, column: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (res.rowCount ?? 0) > 0;
}

async function indexExists(client: pg.Client, indexName: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [indexName],
  );
  return (res.rowCount ?? 0) > 0;
}

async function jsonbKeyExistsOnAnyRow(
  client: pg.Client,
  table: string,
  jsonColumn: string,
  key: string,
): Promise<boolean> {
  if (!(await tableExists(client, table))) return false;
  const res = await client.query(
    `SELECT 1 FROM ${table} WHERE ${jsonColumn} ? $1 LIMIT 1`,
    [key],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Detect migrations applied manually before schema_migrations ledger existed. */
async function isMigrationAlreadyApplied(client: pg.Client, filename: string): Promise<boolean> {
  switch (filename) {
    case '001_schema.sql':
      return tableExists(client, 'workspaces');
    case '002_schema_pgvector.sql':
      return tableExists(client, 'news_embeddings');
    case '003_schema_research.sql':
      return indexExists(client, 'idx_news_embeddings_workspace');
    case '004_schema_subscription_catalog.sql':
      return tableExists(client, 'subscription_presets');
    case '005_schema_user_roles.sql':
      return columnExists(client, 'users', 'role');
    case '006_schema_content_translations.sql':
      return tableExists(client, 'content_translations');
    case '007_schema_user_preferred_lang.sql':
      return columnExists(client, 'users', 'preferred_lang');
    case '008_schema_email_verification.sql':
      return tableExists(client, 'email_verification_codes');
    case '009_schema_workspace_settings.sql':
      return tableExists(client, 'workspace_settings');
    case '010_schema_workspace_settings_enc.sql':
      return columnExists(client, 'workspace_settings', 'default_user_password_enc');
    case '011_schema_user_account_status.sql':
      return columnExists(client, 'users', 'account_status');
    case '012_schema_workspace_subscription_policy.sql':
      return columnExists(client, 'workspace_settings', 'self_service_subscriptions_enabled');
    case '013_schema_integration_providers.sql':
      return tableExists(client, 'integration_providers');
    case '014_schema_integration_providers_model.sql':
      return columnExists(client, 'integration_providers', 'model_name');
    case '015_schema_integration_providers_custom.sql':
      return columnExists(client, 'integration_providers', 'is_custom');
    case '016_schema_integration_providers_remarks.sql':
      return columnExists(client, 'integration_providers', 'remarks');
    case '017_schema_subscription_content_delivery_langs.sql':
      return jsonbKeyExistsOnAnyRow(client, 'subscription_presets', 'rules_json', 'contentLangs');
    case '018_schema_brief_source_refs.sql':
      return columnExists(client, 'briefs', 'source_refs_json');
    case '019_schema_user_api_keys.sql':
      return columnExists(client, 'users', 'api_key_hash');
    default:
      return false;
  }
}

async function applySqlFile(
  client: pg.Client,
  filename: string,
  optional: boolean,
  log: PlatformLogger,
): Promise<'applied' | 'skipped'> {
  const sqlPath = path.join(initDir(), filename);
  const sql = readFileSync(sqlPath, 'utf8');
  try {
    await client.query(sql);
    return 'applied';
  } catch (err) {
    if (optional && isPgVectorMissing(err)) {
      log.warn('skipped migration (pgvector unavailable)', { file: filename });
      return 'skipped';
    }
    if (optional) {
      log.warn('skipped optional migration', { file: filename, error: (err as Error).message });
      return 'skipped';
    }
    throw err;
  }
}

/**
 * Apply pending Platform DB migrations (idempotent SQL + schema_migrations ledger).
 * Safe to call on every platform:api startup when PLATFORM_DB_AUTO_MIGRATE is enabled.
 */
export async function runPlatformDbBootstrap(opts?: {
  databaseUrl?: string;
  logger?: PlatformLogger;
}): Promise<BootstrapResult> {
  const log = opts?.logger ?? createPlatformLogger('platform-db-bootstrap');
  const databaseUrl = opts?.databaseUrl?.trim() ?? process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for database bootstrap');
  }

  const result: BootstrapResult = { applied: [], skipped: [], unchanged: [], stamped: [] };
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await ensureMigrationTable(client);

    for (const entry of PLATFORM_MIGRATION_FILES) {
      const sqlPath = path.join(initDir(), entry.file);
      if (!readdirSync(initDir()).includes(entry.file)) {
        log.warn('migration file missing, skipped', { file: entry.file });
        result.skipped.push(entry.file);
        continue;
      }

      const checksum = fileChecksum(readFileSync(sqlPath, 'utf8'));
      const recorded = await getRecordedChecksum(client, entry.file);

      if (recorded === checksum) {
        result.unchanged.push(entry.file);
        continue;
      }

      if (!recorded && (await isMigrationAlreadyApplied(client, entry.file))) {
        await markApplied(client, entry.file, checksum);
        result.stamped.push(entry.file);
        log.info('stamped pre-existing migration (legacy baseline)', { file: entry.file });
        continue;
      }

      if (recorded && recorded !== checksum) {
        log.info('re-applying migration (file changed)', { file: entry.file });
      }

      const outcome = await applySqlFile(client, entry.file, entry.optional, log);
      if (outcome === 'applied') {
        await markApplied(client, entry.file, checksum);
        result.applied.push(entry.file);
        log.info('migration applied', { file: entry.file });
      } else {
        result.skipped.push(entry.file);
      }
    }

    log.info('database bootstrap complete', {
      applied: result.applied.length,
      stamped: result.stamped.length,
      unchanged: result.unchanged.length,
      skipped: result.skipped.length,
    });

    await runPlatformSeedBootstrap({ logger: log });

    return result;
  } finally {
    await client.end();
  }
}

/** Verify deploy/init contains expected migration files (for diagnostics). */
export function listAvailableMigrationFiles(): string[] {
  return readdirSync(initDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();
}
