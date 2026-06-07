/** Platform admin REST client (session JWT or legacy bearer token). */

import { getPlatformApiBaseUrl, isPlatformApiConfigured } from '@/config/platform-api';

const TOKEN_KEY = 'wm_platform_admin_token';
/** Avoid indefinite hangs when platform:api is down or the dev proxy is congested. */
const ADMIN_FETCH_TIMEOUT_MS = 15_000;

export function getStoredAdminToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setStoredAdminToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearStoredAdminToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

function publicPlatformPrefix(): string {
  const base = getPlatformApiBaseUrl();
  if (base === null) throw new Error('VITE_PLATFORM_API_URL 未配置');
  return base ? `${base}/platform` : '/platform';
}

function adminPrefix(): string {
  const base = getPlatformApiBaseUrl();
  if (base === null) throw new Error('VITE_PLATFORM_API_URL 未配置');
  return base ? `${base}/platform` : '/platform';
}

async function adminFetch(path: string, init: RequestInit = {}, timeoutMs = ADMIN_FETCH_TIMEOUT_MS): Promise<Response> {
  const token = getStoredAdminToken();
  if (!token) throw new Error('请先登录管理后台');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  let resp: Response;
  try {
    resp = await fetch(`${adminPrefix()}${path}`, { ...init, headers, signal });
  } catch (err) {
    if (timeoutSignal.aborted) {
      throw new Error('请求超时：请确认 platform:api 已启动，并关闭占用 localhost:3000 的主仪表盘标签页');
    }
    throw err;
  }
  if (resp.status === 401) {
    clearStoredAdminToken();
    throw new Error('登录已失效，请重新登录');
  }
  return resp;
}

async function parseJson<T>(resp: Response): Promise<T> {
  const data = await resp.json() as T & { error?: string };
  if (!resp.ok) {
    throw new Error(data.error ?? `请求失败 (${resp.status})`);
  }
  return data;
}

export function isPlatformAdminAvailable(): boolean {
  return isPlatformApiConfigured();
}

export interface AdminStats {
  users: number;
  subscriptions: number;
  presets: number;
  presetsEnabled: number;
  newsItems: number;
  hxxbot: { configured: boolean; apiBaseUrl: string | null; hasApiKey: boolean };
  adminAuth: boolean;
  hasAdminAccount?: boolean;
  logging?: {
    logDir: string;
    level: string;
    toFile: boolean;
  };
}

export interface AdminMeta {
  variants: string[];
  modes: Array<{ value: string; label: string }>;
  categories: Array<{ id: string; count: number }>;
  langs: string[];
  deliveryLangs?: string[];
  /** code → display name (e.g. zh → 中文) */
  langLabels?: Record<string, string>;
}

export interface SubscriptionRules {
  mode?: 'daily_brief' | 'keyword';
  categories?: string[];
  keywords?: string[];
  variant?: string;
  lang?: string;
  contentLangs?: string[];
  deliveryLang?: string;
  hours?: number;
  maxItems?: number;
  includeAiBrief?: boolean;
}

export interface PresetRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  rules_json: SubscriptionRules;
  enabled: boolean;
  sort_order: number;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  preferred_lang?: string;
  created_at: string;
  account_status: 'active' | 'disabled' | 'deleted';
  effective_status: 'active' | 'disabled' | 'deleted';
  disabled_until: string | null;
  disable_permanent: boolean;
  deleted_at: string | null;
  disable_summary?: string;
}

export interface WorkspaceSettings {
  hasDefaultPassword: boolean;
  defaultPasswordUpdatedAt: string | null;
  defaultUserPassword: string | null;
  selfServiceSubscriptionsEnabled: boolean;
  maxSubscriptionsPerUser: number;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  preset_id: string | null;
  name: string;
  rules_json: SubscriptionRules;
  enabled: boolean;
  user_email: string;
  user_display_name: string | null;
  preset_title?: string | null;
}

export async function loginAdmin(email: string, password: string): Promise<{ email: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${publicPlatformPrefix()}/v1/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error('登录超时：请确认 platform:api 已启动（npm run platform:api）');
  }
  const data = await resp.json() as {
    token?: string;
    error?: string;
    user?: { email: string };
  };
  if (!resp.ok) {
    throw new Error(data.error ?? `登录失败 (${resp.status})`);
  }
  if (!data.token) throw new Error('登录响应无效');
  setStoredAdminToken(data.token);
  return { email: data.user?.email ?? email };
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return parseJson(await adminFetch('/v1/admin/stats'));
}

export async function fetchAdminMeta(): Promise<AdminMeta> {
  return parseJson(await adminFetch('/v1/admin/meta'));
}

export async function fetchPresets(): Promise<PresetRow[]> {
  const data = await parseJson<{ presets: PresetRow[] }>(await adminFetch('/v1/admin/presets'));
  return data.presets;
}

