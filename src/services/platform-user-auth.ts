/** Platform subscriber auth client (frontend main app — not admin). */

import { getPlatformApiBaseUrl, isPlatformApiConfigured } from '@/config/platform-api';
import { t } from '@/services/i18n';

const TOKEN_KEY = 'wm_platform_user_token';

export interface PlatformUserProfile {
  id: string;
  email: string;
  display_name: string | null;
  preferred_lang: string;
  delivery_mode?: string;
  merged_delivery_time?: string | null;
  merged_delivery_timezone?: string;
  created_at: string;
}

export interface UserSubscriptionSummary {
  id: string;
  name: string;
  enabled: boolean;
  preset_title: string | null;
  rules_summary: string;
  created_at: string;
}

export interface CatalogPresetRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  rules_summary: string;
  subscribed: boolean;
  subscription_id: string | null;
}

export interface SubscriptionCatalog {
  selfServiceEnabled: boolean;
  maxSubscriptionsPerUser: number;
  activeSubscriptionCount: number;
  canSubscribe: boolean;
  presets: CatalogPresetRow[];
}

function authPrefix(): string {
  const base = getPlatformApiBaseUrl();
  if (base === null) throw new Error('Platform API not configured');
  return base ? `${base}/platform` : '/platform';
}

export function isUserAuthAvailable(): boolean {
  return isPlatformApiConfigured();
}

export function getStoredUserToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function setStoredUserToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearStoredUserToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function userFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getStoredUserToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const resp = await fetch(`${authPrefix()}${path}`, { ...init, headers });
  if (resp.status === 401 && token) {
    clearStoredUserToken();
  }
  return resp;
}

async function parseJson<T>(resp: Response): Promise<T> {
  const data = await resp.json() as T & { error?: string };
  if (!resp.ok) {
    throw new Error(data.error ?? `Request failed (${resp.status})`);
  }
  return data;
}

export async function fetchAuthStatus(): Promise<{ enabled: boolean }> {
  if (!isUserAuthAvailable()) return { enabled: false };
  try {
    const resp = await fetch(`${authPrefix()}/v1/auth/status`);
    if (!resp.ok) return { enabled: false };
    return parseJson<{ enabled: boolean }>(resp);
  } catch {
    return { enabled: false };
  }
}

