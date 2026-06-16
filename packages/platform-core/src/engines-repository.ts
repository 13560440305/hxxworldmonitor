import { getDefaultWorkspaceId, isDatabaseEnabled, query } from '@hxxworldmonitor/shared/db.js';
import { decryptSettingValue, encryptSettingValue } from '@hxxworldmonitor/shared/setting-crypto.js';
import {
  ENGINE_CATALOG,
  getEngineDefinition,
  type EngineDefinition,
  type EngineType,
} from './engine-catalog.js';

declare const process: { env: Record<string, string | undefined> };

export interface EngineRow {
  workspace_id: string;
  slug: string;
  display_name: string;
  engine_type: string;
  base_url: string;
  api_key_enc: string | null;
  enabled: boolean;
  sort_order: number;
  is_custom: boolean;
  remarks: string;
}

export interface EnginePublic {
  slug: string;
  displayName: string;
  engineType: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  configured: boolean;
  sortOrder: number;
  custom: boolean;
  remarks: string;
}

export interface ResolvedEngine {
  slug: string;
  displayName: string;
  engineType: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  source: 'db' | 'default';
}

const CUSTOM_SLUG_RE = /^[a-z][a-z0-9_-]{1,47}$/;

function maskApiKey(key: string): string | null {
  if (!key) return null;
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

function normalizeRemarks(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (t.length > 2000) throw new Error('备注不能超过 2000 个字符');
  return t;
}

function resolveEnvFallback(def: EngineDefinition | undefined): { baseUrl: string; apiKey: string } {
  if (!def) return { baseUrl: '', apiKey: '' };
  const envBase = def.envBaseUrl ? process.env[def.envBaseUrl]?.trim() : '';
  const envKey = def.envApiKey ? process.env[def.envApiKey]?.trim() : '';
  const baseUrl = (envBase || def.defaultBaseUrl || '').replace(/\/+$/, '');
  return { baseUrl, apiKey: envKey ?? '' };
}

function rowToPublic(row: EngineRow): EnginePublic {
  const def = getEngineDefinition(row.slug);
  const dbKey = decryptSettingValue(row.api_key_enc) ?? '';
  const fallback = resolveEnvFallback(def);
  const baseUrl = (row.base_url?.trim() || fallback.baseUrl || def?.defaultBaseUrl || '').replace(/\/+$/, '');
  const effectiveKey = dbKey || fallback.apiKey;
  return {
    slug: row.slug,
    displayName: row.display_name,
    engineType: row.engine_type,
    baseUrl,
    enabled: row.enabled,
    hasApiKey: Boolean(dbKey),
    apiKeyHint: maskApiKey(effectiveKey),
    configured: Boolean(baseUrl && (effectiveKey || def?.apiKeyOptional)),
    sortOrder: row.sort_order,
    custom: Boolean(row.is_custom),
    remarks: row.remarks?.trim() || def?.defaultRemarks || '',
  };
}

function validateCustomSlug(slug: string): void {
  if (!CUSTOM_SLUG_RE.test(slug)) {
    throw new Error('标识须为小写字母开头，仅含 a-z、0-9、_、-，长度 2–48');
  }
  if (getEngineDefinition(slug)) {
    throw new Error('该标识已被内置引擎占用');
  }
}

function validateEngineType(engineType: string): EngineType {
  const t = engineType.trim() as EngineType;
  if (!['crawl', 'browser', 'custom'].includes(t)) {
    throw new Error('无效的引擎类型');
  }
  return t;
}

export async function ensureEngineSeeds(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  let inserted = 0;
  for (const e of ENGINE_CATALOG) {
    const res = await query(
      `INSERT INTO engines
         (workspace_id, slug, display_name, engine_type, base_url, enabled, sort_order, remarks)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
       ON CONFLICT (workspace_id, slug) DO NOTHING`,
      [ws, e.slug, e.displayName, e.engineType, e.defaultBaseUrl, e.sortOrder, e.defaultRemarks ?? ''],
    );
    inserted += res.rowCount ?? 0;

    if (e.defaultRemarks) {
      await query(
        `UPDATE engines SET remarks = $3, updated_at = NOW()
         WHERE workspace_id = $1 AND slug = $2 AND is_custom = FALSE
           AND COALESCE(TRIM(remarks), '') = ''`,
        [ws, e.slug, e.defaultRemarks],
      );
    }
  }
  return inserted;
}

export async function listEnginesPublic(workspaceId?: string): Promise<EnginePublic[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureEngineSeeds(ws);
  const res = await query<EngineRow>(
    `SELECT workspace_id, slug, display_name, engine_type, base_url, api_key_enc,
            enabled, sort_order, is_custom, remarks
     FROM engines WHERE workspace_id = $1
     ORDER BY engine_type ASC, sort_order ASC, display_name ASC`,
    [ws],
  );
  return res.rows.map(rowToPublic);
}

export async function getEngine(
  slug: string,
  workspaceId?: string,
): Promise<ResolvedEngine | null> {
  if (!isDatabaseEnabled()) return null;
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureEngineSeeds(ws);
  const res = await query<EngineRow>(
    `SELECT workspace_id, slug, display_name, engine_type, base_url, api_key_enc,
            enabled, sort_order, is_custom, remarks
     FROM engines WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  const row = res.rows[0];
  if (!row) return null;

  const def = getEngineDefinition(slug);
  if (!def && !row.is_custom) return null;

  const fallback = resolveEnvFallback(def);
  const baseUrl = (row.base_url?.trim() || fallback.baseUrl || def?.defaultBaseUrl || '').replace(/\/+$/, '');
  const dbKey = decryptSettingValue(row.api_key_enc) ?? '';
  const apiKey = dbKey || fallback.apiKey;

  if (!row.enabled) {
    return {
      slug,
      displayName: row.display_name,
      engineType: row.engine_type,
      baseUrl,
      apiKey: '',
      enabled: false,
      source: 'db',
    };
  }

  if (!baseUrl || (!def?.apiKeyOptional && !apiKey)) return null;

  return {
    slug,
    displayName: row.display_name,
    engineType: row.engine_type,
    baseUrl,
    apiKey,
    enabled: true,
    source: dbKey ? 'db' : 'default',
  };
}

let engineCacheExpiresAt = 0;
const engineCache = new Map<string, ResolvedEngine | null>();

export async function getEngineCached(
  slug: string,
  workspaceId?: string,
): Promise<ResolvedEngine | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const key = `${ws}:${slug}`;
  const now = Date.now();
  if (now < engineCacheExpiresAt && engineCache.has(key)) {
    return engineCache.get(key) ?? null;
  }
  const resolved = await getEngine(slug, ws);
  engineCache.set(key, resolved);
  if (engineCache.size === 1) engineCacheExpiresAt = now + 60_000;
  return resolved;
}

export function invalidateEngineCache(): void {
  engineCache.clear();
  engineCacheExpiresAt = 0;
}

export async function createCustomEngine(
  input: {
    slug: string;
    displayName: string;
    engineType: string;
    baseUrl: string;
    apiKey?: string;
    enabled?: boolean;
    remarks?: string;
  },
  workspaceId?: string,
): Promise<EnginePublic> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const slug = input.slug.trim().toLowerCase();
  validateCustomSlug(slug);

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('请填写显示名称');

  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) throw new Error('请填写 Base URL');

  const engineType = validateEngineType(input.engineType);

  const dup = await query(
    `SELECT 1 FROM engines WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  if ((dup.rowCount ?? 0) > 0) throw new Error('该标识已存在');

  const maxSort = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM engines WHERE workspace_id = $1`,
    [ws],
  );
  const sortOrder = (maxSort.rows[0]?.max ?? 0) + 10;
  const apiKeyEnc = input.apiKey?.trim() ? encryptSettingValue(input.apiKey.trim()) : null;
  const remarks = normalizeRemarks(input.remarks);

  await query(
    `INSERT INTO engines
       (workspace_id, slug, display_name, engine_type, base_url, api_key_enc, enabled, sort_order, is_custom, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)`,
    [ws, slug, displayName, engineType, baseUrl, apiKeyEnc, input.enabled !== false, sortOrder, remarks],
  );

  invalidateEngineCache();
  const list = await listEnginesPublic(ws);
  const created = list.find((e) => e.slug === slug);
  if (!created) throw new Error('创建失败');
  return created;
}

export async function updateEngine(
  slug: string,
  patch: {
    displayName?: string;
    engineType?: string;
    baseUrl?: string;
    apiKey?: string | null;
    enabled?: boolean;
    clearApiKey?: boolean;
    remarks?: string;
  },
  workspaceId?: string,
): Promise<EnginePublic | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureEngineSeeds(ws);

  const existing = await query<EngineRow>(
    `SELECT workspace_id, slug, display_name, engine_type, base_url, api_key_enc,
            enabled, sort_order, is_custom, remarks
     FROM engines WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  const row = existing.rows[0];
  if (!row) return null;

  const def = getEngineDefinition(slug);
  if (!def && !row.is_custom) return null;

  const displayName = patch.displayName !== undefined ? patch.displayName.trim() : row.display_name;
  if (!displayName) throw new Error('显示名称不能为空');

  const engineType = patch.engineType !== undefined
    ? validateEngineType(patch.engineType)
    : row.engine_type;
  const baseUrl = patch.baseUrl !== undefined ? patch.baseUrl.trim() : row.base_url;
  const enabled = patch.enabled ?? row.enabled;
  let apiKeyEnc = row.api_key_enc;
  if (patch.clearApiKey) {
    apiKeyEnc = null;
  } else if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    apiKeyEnc = encryptSettingValue(patch.apiKey.trim());
  }
  const remarks = patch.remarks !== undefined ? normalizeRemarks(patch.remarks) : (row.remarks ?? '');

  await query(
    `UPDATE engines SET
       display_name = $3,
       engine_type = $4,
       base_url = $5,
       api_key_enc = $6,
       enabled = $7,
       remarks = $8,
       updated_at = NOW()
     WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug, displayName, engineType, baseUrl, apiKeyEnc, enabled, remarks],
  );

  invalidateEngineCache();
  const list = await listEnginesPublic(ws);
  return list.find((e) => e.slug === slug) ?? null;
}

export async function assertEngineExists(slug: string, workspaceId?: string): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureEngineSeeds(ws);
  const res = await query(
    `SELECT 1 FROM engines WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  if ((res.rowCount ?? 0) === 0) {
    throw new Error(`采集引擎「${slug}」不存在，请先在「采集引擎」中配置`);
  }
}
