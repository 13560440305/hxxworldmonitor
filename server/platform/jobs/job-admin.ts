import type { JobDefinitionRow, JobRunRow } from './types.js';

export function jobDefinitionToJson(row: JobDefinitionRow): Record<string, unknown> {
  return {
    id: row.id,
    handlerKey: row.handler_key,
    displayName: row.display_name,
    tier: row.tier,
    scheduleKind: row.schedule_kind,
    cronExpr: row.cron_expr,
    intervalSeconds: row.interval_seconds,
    timezone: row.timezone,
    enabled: row.enabled,
    maxConcurrency: row.max_concurrency,
    timeoutSec: row.timeout_sec,
    maxAttempts: row.max_attempts,
    payload: row.payload_json,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
  };
}

export function jobRunToJson(row: JobRunRow): Record<string, unknown> {
  return {
    id: row.id,
    handlerKey: row.handler_key,
    definitionId: row.definition_id,
    status: row.status,
    payload: row.payload_json,
    scheduledAt: row.scheduled_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    errorMessage: row.error_message,
    stats: row.stats_json,
  };
}