export async function loginUser(email: string, password: string): Promise<PlatformUserProfile> {
  const resp = await fetch(`${authPrefix()}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{ token: string; user: PlatformUserProfile }>(resp);
  setStoredUserToken(data.token);
  return data.user;
}

export async function fetchCurrentUser(): Promise<PlatformUserProfile | null> {
  if (!getStoredUserToken()) return null;
  try {
    const resp = await userFetch('/v1/auth/me');
    const data = await parseJson<{ user: PlatformUserProfile }>(resp);
    return data.user;
  } catch {
    return null;
  }
}

export async function updateUserProfile(payload: {
  displayName?: string | null;
  preferredLang?: string;
  deliveryMode?: string;
  mergedDeliveryTime?: string | null;
  mergedDeliveryTimezone?: string;
}): Promise<PlatformUserProfile> {
  const resp = await userFetch('/v1/auth/me', {
    method: 'PATCH',
    body: JSON.stringify({
      displayName: payload.displayName,
      preferredLang: payload.preferredLang,
      deliveryMode: payload.deliveryMode,
      mergedDeliveryTime: payload.mergedDeliveryTime,
      mergedDeliveryTimezone: payload.mergedDeliveryTimezone,
    }),
  });
  const data = await parseJson<{ user: PlatformUserProfile }>(resp);
  return data.user;
}

export interface UserApiKeyInfo {
  hasKey: boolean;
  apiKey?: string | null;
  keyPrefix: string | null;
  expiresAt: string | null;
  permanent: boolean;
  createdAt: string | null;
  expired: boolean;
}

export const EMPTY_USER_API_KEY: UserApiKeyInfo = {
  hasKey: false,
  keyPrefix: null,
  expiresAt: null,
  permanent: false,
  createdAt: null,
  expired: false,
};

export async function fetchUserApiKey(): Promise<UserApiKeyInfo> {
  const resp = await userFetch('/v1/auth/api-key');
  return parseJson<UserApiKeyInfo>(resp);
}

export async function revealUserApiKey(): Promise<UserApiKeyInfo & { apiKey: string }> {
  const resp = await userFetch('/v1/auth/api-key/reveal');
  return parseJson<UserApiKeyInfo & { apiKey: string }>(resp);
}

export async function createUserApiKey(opts?: {
  permanent?: boolean;
  expiresAt?: string | null;
}): Promise<UserApiKeyInfo> {
  const resp = await userFetch('/v1/auth/api-key', {
    method: 'POST',
    body: JSON.stringify(opts ?? { permanent: true }),
  });
  return parseJson<UserApiKeyInfo>(resp);
}

export async function rotateUserApiKey(opts?: {
  permanent?: boolean;
  expiresAt?: string | null;
}): Promise<UserApiKeyInfo> {
  const resp = await userFetch('/v1/auth/api-key/rotate', {
    method: 'POST',
    body: JSON.stringify(opts ?? { permanent: true }),
  });
  return parseJson<UserApiKeyInfo>(resp);
}

export async function updateUserApiKeyExpiry(opts: {
  permanent?: boolean;
  expiresAt?: string | null;
}): Promise<UserApiKeyInfo> {
  const resp = await userFetch('/v1/auth/api-key/expiry', {
    method: 'PATCH',
    body: JSON.stringify(opts),
  });
  return parseJson<UserApiKeyInfo>(resp);
}

export async function deleteUserApiKey(): Promise<void> {
  await parseJson<{ ok: boolean }>(
    await userFetch('/v1/auth/api-key', { method: 'DELETE' }),
  );
}

export async function fetchUserSubscriptions(): Promise<UserSubscriptionSummary[]> {
  const resp = await userFetch('/v1/auth/subscriptions');
  const data = await parseJson<{ subscriptions: UserSubscriptionSummary[] }>(resp);
  return data.subscriptions;
}

export async function fetchSubscriptionCatalog(): Promise<SubscriptionCatalog> {
  return parseJson<SubscriptionCatalog>(await userFetch('/v1/auth/catalog'));
}

export async function subscribeToPreset(presetId: string): Promise<UserSubscriptionSummary> {
  const resp = await userFetch('/v1/auth/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ presetId }),
  });
  const data = await parseJson<{ subscription: UserSubscriptionSummary }>(resp);
  return data.subscription;
}

export async function unsubscribeFromPreset(subscriptionId: string): Promise<void> {
  await parseJson<{ ok: boolean }>(
    await userFetch(`/v1/auth/subscriptions/${subscriptionId}`, { method: 'DELETE' }),
  );
}

export function logoutUser(): void {
  clearStoredUserToken();
}

export async function registerUser(email: string, password: string): Promise<PlatformUserProfile> {
  const resp = await fetch(`${authPrefix()}/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{ token: string; user: PlatformUserProfile }>(resp);
  setStoredUserToken(data.token);
  return data.user;
}

export async function sendPasswordResetCode(email: string): Promise<void> {
  const resp = await fetch(`${authPrefix()}/v1/auth/send-reset-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  await parseJson<{ ok: boolean }>(resp);
}

export async function resetPasswordWithCode(
  email: string,
  code: string,
  password: string,
): Promise<void> {
  const resp = await fetch(`${authPrefix()}/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  await parseJson<{ ok: boolean }>(resp);
}

/** Map API error codes to i18n keys under account.errors.* */
export function mapAuthError(err: unknown): string {
  const raw = String(err).replace(/^Error:\s*/, '');
  const key = `account.errors.${raw}`;
  const translated = t(key);
  return translated !== key ? translated : raw;
}
