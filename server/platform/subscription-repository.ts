import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import { getPresetById } from './preset-repository.js';
import {
  normalizeRulesFromRaw,
  type SubscriptionRules,
} from './subscription-rules.js';

export type { SubscriptionRules } from './subscription-rules.js';

export interface SubscriptionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  preset_id: string | null;
  name: string;
  rules_json: SubscriptionRules;
  enabled: boolean;
  created_at: Date;
}

export interface SubscriptionWithUser extends SubscriptionRow {
  user_email: string;
  user_display_name: string | null;
  user_preferred_lang?: string;
  preset_title?: string | null;
  preset_slug?: string | null;
}

const SUB_SELECT = `
  s.id, s.workspace_id, s.user_id, s.preset_id, s.name, s.rules_json, s.enabled, s.created_at
`;

async function resolveRules(
  rulesJson?: SubscriptionRules,
  presetId?: string | null,
): Promise<SubscriptionRules> {
  if (presetId) {
    const preset = await getPresetById(presetId);
    if (!preset) throw new Error('Preset not found');
    if (!preset.enabled) throw new Error('Preset is disabled');
    const base = { ...preset.rules_json };
    if (rulesJson) return normalizeRulesFromRaw({ ...base, ...rulesJson });
    return base;
  }
  return normalizeRulesFromRaw(rulesJson ?? {});
}

export async function createSubscription(opts: {
  userId: string;
  name: string;
  rulesJson?: SubscriptionRules;
  presetId?: string | null;
  enabled?: boolean;
  workspaceId?: string;
}): Promise<SubscriptionRow> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const name = opts.name.trim();
  if (!name) throw new Error('Subscription name is required');

  const rules = await resolveRules(opts.rulesJson, opts.presetId ?? null);

  const res = await query<SubscriptionRow>(
    `INSERT INTO subscriptions (workspace_id, user_id, preset_id, name, rules_json, enabled)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, workspace_id, user_id, preset_id, name, rules_json, enabled, created_at`,
    [
      workspaceId,
      opts.userId,
      opts.presetId ?? null,
      name,
      JSON.stringify(rules),
      opts.enabled !== false,
    ],
  );
  const row = res.rows[0]!;
  return { ...row, rules_json: normalizeRulesFromRaw(row.rules_json) };
}

export async function updateSubscription(
  id: string,
  patch: {
    name?: string;
    rulesJson?: SubscriptionRules;
    presetId?: string | null;
    enabled?: boolean;
  },
): Promise<SubscriptionRow | null> {
  const existing = await getSubscriptionById(id);
  if (!existing) return null;

  const name = patch.name?.trim() ?? existing.name;
  const presetId = patch.presetId !== undefined ? patch.presetId : existing.preset_id;
  let rules = existing.rules_json;
  if (patch.rulesJson || patch.presetId !== undefined) {
    rules = await resolveRules(patch.rulesJson ?? existing.rules_json, presetId);
  }
  const enabled = patch.enabled ?? existing.enabled;

  const res = await query<SubscriptionRow>(
    `UPDATE subscriptions SET name = $2, preset_id = $3, rules_json = $4::jsonb, enabled = $5
     WHERE id = $1
     RETURNING id, workspace_id, user_id, preset_id, name, rules_json, enabled, created_at`,
    [id, name, presetId, JSON.stringify(rules), enabled],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, rules_json: normalizeRulesFromRaw(row.rules_json) };
}

export async function getSubscriptionById(id: string): Promise<SubscriptionRow | null> {
  const res = await query<SubscriptionRow>(
    `SELECT id, workspace_id, user_id, preset_id, name, rules_json, enabled, created_at
     FROM subscriptions WHERE id = $1`,
    [id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, rules_json: normalizeRulesFromRaw(row.rules_json) };
}

export async function listSubscriptions(opts?: {
  userId?: string;
  enabledOnly?: boolean;
  workspaceId?: string;
}): Promise<SubscriptionWithUser[]> {
  const page = await listSubscriptionsPage({
    ...opts,
    page: 1,
    pageSize: 10_000,
  });
  return page.items;
}

export interface ListSubscriptionsPageResult {
  items: SubscriptionWithUser[];
  total: number;
  page: number;
  pageSize: number;
}

function buildSubscriptionListWhere(
  opts: {
    userId?: string;
    enabledOnly?: boolean;
    q?: string;
  },
  params: unknown[],
): string {
  let where = 'WHERE s.workspace_id = $1';
  if (opts.userId) {
    params.push(opts.userId);
    where += ` AND s.user_id = $${params.length}`;
  }
  if (opts.enabledOnly) {
    where += ' AND s.enabled = TRUE';
  }
  const q = opts.q?.trim();
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    where += ` AND (u.email ILIKE ${p} ESCAPE '\\' OR COALESCE(u.display_name, '') ILIKE ${p} ESCAPE '\\' OR s.name ILIKE ${p} ESCAPE '\\')`;
  }
  return where;
}

export async function listSubscriptionsPage(opts?: {
  userId?: string;
  enabledOnly?: boolean;
  workspaceId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListSubscriptionsPageResult> {
  const ws = opts?.workspaceId ?? getDefaultWorkspaceId();
  const page = Math.max(1, opts?.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts?.pageSize ?? 20), 100);
  const offset = (page - 1) * pageSize;

  const countParams: unknown[] = [ws];
  const where = buildSubscriptionListWhere(
    { userId: opts?.userId, enabledOnly: opts?.enabledOnly, q: opts?.q },
    countParams,
  );

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ${where}`,
    countParams,
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  const listParams = [...countParams, pageSize, offset];
  const limitIdx = listParams.length - 1;
  const offsetIdx = listParams.length;

  const res = await query<SubscriptionWithUser>(
    `SELECT ${SUB_SELECT},
            u.email AS user_email, u.display_name AS user_display_name,
            u.preferred_lang AS user_preferred_lang,
            p.title AS preset_title, p.slug AS preset_slug
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN subscription_presets p ON p.id = s.preset_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    listParams,
  );

  return {
    items: res.rows.map((row) => ({
      ...row,
      rules_json: normalizeRulesFromRaw(row.rules_json),
    })),
    total,
    page,
    pageSize,
  };
}

export async function deleteSubscription(id: string): Promise<boolean> {
  const res = await query('DELETE FROM subscriptions WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function getSubscriptionByUserAndPreset(
  userId: string,
  presetId: string,
  workspaceId?: string,
): Promise<SubscriptionRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<SubscriptionRow>(
    `SELECT id, workspace_id, user_id, preset_id, name, rules_json, enabled, created_at
     FROM subscriptions
     WHERE workspace_id = $1 AND user_id = $2 AND preset_id = $3
     ORDER BY created_at DESC LIMIT 1`,
    [ws, userId, presetId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, rules_json: normalizeRulesFromRaw(row.rules_json) };
}

export async function countUserActiveSubscriptions(
  userId: string,
  workspaceId?: string,
): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM subscriptions
     WHERE workspace_id = $1 AND user_id = $2 AND enabled = TRUE`,
    [ws, userId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function countSubscriptions(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM subscriptions WHERE workspace_id = $1',
    [ws],
  );
  return Number(res.rows[0]?.count ?? 0);
}