export async function savePreset(
  payload: Partial<PresetRow> & { title: string; rules_json: SubscriptionRules },
  id?: string,
): Promise<PresetRow> {
  const body = {
    title: payload.title,
    slug: payload.slug,
    description: payload.description ?? undefined,
    rulesJson: payload.rules_json,
    enabled: payload.enabled,
    sortOrder: payload.sort_order,
  };
  const resp = await adminFetch(id ? `/v1/admin/presets/${id}` : '/v1/admin/presets', {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ preset: PresetRow }>(resp);
  return data.preset;
}

export async function deletePreset(id: string): Promise<void> {
  await parseJson(await adminFetch(`/v1/admin/presets/${id}`, { method: 'DELETE' }));
}

export async function fetchUsers(includeDeleted = false): Promise<UserRow[]> {
  const q = includeDeleted ? '?includeDeleted=true' : '';
  const data = await parseJson<{ users: UserRow[] }>(await adminFetch(`/v1/admin/users${q}`));
  return data.users;
}

export async function createUser(
  email: string,
  displayName?: string,
  preferredLang?: string,
): Promise<UserRow> {
  const data = await parseJson<{ user: UserRow }>(
    await adminFetch('/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, displayName, preferredLang }),
    }),
  );
  return data.user;
}

export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings> {
  const data = await parseJson<{ settings: WorkspaceSettings }>(
    await adminFetch('/v1/admin/settings'),
  );
  return data.settings;
}

export async function saveDefaultUserPassword(password: string): Promise<WorkspaceSettings> {
  return patchWorkspaceSettings({ defaultUserPassword: password });
}

