import { createHash, randomBytes } from 'node:crypto';
import { decryptSettingValue, encryptSettingValue } from '@hxxworldmonitor/shared/setting-crypto.js';
import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { isSubscriberLoginAllowed, type SubscriberUserRow } from './user-account.js';
import { getSubscriberById } from './user-repository.js';

declare const process: { env: Record<string, string | undefined> };

export const USER_API_KEY_PREFIX = 'wmuk_';

export interface UserApiKeyMeta {
  hasKey: boolean;
  keyPrefix: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  permanent: boolean;
  revoked: boolean;
  expired: boolean;
}

export interface UserApiKeyWithSecret extends UserApiKeyMeta {
  apiKey: string | null;
}

interface ApiKeyDbRow {
  api_key_enc: string | null;
  api_key_hash: string | null;
  api_key_prefix: string | null;
  api_key_created_at: Date | null;
  api_key_expires_at: Date | null;
  api_key_revoked_at: Date | null;
}

function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateRawApiKey(): string {
  return `${USER_API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

function displayPrefix(raw: string): string {
  const visible = raw.slice(0, 12);
  return `${visible}****`;
}

function defaultExpiresAt(opts?: { permanent?: boolean }): Date | null {
  if (opts?.permanent === true) return null;
  const days = Number(process.env.PLATFORM_USER_API_KEY_TTL_DAYS ?? 0);
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** expiresAt in request body takes precedence over permanent flag. */
export function resolveApiKeyExpiresAt(
  opts?: { permanent?: boolean; expiresAt?: string | null },
): Date | null {
  const raw = opts?.expiresAt?.trim();
  if (raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error('invalid_expires_at');
    if (d.getTime() <= Date.now()) throw new Error('invalid_expires_at');
    return d;
  }
  if (opts?.permanent === false) throw new Error('invalid_expires_at');
  return defaultExpiresAt({ permanent: opts?.permanent ?? true });
}

function isKeyExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now();
}

async function fetchKeyRow(userId: string): Promise<ApiKeyDbRow | null> {
  const res = await query<ApiKeyDbRow>(
    `SELECT api_key_enc, api_key_hash, api_key_prefix, api_key_created_at,
            api_key_expires_at, api_key_revoked_at
     FROM users WHERE id = $1 AND role = 'user'`,
    [userId],
  );
  return res.rows[0] ?? null;
}

function rowToMeta(row: ApiKeyDbRow | null): UserApiKeyMeta {
  if (!row?.api_key_hash || row.api_key_revoked_at) {
    return {
      hasKey: false,
      keyPrefix: null,
      createdAt: null,
      expiresAt: null,
      permanent: false,
      revoked: Boolean(row?.api_key_revoked_at),
      expired: false,
    };
  }
  const expired = isKeyExpired(row.api_key_expires_at);
  const hasKeyMaterial = Boolean(row.api_key_hash);
  return {
    hasKey: hasKeyMaterial && !expired,
    keyPrefix: row.api_key_prefix,
    createdAt: row.api_key_created_at?.toISOString() ?? null,
    expiresAt: row.api_key_expires_at?.toISOString() ?? null,
    permanent: row.api_key_expires_at == null,
    revoked: false,
    expired: hasKeyMaterial && expired,
  };
}

export function isIntegrationSecretConfigured(): boolean {
  return Boolean(process.env.PLATFORM_INTEGRATION_SECRET?.trim());
}

export function verifyIntegrationSecret(provided: string | undefined): boolean {
  const expected = process.env.PLATFORM_INTEGRATION_SECRET?.trim();
  if (!expected || !provided?.trim()) return false;
  return provided.trim() === expected;
}

export async function getUserApiKeyMeta(userId: string): Promise<UserApiKeyMeta> {
  return rowToMeta(await fetchKeyRow(userId));
}

export async function getUserApiKeyWithSecret(userId: string): Promise<UserApiKeyWithSecret> {
  const row = await fetchKeyRow(userId);
  const meta = rowToMeta(row);
  if (!meta.hasKey || !row?.api_key_enc) {
    return { ...meta, apiKey: null };
  }
  return {
    ...meta,
    apiKey: decryptSettingValue(row.api_key_enc),
  };
}

export async function userHasActiveApiKey(userId: string): Promise<boolean> {
  const meta = await getUserApiKeyMeta(userId);
  return meta.hasKey;
}

async function persistApiKey(
  userId: string,
  rawKey: string,
  expiresAt: Date | null,
): Promise<void> {
  let enc: string;
  try {
    enc = encryptSettingValue(rawKey);
  } catch {
    throw new Error('api_key_storage_not_configured');
  }
  const hash = hashApiKey(rawKey);
  const prefix = displayPrefix(rawKey);
  await query(
    `UPDATE users SET
       api_key_enc = $2,
       api_key_hash = $3,
       api_key_prefix = $4,
       api_key_created_at = NOW(),
       api_key_expires_at = $5,
       api_key_revoked_at = NULL
     WHERE id = $1 AND role = 'user'`,
    [userId, enc, hash, prefix, expiresAt],
  );
}

export async function createUserApiKey(
  userId: string,
  opts?: { permanent?: boolean; expiresAt?: string | null },
): Promise<UserApiKeyWithSecret> {
  const row = await fetchKeyRow(userId);
  if (row?.api_key_hash && !row.api_key_revoked_at) {
    if (!isKeyExpired(row.api_key_expires_at)) {
      throw new Error('api_key_already_exists');
    }
    await revokeUserApiKey(userId);
  }
  const expiresAt = resolveApiKeyExpiresAt(opts);

  const rawKey = generateRawApiKey();
  await persistApiKey(userId, rawKey, expiresAt);
  const meta = await getUserApiKeyMeta(userId);
  return { ...meta, apiKey: rawKey };
}

export async function rotateUserApiKey(
  userId: string,
  opts?: { permanent?: boolean; expiresAt?: string | null },
): Promise<UserApiKeyWithSecret> {
  await revokeUserApiKey(userId);
  return createUserApiKey(userId, opts);
}

export async function updateUserApiKeyExpiry(
  userId: string,
  opts: { permanent?: boolean; expiresAt?: string | null },
): Promise<UserApiKeyMeta> {
  const row = await fetchKeyRow(userId);
  if (!row?.api_key_hash || row.api_key_revoked_at) {
    throw new Error('api_key_not_found');
  }
  const expiresAt = resolveApiKeyExpiresAt(opts);
  await query(
    `UPDATE users SET api_key_expires_at = $2
     WHERE id = $1 AND role = 'user' AND api_key_revoked_at IS NULL`,
    [userId, expiresAt],
  );
  return getUserApiKeyMeta(userId);
}

export async function revokeUserApiKey(userId: string): Promise<void> {
  await query(
    `UPDATE users SET
       api_key_enc = NULL,
       api_key_hash = NULL,
       api_key_prefix = NULL,
       api_key_revoked_at = NOW()
     WHERE id = $1 AND role = 'user'`,
    [userId],
  );
}

export async function ensureUserApiKey(
  userId: string,
  opts?: { permanent?: boolean; expiresAt?: string | null },
): Promise<{ key: UserApiKeyWithSecret; created: boolean }> {
  const current = await getUserApiKeyWithSecret(userId);
  if (current.hasKey && current.apiKey) {
    return { key: current, created: false };
  }
  const created = await createUserApiKey(userId, opts);
  return { key: created, created: true };
}

export interface OpenApiUserContext {
  userId: string;
  workspaceId: string;
  email: string;
}

export type ApiKeyAuthFailure = 'invalid' | 'expired' | 'account_unavailable';

export type ApiKeyResolveResult =
  | { ok: true; context: OpenApiUserContext }
  | { ok: false; reason: ApiKeyAuthFailure; expiresAt?: string | null };

export async function resolveUserByApiKey(rawKey: string): Promise<ApiKeyResolveResult> {
  const trimmed = rawKey.trim();
  if (!trimmed.startsWith(USER_API_KEY_PREFIX)) {
    return { ok: false, reason: 'invalid' };
  }

  const hash = hashApiKey(trimmed);
  const res = await query<{
    id: string;
    workspace_id: string;
    email: string;
    api_key_expires_at: Date | null;
    api_key_revoked_at: Date | null;
    account_status: SubscriberUserRow['account_status'];
    disabled_until: Date | null;
    deleted_at: Date | null;
  }>(
    `SELECT id, workspace_id, email, api_key_expires_at, api_key_revoked_at,
            account_status, disabled_until, deleted_at
     FROM users
     WHERE api_key_hash = $1 AND role = 'user' AND api_key_revoked_at IS NULL`,
    [hash],
  );
  const row = res.rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (!isSubscriberLoginAllowed(row)) return { ok: false, reason: 'account_unavailable' };
  if (isKeyExpired(row.api_key_expires_at)) {
    return {
      ok: false,
      reason: 'expired',
      expiresAt: row.api_key_expires_at?.toISOString() ?? null,
    };
  }

  return {
    ok: true,
    context: {
      userId: row.id,
      workspaceId: row.workspace_id,
      email: row.email,
    },
  };
}

export async function resolveUserByEmailForIntegration(
  email: string,
  workspaceId?: string,
): Promise<SubscriberUserRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<SubscriberUserRow & ApiKeyDbRow>(
    `SELECT id, workspace_id, email, display_name, role, preferred_lang, created_at,
            account_status, disabled_until, deleted_at,
            api_key_enc, api_key_hash, api_key_prefix, api_key_created_at,
            api_key_expires_at, api_key_revoked_at
     FROM users WHERE workspace_id = $1 AND lower(email) = $2 AND role = 'user'`,
    [ws, email.trim().toLowerCase()],
  );
  const row = res.rows[0];
  if (!row) return null;
  return getSubscriberById(row.id);
}
