import { getDefaultWorkspaceId, query, withTransaction } from '../../_shared/db.js';
import { computeNextRunAt } from './cron.js';
import type {
  JobDefinitionRow,
  JobDefinitionSeed,
  JobRunRow,
  JobRunStatus,
} from './types.js';

declare const process: { env: Record<string, string | undefined> };

const SCHEDULER_LOCK_KEY = 1464819053; // advisory lock id (WM scheduler)

function mapDefinition(row: Record<string, unknown>): JobDefinitionRow {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    handler_key: row.handler_key as string,
    display_name: row.display_name as string,
    tier: row.tier as JobDefinitionRow['tier'],
    schedule_kind: row.schedule_kind as JobDefinitionRow['schedule_kind'],
    cron_expr: row.cron_expr as string | null,
    interval_seconds: row.interval_seconds as number | null,
    timezone: row.timezone as string,
    enabled: row.enabled as boolean,
    max_concurrency: Number(row.max_concurrency),
    timeout_sec: Number(row.timeout_sec),
    max_attempts: Number(row.max_attempts),
    payload_json: (row.payload_json as Record<string, unknown>) ?? {},
    next_run_at: row.next_run_at ? new Date(row.next_run_at as string) : null,
    last_run_at: row.last_run_at ? new Date(row.last_run_at as string) : null,
  };
}

function mapRun(row: Record<string, unknown>): JobRunRow {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    definition_id: row.definition_id as string | null,
    handler_key: row.handler_key as string,
    status: row.status as JobRunRow['status'],
    payload_json: (row.payload_json as Record<string, unknown>) ?? {},
    scheduled_at: new Date(row.scheduled_at as string),
    started_at: row.started_at ? new Date(row.started_at as string) : null,
    finished_at: row.finished_at ? new Date(row.finished_at as string) : null,
    locked_by: row.locked_by as string | null,
    locked_until: row.locked_until ? new Date(row.locked_until as string) : null,
    attempt: Number(row.attempt),
    max_attempts: Number(row.max_attempts),
    error_message: row.error_message as string | null,
    stats_json: row.stats_json as Record<string, unknown> | null,
  };
}

/** Postgres advisory lock — only one scheduler leader. */
export async function tryAcquireSchedulerLock(): Promise<boolean> {
  const res = await query<{ ok: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS ok',
    [SCHEDULER_LOCK_KEY],
  );
  if (!res.rows[0]?.ok) return false;
  return true;
}

export async function releaseSchedulerLock(): Promise<void> {
  await query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_KEY]);
}

export async function upsertJobDefinition(
  workspaceId: string,
  seed: JobDefinitionSeed,
): Promise<void> {
  const nextRun = computeNextRunAt({
    scheduleKind: seed.scheduleKind,
    cronExpr: seed.cronExpr,
    intervalSeconds: seed.intervalSeconds,
    timezone: seed.timezone ?? 'UTC',
  });

  await query(
    `INSERT INTO job_definitions (
      workspace_id, handler_key, display_name, tier,
      schedule_kind, cron_expr, interval_seconds, timezone,
      enabled, max_concurrency, timeout_sec, max_attempts,
      payload_json, next_run_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
    ON CONFLICT (workspace_id, handler_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      tier = EXCLUDED.tier,
      schedule_kind = EXCLUDED.schedule_kind,
      cron_expr = EXCLUDED.cron_expr,
      interval_seconds = EXCLUDED.interval_seconds,
      timezone = EXCLUDED.timezone,
      max_concurrency = EXCLUDED.max_concurrency,
      timeout_sec = EXCLUDED.timeout_sec,
      max_attempts = EXCLUDED.max_attempts,
      payload_json = EXCLUDED.payload_json,
      next_run_at = COALESCE(job_definitions.next_run_at, EXCLUDED.next_run_at),
      updated_at = NOW()`,
    [
      workspaceId,
      seed.handlerKey,
      seed.displayName,
      seed.tier,
      seed.scheduleKind,
      seed.cronExpr ?? null,
      seed.intervalSeconds ?? null,
      seed.timezone ?? 'UTC',
      seed.enabled ?? true,
      seed.maxConcurrency ?? 1,
      seed.timeoutSec ?? 3600,
      seed.maxAttempts ?? 3,
      JSON.stringify(seed.payload ?? {}),
      nextRun,
    ],
  );
}

export async function listDueJobDefinitions(now = new Date()): Promise<JobDefinitionRow[]> {
  const res = await query(
    `SELECT * FROM job_definitions
     WHERE enabled = TRUE
       AND next_run_at IS NOT NULL
       AND next_run_at <= $1
     ORDER BY next_run_at ASC
     LIMIT 50`,
    [now],
  );
  return res.rows.map((r) => mapDefinition(r as Record<string, unknown>));
}