export interface IntegrationProviderRow {
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

export async function testIntegrationProvider(
  slug: string,
  draft: { baseUrl?: string; apiKey?: string } = {},
): Promise<{ ok: boolean; latencyMs: number; error?: string; httpStatus?: number }> {
  return parseJson(
    await adminFetch(`/v1/admin/integrations/${slug}/test`, {
      method: 'POST',
      body: JSON.stringify(draft),
    }),
    200_000,
  );
}

export async function fetchIntegrationProviders(): Promise<IntegrationProviderRow[]> {
  const data = await parseJson<{ providers: IntegrationProviderRow[] }>(
    await adminFetch('/v1/admin/integrations'),
  );
  return data.providers;
}

export async function fetchAiModels(): Promise<IntegrationProviderRow[]> {
  const data = await parseJson<{ providers: IntegrationProviderRow[] }>(
    await adminFetch('/v1/admin/ai-models'),
  );
  return data.providers;
}

export async function saveIntegrationProvider(
  slug: string,
  patch: {
    displayName?: string;
    category?: string;
    baseUrl?: string;
    apiKey?: string;
    modelName?: string;
    enabled?: boolean;
    clearApiKey?: boolean;
    remarks?: string;
  },
): Promise<IntegrationProviderRow> {
  const body: Record<string, unknown> = {};
  if (patch.displayName !== undefined) body.displayName = patch.displayName;
  if (patch.category !== undefined) body.category = patch.category;
  if (patch.baseUrl !== undefined) body.baseUrl = patch.baseUrl;
  if (patch.apiKey !== undefined) body.apiKey = patch.apiKey;
  if (patch.modelName !== undefined) body.modelName = patch.modelName;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.clearApiKey) body.clearApiKey = true;
  if (patch.remarks !== undefined) body.remarks = patch.remarks;
  const data = await parseJson<{ provider: IntegrationProviderRow }>(
    await adminFetch(`/v1/admin/integrations/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  );
  return data.provider;
}

export async function createIntegrationProvider(input: {
  slug: string;
  displayName: string;
  category: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
  remarks?: string;
}): Promise<IntegrationProviderRow> {
  const data = await parseJson<{ provider: IntegrationProviderRow }>(
    await adminFetch('/v1/admin/integrations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
  return data.provider;
}

export async function deleteIntegrationProvider(slug: string): Promise<void> {
  await parseJson(await adminFetch(`/v1/admin/integrations/${slug}`, { method: 'DELETE' }));
}

export async function saveAiModel(
  slug: string,
  patch: { baseUrl?: string; apiKey?: string; modelName?: string; enabled?: boolean; clearApiKey?: boolean; remarks?: string },
): Promise<IntegrationProviderRow> {
  const body: Record<string, unknown> = {};
  if (patch.baseUrl !== undefined) body.baseUrl = patch.baseUrl;
  if (patch.apiKey !== undefined) body.apiKey = patch.apiKey;
  if (patch.modelName !== undefined) body.modelName = patch.modelName;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.clearApiKey) body.clearApiKey = true;
  if (patch.remarks !== undefined) body.remarks = patch.remarks;
  const data = await parseJson<{ provider: IntegrationProviderRow }>(
    await adminFetch(`/v1/admin/ai-models/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  );
  return data.provider;
}

export interface AiModelTestResult {
  ok: boolean;
  latencyMs: number;
  model?: string;
  reply?: string;
  error?: string;
  httpStatus?: number;
}

export async function testAiModel(
  slug: string,
  draft: { baseUrl?: string; modelName?: string; apiKey?: string },
): Promise<AiModelTestResult> {
  const body: Record<string, unknown> = {};
  if (draft.baseUrl !== undefined) body.baseUrl = draft.baseUrl;
  if (draft.modelName !== undefined) body.modelName = draft.modelName;
  if (draft.apiKey !== undefined) body.apiKey = draft.apiKey;
  const resp = await adminFetch(
    `/v1/admin/ai-models/${slug}/test`,
    { method: 'POST', body: JSON.stringify(body) },
    200_000,
  );
  return await resp.json() as AiModelTestResult;
}

export async function patchWorkspaceSettings(patch: {
  defaultUserPassword?: string;
  selfServiceSubscriptionsEnabled?: boolean;
  maxSubscriptionsPerUser?: number;
}): Promise<WorkspaceSettings> {
  const body: Record<string, unknown> = {};
  if (patch.defaultUserPassword !== undefined) body.defaultUserPassword = patch.defaultUserPassword;
  if (patch.selfServiceSubscriptionsEnabled !== undefined) {
    body.selfServiceSubscriptionsEnabled = patch.selfServiceSubscriptionsEnabled;
  }
  if (patch.maxSubscriptionsPerUser !== undefined) {
    body.maxSubscriptionsPerUser = patch.maxSubscriptionsPerUser;
  }
  const data = await parseJson<{ settings: WorkspaceSettings }>(
    await adminFetch('/v1/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  );
  return data.settings;
}

export async function resetUserPassword(
  userId: string,
  opts: { useDefault?: boolean; password?: string },
): Promise<void> {
  await parseJson(
    await adminFetch(`/v1/admin/users/${userId}/password`, {
      method: 'PATCH',
      body: JSON.stringify(opts),
    }),
  );
}

export async function updateUser(
  userId: string,
  payload: {
    displayName?: string | null;
    preferredLang?: string;
    accountStatus?: 'active' | 'disabled' | 'deleted';
    disablePermanent?: boolean;
    disabledUntil?: string | null;
  },
): Promise<UserRow> {
  const data = await parseJson<{ user: UserRow }>(
    await adminFetch(`/v1/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: payload.displayName,
        preferredLang: payload.preferredLang,
        accountStatus: payload.accountStatus,
        disablePermanent: payload.disablePermanent,
        disabledUntil: payload.disabledUntil,
      }),
    }),
  );
  return data.user;
}

export async function fetchSubscriptions(opts?: { userId?: string }): Promise<SubscriptionRow[]> {
  const qs = opts?.userId ? `?userId=${encodeURIComponent(opts.userId)}` : '';
  const data = await parseJson<{ subscriptions: SubscriptionRow[] }>(
    await adminFetch(`/v1/admin/subscriptions${qs}`),
  );
  return data.subscriptions;
}

export async function saveSubscription(
  payload: {
    name: string;
    email?: string;
    userId?: string;
    presetId?: string;
    rulesJson?: SubscriptionRules;
    enabled?: boolean;
  },
  id?: string,
): Promise<SubscriptionRow> {
  const body = {
    name: payload.name,
    email: payload.email,
    userId: payload.userId,
    presetId: payload.presetId,
    rulesJson: payload.rulesJson,
    enabled: payload.enabled,
  };
  const resp = await adminFetch(
    id ? `/v1/admin/subscriptions/${id}` : '/v1/admin/subscriptions',
    { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) },
  );
  const data = await parseJson<{ subscription: SubscriptionRow }>(resp);
  return data.subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  await parseJson(await adminFetch(`/v1/admin/subscriptions/${id}`, { method: 'DELETE' }));
}

export async function runSubscriptionMatch(id: string): Promise<unknown> {
  return parseJson(await adminFetch(`/v1/admin/subscriptions/${id}/match`, { method: 'POST' }));
}

export async function runSubscriptionDeliver(id: string): Promise<unknown> {
  return parseJson(await adminFetch(`/v1/admin/subscriptions/${id}/deliver`, { method: 'POST' }));
}

export async function runMatchAll(): Promise<unknown> {
  return parseJson(await adminFetch('/v1/admin/run/match-all', { method: 'POST' }));
}

export async function runDeliverAll(): Promise<unknown> {
  return parseJson(await adminFetch('/v1/admin/run/deliver-all', { method: 'POST' }));
}

export interface LogFileInfo {
  service: string;
  date: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface LogTailResult {
  service: string;
  date: string;
  lines: string[];
  truncated: boolean;
}

export async function fetchLogIndex(): Promise<{ services: string[]; files: LogFileInfo[] }> {
  return parseJson(await adminFetch('/v1/admin/logs'));
}

export async function fetchLogTail(
  service: string,
  lines = 200,
  date?: string,
): Promise<LogTailResult> {
  const params = new URLSearchParams({ service, lines: String(lines) });
  if (date) params.set('date', date);
  return parseJson(await adminFetch(`/v1/admin/logs?${params.toString()}`));
}

export async function fetchPublicCatalog(): Promise<PresetRow[]> {
  const base = getPlatformApiBaseUrl();
  if (base === null) return [];
  const prefix = base ? `${base}/platform` : '/platform';
  const resp = await fetch(`${prefix}/v1/catalog`);
  if (!resp.ok) return [];
  const data = await resp.json() as { presets?: PresetRow[] };
  return data.presets ?? [];
}
