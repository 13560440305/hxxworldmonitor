import pg from 'pg';

declare const process: { env: Record<string, string | undefined> };

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isDatabaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPool(): pg.Pool {
  if (!isDatabaseEnabled()) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err);
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function getDefaultWorkspaceId(): string {
  return process.env.PLATFORM_DEFAULT_WORKSPACE_ID ?? '00000000-0000-0000-0000-000000000001';
}

export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!isDatabaseEnabled()) {
    return { ok: false, error: 'DATABASE_URL not set' };
  }
  const start = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: String(e), latencyMs: Date.now() - start };
  }
}
