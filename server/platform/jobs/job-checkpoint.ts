import { getDefaultWorkspaceId, query } from '../../_shared/db.js';

export interface JobCheckpoint {
  runId?: string;
  completedAt?: string;
  stats?: Record<string, unknown>;
}

export async function getJobCheckpoint(
  handlerKey: string,
  workspaceId?: string,
): Promise<JobCheckpoint | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ checkpoint_json: JobCheckpoint }>(
    `SELECT checkpoint_json FROM job_checkpoints
     WHERE workspace_id = $1 AND handler_key = $2`,
    [ws, handlerKey],
  );
  return res.rows[0]?.checkpoint_json ?? null;
}

export async function setJobCheckpoint(
  handlerKey: string,
  checkpoint: JobCheckpoint,
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await query(
    `INSERT INTO job_checkpoints (workspace_id, handler_key, checkpoint_json, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (workspace_id, handler_key) DO UPDATE SET
       checkpoint_json = EXCLUDED.checkpoint_json,
       updated_at = NOW()`,
    [ws, handlerKey, JSON.stringify(checkpoint)],
  );
}

export async function getJobCheckpointTime(
  handlerKey: string,
  workspaceId?: string,
): Promise<Date | null> {
  const cp = await getJobCheckpoint(handlerKey, workspaceId);
  if (!cp?.completedAt) return null;
  const d = new Date(cp.completedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}
