import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db';

export type MonitorType = 'competitor' | 'brand' | 'industry';

export interface MonitorProfileRow {
  id: string;
  workspace_id: string;
  monitor_type: string;
  name: string;
  config_json: Record<string, unknown>;
  enabled: boolean;
  created_at: Date;
}

export interface EntityRow {
  id: string;
  workspace_id: string;
  entity_type: string;
  name: string;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

export interface TrackingThreadRow {
  id: string;
  workspace_id: string;
  title: string;
  status: string;
  metadata_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export async function createMonitorProfile(input: {
  workspaceId?: string;
  monitorType: MonitorType;
  name: string;
  configJson?: Record<string, unknown>;
}): Promise<MonitorProfileRow> {
  const workspaceId = input.workspaceId ?? getDefaultWorkspaceId();
  const res = await query<MonitorProfileRow>(
    `INSERT INTO monitor_profiles (workspace_id, monitor_type, name, config_json)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workspaceId, input.monitorType, input.name, JSON.stringify(input.configJson ?? {})],
  );
  return res.rows[0]!;
}

export async function listMonitorProfiles(workspaceId?: string): Promise<MonitorProfileRow[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<MonitorProfileRow>(
    `SELECT * FROM monitor_profiles WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [ws],
  );
  return res.rows;
}

export async function getMonitorProfile(id: string, workspaceId?: string): Promise<MonitorProfileRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<MonitorProfileRow>(
    `SELECT * FROM monitor_profiles WHERE id = $1 AND workspace_id = $2`,
    [id, ws],
  );
  return res.rows[0] ?? null;
}

export async function upsertEntity(input: {
  workspaceId?: string;
  entityType: string;
  name: string;
  metadataJson?: Record<string, unknown>;
}): Promise<EntityRow> {
  const workspaceId = input.workspaceId ?? getDefaultWorkspaceId();
  const existing = await query<EntityRow>(
    `SELECT * FROM entities
     WHERE workspace_id = $1 AND entity_type = $2 AND lower(name) = lower($3)
     LIMIT 1`,
    [workspaceId, input.entityType, input.name],
  );
  if (existing.rows[0]) return existing.rows[0];

  const res = await query<EntityRow>(
    `INSERT INTO entities (workspace_id, entity_type, name, metadata_json)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workspaceId, input.entityType, input.name, JSON.stringify(input.metadataJson ?? {})],
  );
  return res.rows[0]!;
}

export async function linkEntityMention(entityId: string, newsItemId: string): Promise<void> {
  await query(
    `INSERT INTO entity_mentions (entity_id, news_item_id)
     VALUES ($1, $2)
     ON CONFLICT (entity_id, news_item_id) DO NOTHING`,
    [entityId, newsItemId],
  );
}

export async function createTrackingThread(input: {
  workspaceId?: string;
  title: string;
  metadataJson?: Record<string, unknown>;
}): Promise<TrackingThreadRow> {
  const workspaceId = input.workspaceId ?? getDefaultWorkspaceId();
  const res = await query<TrackingThreadRow>(
    `INSERT INTO tracking_threads (workspace_id, title, metadata_json)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [workspaceId, input.title, JSON.stringify(input.metadataJson ?? {})],
  );
  return res.rows[0]!;
}

export async function countEntityMentions(
  entityId: string,
  days = 30,
): Promise<number> {
  const res = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM entity_mentions em
     JOIN news_items n ON n.id = em.news_item_id
     WHERE em.entity_id = $1
       AND n.published_at >= NOW() - make_interval(days => $2)`,
    [entityId, days],
  );
  return Number(res.rows[0]?.n ?? 0);
}