export async function enqueueJobRun(
  def: JobDefinitionRow,
  scheduledAt = new Date(),
): Promise<JobRunRow> {
  return withTransaction(async (client) => {
    const insert = await client.query(
      `INSERT INTO job_runs (
        workspace_id, definition_id, handler_key, status,
        payload_json, scheduled_at, max_attempts
      ) VALUES ($1,$2,$3,'pending',$4,$5,$6)
      RETURNING *`,
      [
        def.workspace_id,
        def.id,
        def.handler_key,
        JSON.stringify(def.payload_json),
        scheduledAt,
        def.max_attempts,
      ],
    );
    const nextRun = computeNextRunAt({
      scheduleKind: def.schedule_kind,
      cronExpr: def.cron_expr,
      intervalSeconds: def.interval_seconds,
      timezone: def.timezone,
      from: scheduledAt,
    });
    await client.query(
      `UPDATE job_definitions SET
        next_run_at = $1,
        last_run_at = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [nextRun, scheduledAt, def.id],
    );
    return mapRun(insert.rows[0] as Record<string, unknown>);
  });
}

export async function enqueueManualJobRun(opts: {
  handlerKey: string;
  payload?: Record<string, unknown>;
  workspaceId?: string;
}): Promise<JobRunRow> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const defRes = await query(
    `SELECT * FROM job_definitions WHERE workspace_id = $1 AND handler_key = $2`,
    [workspaceId, opts.handlerKey],
  );
  const def = defRes.rows[0]
    ? mapDefinition(defRes.rows[0] as Record<string, unknown>)
    : null;

  const res = await query(
    `INSERT INTO job_runs (
      workspace_id, definition_id, handler_key, status,
      payload_json, scheduled_at, max_attempts
    ) VALUES ($1,$2,$3,'pending',$4,NOW(),$5)
    RETURNING *`,
    [
      workspaceId,
      def?.id ?? null,
      opts.handlerKey,
      JSON.stringify(opts.payload ?? def?.payload_json ?? {}),
      def?.max_attempts ?? 3,
    ],
  );
  return mapRun(res.rows[0] as Record<string, unknown>);
}

export async function countRunningJobs(handlerKey: string): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM job_runs
     WHERE handler_key = $1 AND status = 'running'`,
    [handlerKey],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function countActiveJobRuns(handlerKey: string): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM job_runs
     WHERE handler_key = $1 AND status IN ('pending', 'running')`,
    [handlerKey],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function claimNextPendingRun(
  workerId: string,
  lockTtlSec = 300,
): Promise<JobRunRow | null> {
  return withTransaction(async (client) => {
    const pending = await client.query(
      `SELECT r.*, d.max_concurrency
       FROM job_runs r
       LEFT JOIN job_definitions d ON d.id = r.definition_id
       WHERE r.status = 'pending'
         AND r.scheduled_at <= NOW()
       ORDER BY r.scheduled_at ASC
       FOR UPDATE OF r SKIP LOCKED
       LIMIT 20`,
    );

    for (const row of pending.rows) {
      const handlerKey = row.handler_key as string;
      const maxConc = Number(row.max_concurrency ?? 1);
      const running = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM job_runs
         WHERE handler_key = $1 AND status = 'running'`,
        [handlerKey],
      );
      if (Number(running.rows[0]?.n ?? 0) >= maxConc) continue;

      const lockedUntil = new Date(Date.now() + lockTtlSec * 1000);
      const updated = await client.query(
        `UPDATE job_runs SET
          status = 'running',
          started_at = NOW(),
          locked_by = $1,
          locked_until = $2
         WHERE id = $3
         RETURNING *`,
        [workerId, lockedUntil, row.id],
      );
      return mapRun(updated.rows[0] as Record<string, unknown>);
    }
    return null;
  });
}

export async function finishJobRun(
  runId: string,
  status: JobRunStatus,
  opts?: { errorMessage?: string; stats?: Record<string, unknown> },
): Promise<void> {
  await query(
    `UPDATE job_runs SET
      status = $1,
      finished_at = NOW(),
      error_message = $2,
      stats_json = $3,
      locked_by = NULL,
      locked_until = NULL
     WHERE id = $4`,
    [
      status,
      opts?.errorMessage ?? null,
      opts?.stats ? JSON.stringify(opts.stats) : null,
      runId,
    ],
  );
}

export async function listRecentJobRuns(limit = 20): Promise<JobRunRow[]> {
  const res = await query(
    `SELECT * FROM job_runs ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 100)],
  );
  return res.rows.map((r) => mapRun(r as Record<string, unknown>));
}

export async function listJobDefinitions(workspaceId?: string): Promise<JobDefinitionRow[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query(
    `SELECT * FROM job_definitions WHERE workspace_id = $1 ORDER BY handler_key ASC`,
    [ws],
  );
  return res.rows.map((r) => mapDefinition(r as Record<string, unknown>));
}

export async function setJobDefinitionEnabled(
  handlerKey: string,
  enabled: boolean,
  workspaceId?: string,
): Promise<JobDefinitionRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query(
    `UPDATE job_definitions SET enabled = $1, updated_at = NOW()
     WHERE workspace_id = $2 AND handler_key = $3
     RETURNING *`,
    [enabled, ws, handlerKey],
  );
  const row = res.rows[0];
  return row ? mapDefinition(row as Record<string, unknown>) : null;
}

export async function getHandlerTimeoutSec(handlerKey: string): Promise<number> {
  const res = await query<{ timeout_sec: number }>(
    `SELECT timeout_sec FROM job_definitions WHERE handler_key = $1 LIMIT 1`,
    [handlerKey],
  );
  const sec = res.rows[0]?.timeout_sec;
  if (sec != null && sec > 0) return sec;
  return Math.max(60, Number(process.env.PLATFORM_JOB_DEFAULT_TIMEOUT_SEC ?? 3600));
}
