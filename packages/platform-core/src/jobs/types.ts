export type JobTier = 'realtime' | 'batch' | 'heavy';
export type ScheduleKind = 'interval' | 'cron';
export type JobRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobDefinitionRow {
  id: string;
  workspace_id: string;
  handler_key: string;
  display_name: string;
  tier: JobTier;
  schedule_kind: ScheduleKind;
  cron_expr: string | null;
  interval_seconds: number | null;
  timezone: string;
  enabled: boolean;
  max_concurrency: number;
  timeout_sec: number;
  max_attempts: number;
  payload_json: Record<string, unknown>;
  next_run_at: Date | null;
  last_run_at: Date | null;
}

export interface JobRunRow {
  id: string;
  workspace_id: string;
  definition_id: string | null;
  handler_key: string;
  status: JobRunStatus;
  payload_json: Record<string, unknown>;
  scheduled_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  locked_by: string | null;
  locked_until: Date | null;
  attempt: number;
  max_attempts: number;
  error_message: string | null;
  stats_json: Record<string, unknown> | null;
}

export interface JobContext {
  runId: string;
  workspaceId: string;
  handlerKey: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
}

export interface JobResult {
  stats?: Record<string, unknown>;
}

export interface JobHandler {
  key: string;
  tier: JobTier;
  run(ctx: JobContext): Promise<JobResult>;
}

export interface JobDefinitionSeed {
  handlerKey: string;
  displayName: string;
  tier: JobTier;
  scheduleKind: ScheduleKind;
  cronExpr?: string;
  intervalSeconds?: number;
  timezone?: string;
  maxConcurrency?: number;
  timeoutSec?: number;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}
