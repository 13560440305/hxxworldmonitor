import { getDefaultWorkspaceId, isDatabaseEnabled, query } from '../_shared/db.js';
import { decryptSettingValue, encryptSettingValue } from '../_shared/setting-crypto.js';
import {
  INTEGRATION_PROVIDER_CATALOG,
  getProviderDefinition,
  type IntegrationProviderDefinition,
} from './integration-provider-catalog.js';

export interface IntegrationProviderRow {
  workspace_id: string;
  slug: string;
  display_name: string;
  category: string;
  base_url: string;
  api_key_enc: string | null;
  model_name: string | null;
  enabled: boolean;
  sort_order: number;
  is_custom: boolean;
  remarks: string;
}

export interface IntegrationProviderPublic {
  slug: string;
  displayName: string;
  category: string;
  baseUrl: string;
  modelName: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  configured: boolean;
  sortOrder: number;
  custom: boolean;
  remarks: string;
}

export interface ResolvedIntegrationProvider {
  slug: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  enabled: boolean;
  source: 'db' | 'default';
}

function maskApiKey(key: string): string | null {
  if (!key) return null;
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}

function isAiProviderConfigured(
  def: IntegrationProviderDefinition | undefined,
  baseUrl: string,
  modelName: string,
  apiKey: string,
): boolean {
  if (!baseUrl || !modelName) return false;
  if (def?.apiKeyOptional) return true;
  return Boolean(apiKey);
}

const CUSTOM_SLUG_RE = /^[a-z][a-z0-9_-]{1,47}$/;

export const DATA_INTEGRATION_CATEGORIES = [
  'platform',
  'market',
  'energy',
  'geo',
  'military',
  'aviation',
  'cyber',
  'relay',
  'custom',
] as const;

export type DataIntegrationCategory = typeof DATA_INTEGRATION_CATEGORIES[number];

function normalizeRemarks(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (t.length > 2000) throw new Error('备注不能超过 2000 个字符');
  return t;
}

function rowToPublic(row: IntegrationProviderRow): IntegrationProviderPublic {
  const def = getProviderDefinition(row.slug);
  const dbKey = decryptSettingValue(row.api_key_enc) ?? '';
  const baseUrl = (row.base_url?.trim() || def?.defaultBaseUrl || '').replace(/\/+$/, '');
  const modelName = row.model_name?.trim() || def?.defaultModel || '';
  const isAi = def?.category === 'ai' || row.category === 'ai';
  return {
    slug: row.slug,
    displayName: row.display_name,
    category: row.category,
    baseUrl,
    modelName: modelName || null,
    enabled: row.enabled,
    hasApiKey: Boolean(dbKey),
    apiKeyHint: maskApiKey(dbKey),
    configured: isAi
      ? isAiProviderConfigured(def, baseUrl, modelName, dbKey)
      : Boolean(baseUrl && dbKey) || (def?.apiKeyOptional && Boolean(baseUrl)),
    sortOrder: row.sort_order,
    custom: Boolean(row.is_custom),
    remarks: row.remarks?.trim() || def?.defaultRemarks || '',
  };
}

function validateCustomSlug(slug: string): void {
  if (!CUSTOM_SLUG_RE.test(slug)) {
    throw new Error('标识须为小写字母开头，仅含 a-z、0-9、_、-，长度 2–48');
  }
  const def = getProviderDefinition(slug);
  if (def) {
    throw new Error('该标识已被内置数据源占用');
  }
}

function validateCustomProviderCategory(category: string): void {
  const c = category.trim();
  if (!c) throw new Error('请填写分组');
  if ((DATA_INTEGRATION_CATEGORIES as readonly string[]).includes(c) && c !== 'custom') {
    return;
  }
  if (c === 'custom') {
    throw new Error('请填写自定义分组名称');
  }
  if (c.length < 2 || c.length > 64) {
    throw new Error('自定义分组名称须为 2–64 个字符');
  }
}

export async function ensureIntegrationProviderSeeds(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  let inserted = 0;
  for (const p of INTEGRATION_PROVIDER_CATALOG) {
    const res = await query(
      `INSERT INTO integration_providers
         (workspace_id, slug, display_name, category, base_url, model_name, enabled, sort_order, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
       ON CONFLICT (workspace_id, slug) DO NOTHING`,
      [ws, p.slug, p.displayName, p.category, p.defaultBaseUrl, p.defaultModel ?? null, p.sortOrder, p.defaultRemarks ?? ''],
    );
    inserted += res.rowCount ?? 0;

    if (p.defaultRemarks) {
      await query(
        `UPDATE integration_providers SET remarks = $3, updated_at = NOW()
         WHERE workspace_id = $1 AND slug = $2 AND is_custom = FALSE
           AND COALESCE(TRIM(remarks), '') = ''`,
        [ws, p.slug, p.defaultRemarks],
      );
    }
  }
  return inserted;
}

