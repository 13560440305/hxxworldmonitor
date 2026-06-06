import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import {
  normalizeRulesFromRaw,
  type SubscriptionRules,
} from './subscription-rules.js';

export interface SubscriptionPresetRow {
  id: string;
  workspace_id: string;
  slug: string;
  title: string;
  description: string | null;
  rules_json: SubscriptionRules;
  enabled: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

function mapPreset(row: SubscriptionPresetRow): SubscriptionPresetRow {
  return { ...row, rules_json: normalizeRulesFromRaw(row.rules_json) };
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `preset-${Date.now()}`;
}

export async function listPresets(opts?: {
  workspaceId?: string;
  enabledOnly?: boolean;
  publicCatalog?: boolean;
}): Promise<SubscriptionPresetRow[]> {
  const ws = opts?.workspaceId ?? getDefaultWorkspaceId();
  const params: unknown[] = [ws];
  let sql = `
    SELECT id, workspace_id, slug, title, description, rules_json, enabled, sort_order, created_at, updated_at
    FROM subscription_presets
    WHERE workspace_id = $1
  `;
  if (opts?.enabledOnly || opts?.publicCatalog) {
    sql += ' AND enabled = TRUE';
  }
  sql += ' ORDER BY sort_order ASC, title ASC';

  const res = await query<SubscriptionPresetRow>(sql, params);
  return res.rows.map(mapPreset);
}

export async function getPresetById(id: string): Promise<SubscriptionPresetRow | null> {
  const res = await query<SubscriptionPresetRow>(
    `SELECT id, workspace_id, slug, title, description, rules_json, enabled, sort_order, created_at, updated_at
     FROM subscription_presets WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  return row ? mapPreset(row) : null;
}

export async function getPresetBySlug(
  slug: string,
  workspaceId?: string,
): Promise<SubscriptionPresetRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<SubscriptionPresetRow>(
    `SELECT id, workspace_id, slug, title, description, rules_json, enabled, sort_order, created_at, updated_at
     FROM subscription_presets WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug.trim()],
  );
  const row = res.rows[0];
  return row ? mapPreset(row) : null;
}

export async function createPreset(opts: {
  title: string;
  slug?: string;
  description?: string;
  rulesJson?: SubscriptionRules;
  enabled?: boolean;
  sortOrder?: number;
  workspaceId?: string;
}): Promise<SubscriptionPresetRow> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const title = opts.title.trim();
  if (!title) throw new Error('Preset title is required');
  const slug = opts.slug?.trim() ? slugify(opts.slug) : slugify(title);

  const res = await query<SubscriptionPresetRow>(
    `INSERT INTO subscription_presets (workspace_id, slug, title, description, rules_json, enabled, sort_order)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, workspace_id, slug, title, description, rules_json, enabled, sort_order, created_at, updated_at`,
    [
      workspaceId,
      slug,
      title,
      opts.description?.trim() || null,
      JSON.stringify(normalizeRulesFromRaw(opts.rulesJson ?? {})),
      opts.enabled !== false,
      opts.sortOrder ?? 0,
    ],
  );
  return mapPreset(res.rows[0]!);
}

export async function updatePreset(
  id: string,
  patch: {
    title?: string;
    slug?: string;
    description?: string;
    rulesJson?: SubscriptionRules;
    enabled?: boolean;
    sortOrder?: number;
  },
): Promise<SubscriptionPresetRow | null> {
  const existing = await getPresetById(id);
  if (!existing) return null;

  const res = await query<SubscriptionPresetRow>(
    `UPDATE subscription_presets SET
       slug = $2,
       title = $3,
       description = $4,
       rules_json = $5::jsonb,
       enabled = $6,
       sort_order = $7,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id, workspace_id, slug, title, description, rules_json, enabled, sort_order, created_at, updated_at`,
    [
      id,
      patch.slug !== undefined ? slugify(patch.slug) : existing.slug,
      patch.title?.trim() ?? existing.title,
      patch.description !== undefined ? (patch.description.trim() || null) : existing.description,
      JSON.stringify(
        patch.rulesJson ? normalizeRulesFromRaw(patch.rulesJson) : existing.rules_json,
      ),
      patch.enabled ?? existing.enabled,
      patch.sortOrder ?? existing.sort_order,
    ],
  );
  const row = res.rows[0];
  return row ? mapPreset(row) : null;
}

export async function deletePreset(id: string): Promise<boolean> {
  const res = await query('DELETE FROM subscription_presets WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}