const CATEGORY_SORT_SQL = `
  CASE category
    WHEN 'platform' THEN 1
    WHEN 'market' THEN 2
    WHEN 'energy' THEN 3
    WHEN 'geo' THEN 4
    WHEN 'military' THEN 5
    WHEN 'aviation' THEN 6
    WHEN 'cyber' THEN 7
    WHEN 'relay' THEN 8
    WHEN 'ai' THEN 9
    ELSE 99
  END`;

export async function listIntegrationProvidersPublic(
  workspaceId?: string,
  scope: IntegrationListScope = 'all',
): Promise<IntegrationProviderPublic[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIntegrationProviderSeeds(ws);
  const res = await query<IntegrationProviderRow>(
    `SELECT workspace_id, slug, display_name, category, base_url, api_key_enc, model_name, enabled, sort_order, is_custom, remarks
     FROM integration_providers WHERE workspace_id = $1
     ORDER BY ${CATEGORY_SORT_SQL}, sort_order ASC, display_name ASC`,
    [ws],
  );
  const rows = res.rows.map((row) => rowToPublic(row));
  if (scope === 'ai') return rows.filter((p) => p.category === 'ai');
  if (scope === 'data') return rows.filter((p) => p.category !== 'ai');
  return rows;
}

export async function getIntegrationProvider(
  slug: string,
  workspaceId?: string,
): Promise<ResolvedIntegrationProvider | null> {
  if (!isDatabaseEnabled()) return null;
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIntegrationProviderSeeds(ws);
  const res = await query<IntegrationProviderRow>(
    `SELECT workspace_id, slug, display_name, category, base_url, api_key_enc, model_name, enabled, sort_order, is_custom, remarks
     FROM integration_providers WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  const row = res.rows[0];
  if (!row) return null;

  const def = getProviderDefinition(slug);
  if (!def && !row.is_custom) return null;

  const baseUrl = (row.base_url?.trim() || def?.defaultBaseUrl || '').replace(/\/+$/, '');
  const modelName = row.model_name?.trim() || def?.defaultModel || '';
  const apiKey = decryptSettingValue(row.api_key_enc) ?? '';
  const isAi = def?.category === 'ai' || row.category === 'ai';

  if (!row.enabled) {
    return {
      slug,
      displayName: row.display_name,
      baseUrl,
      apiKey: '',
      modelName,
      enabled: false,
      source: 'db',
    };
  }

  if (isAi) {
    if (!baseUrl || !modelName) return null;
    if (!def?.apiKeyOptional && !apiKey) return null;
  } else if (!baseUrl || (!def?.apiKeyOptional && !apiKey)) {
    return null;
  }

  return {
    slug,
    displayName: row.display_name,
    baseUrl,
    apiKey,
    modelName,
    enabled: true,
    source: apiKey ? 'db' : 'default',
  };
}

export async function createCustomIntegrationProvider(
  input: {
    slug: string;
    displayName: string;
    category: string;
    baseUrl: string;
    apiKey?: string;
    enabled?: boolean;
    remarks?: string;
  },
  workspaceId?: string,
): Promise<IntegrationProviderPublic> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const slug = input.slug.trim().toLowerCase();
  validateCustomSlug(slug);
  validateCustomProviderCategory(input.category.trim());

  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('请填写显示名称');

  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) throw new Error('请填写 Base URL');

  const dup = await query(
    `SELECT 1 FROM integration_providers WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  if ((dup.rowCount ?? 0) > 0) {
    throw new Error('该标识已存在');
  }

  const maxSort = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM integration_providers WHERE workspace_id = $1`,
    [ws],
  );
  const sortOrder = (maxSort.rows[0]?.max ?? 0) + 10;
  const apiKeyEnc = input.apiKey?.trim()
    ? encryptSettingValue(input.apiKey.trim())
    : null;
  const remarks = normalizeRemarks(input.remarks);

  await query(
    `INSERT INTO integration_providers
       (workspace_id, slug, display_name, category, base_url, api_key_enc, enabled, sort_order, is_custom, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)`,
    [ws, slug, displayName, input.category.trim(), baseUrl, apiKeyEnc, input.enabled !== false, sortOrder, remarks],
  );

  invalidateIntegrationProviderCache();
  const list = await listIntegrationProvidersPublic(ws, 'data');
  const created = list.find((p) => p.slug === slug);
  if (!created) throw new Error('创建失败');
  return created;
}

export async function deleteCustomIntegrationProvider(
  slug: string,
  workspaceId?: string,
): Promise<boolean> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const existing = await query<IntegrationProviderRow>(
    `SELECT workspace_id, slug, display_name, category, base_url, api_key_enc, model_name, enabled, sort_order, is_custom, remarks
     FROM integration_providers WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  const row = existing.rows[0];
  if (!row?.is_custom) return false;

  await query(
    `DELETE FROM integration_providers WHERE workspace_id = $1 AND slug = $2 AND is_custom = TRUE`,
    [ws, slug],
  );
  invalidateIntegrationProviderCache();
  return true;
}

export async function updateIntegrationProvider(
  slug: string,
  patch: {
    displayName?: string;
    category?: string;
    baseUrl?: string;
    apiKey?: string | null;
    modelName?: string | null;
    enabled?: boolean;
    clearApiKey?: boolean;
    remarks?: string;
  },
  workspaceId?: string,
): Promise<IntegrationProviderPublic | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIntegrationProviderSeeds(ws);

  const existing = await query<IntegrationProviderRow>(
    `SELECT workspace_id, slug, display_name, category, base_url, api_key_enc, model_name, enabled, sort_order, is_custom, remarks
     FROM integration_providers WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug],
  );
  const row = existing.rows[0];
  if (!row) return null;

  const def = getProviderDefinition(slug);
  if (!def && !row.is_custom) return null;

  if (patch.category !== undefined) {
    if (!row.is_custom) {
      throw new Error('内置数据源不可修改分组');
    }
    validateCustomProviderCategory(patch.category.trim());
  }

  const displayName = patch.displayName !== undefined
    ? patch.displayName.trim()
    : row.display_name;
  if (!displayName) throw new Error('显示名称不能为空');

  const category = patch.category !== undefined ? patch.category.trim() : row.category;
  const baseUrl = patch.baseUrl !== undefined ? patch.baseUrl.trim() : row.base_url;
  const enabled = patch.enabled ?? row.enabled;
  const modelName = patch.modelName !== undefined
    ? (patch.modelName?.trim() || null)
    : row.model_name;
  let apiKeyEnc = row.api_key_enc;
  if (patch.clearApiKey) {
    apiKeyEnc = null;
  } else if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    apiKeyEnc = encryptSettingValue(patch.apiKey.trim());
  }
  const remarks = patch.remarks !== undefined ? normalizeRemarks(patch.remarks) : (row.remarks ?? '');

  await query(
    `UPDATE integration_providers SET
       display_name = $3,
       category = $4,
       base_url = $5,
       api_key_enc = $6,
       model_name = $7,
       enabled = $8,
       remarks = $9,
       updated_at = NOW()
     WHERE workspace_id = $1 AND slug = $2`,
    [ws, slug, displayName, category, baseUrl, apiKeyEnc, modelName, enabled, remarks],
  );

  invalidateIntegrationProviderCache();
  const scope = def?.category === 'ai' || row.category === 'ai' ? 'ai' : 'data';
  const list = await listIntegrationProvidersPublic(ws, scope);
  return list.find((p) => p.slug === slug) ?? null;
}

/** Invalidate in-memory cache after admin updates (simple TTL cache). */
let cacheExpiresAt = 0;
const cache = new Map<string, ResolvedIntegrationProvider | null>();

export async function getIntegrationProviderCached(
  slug: string,
  workspaceId?: string,
): Promise<ResolvedIntegrationProvider | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const key = `${ws}:${slug}`;
  const now = Date.now();
  if (now < cacheExpiresAt && cache.has(key)) {
    return cache.get(key) ?? null;
  }
  const resolved = await getIntegrationProvider(slug, ws);
  cache.set(key, resolved);
  if (cache.size === 1) cacheExpiresAt = now + 60_000;
  return resolved;
}

export function invalidateIntegrationProviderCache(): void {
  cache.clear();
  cacheExpiresAt = 0;
}
