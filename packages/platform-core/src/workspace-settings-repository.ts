import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { hashPassword } from '@hxxworldmonitor/shared/password.js';
import { decryptSettingValue, encryptSettingValue } from '@hxxworldmonitor/shared/setting-crypto.js';

export interface WorkspaceSubscriptionPolicy {
  selfServiceSubscriptionsEnabled: boolean;
  maxSubscriptionsPerUser: number;
}

export interface WorkspaceSettingsPublic extends WorkspaceSubscriptionPolicy {
  hasDefaultPassword: boolean;
  defaultPasswordUpdatedAt: string | null;
  /** Decrypted default password for admin settings UI (null if legacy hash-only row). */
  defaultUserPassword: string | null;
}

const DEFAULT_POLICY: WorkspaceSubscriptionPolicy = {
  selfServiceSubscriptionsEnabled: true,
  maxSubscriptionsPerUser: 0,
};

async function ensureSettingsRow(workspaceId: string): Promise<void> {
  await query(
    `INSERT INTO workspace_settings (workspace_id) VALUES ($1) ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId],
  );
}

function mapPolicyRow(row: {
  self_service_subscriptions_enabled?: boolean | null;
  max_subscriptions_per_user?: number | null;
} | undefined): WorkspaceSubscriptionPolicy {
  if (!row) return { ...DEFAULT_POLICY };
  return {
    selfServiceSubscriptionsEnabled: row.self_service_subscriptions_enabled !== false,
    maxSubscriptionsPerUser: Math.max(0, Number(row.max_subscriptions_per_user ?? 0)),
  };
}

export async function getWorkspaceSubscriptionPolicy(
  workspaceId?: string,
): Promise<WorkspaceSubscriptionPolicy> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{
    self_service_subscriptions_enabled: boolean | null;
    max_subscriptions_per_user: number | null;
  }>(
    `SELECT self_service_subscriptions_enabled, max_subscriptions_per_user
     FROM workspace_settings WHERE workspace_id = $1`,
    [ws],
  );
  return mapPolicyRow(res.rows[0]);
}

export async function getWorkspaceSettingsPublic(
  workspaceId?: string,
): Promise<WorkspaceSettingsPublic> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{
    default_user_password_hash: string | null;
    default_user_password_enc: string | null;
    updated_at: Date | null;
    self_service_subscriptions_enabled: boolean | null;
    max_subscriptions_per_user: number | null;
  }>(
    `SELECT default_user_password_hash, default_user_password_enc, updated_at,
            self_service_subscriptions_enabled, max_subscriptions_per_user
     FROM workspace_settings WHERE workspace_id = $1`,
    [ws],
  );
  const row = res.rows[0];
  const policy = mapPolicyRow(row);
  return {
    ...policy,
    hasDefaultPassword: Boolean(row?.default_user_password_hash),
    defaultPasswordUpdatedAt: row?.updated_at?.toISOString() ?? null,
    defaultUserPassword: decryptSettingValue(row?.default_user_password_enc),
  };
}

export async function patchWorkspaceSettings(
  patch: {
    defaultUserPassword?: string;
    selfServiceSubscriptionsEnabled?: boolean;
    maxSubscriptionsPerUser?: number;
  },
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureSettingsRow(ws);

  if (patch.defaultUserPassword !== undefined) {
    if (!patch.defaultUserPassword || patch.defaultUserPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const passwordHash = await hashPassword(patch.defaultUserPassword);
    const passwordEnc = encryptSettingValue(patch.defaultUserPassword);
    await query(
      `UPDATE workspace_settings SET
         default_user_password_hash = $2,
         default_user_password_enc = $3,
         updated_at = NOW()
       WHERE workspace_id = $1`,
      [ws, passwordHash, passwordEnc],
    );
  }

  if (patch.selfServiceSubscriptionsEnabled !== undefined
      || patch.maxSubscriptionsPerUser !== undefined) {
    const current = await getWorkspaceSubscriptionPolicy(ws);
    const enabled = patch.selfServiceSubscriptionsEnabled ?? current.selfServiceSubscriptionsEnabled;
    const max = patch.maxSubscriptionsPerUser ?? current.maxSubscriptionsPerUser;
    if (max < 0 || !Number.isFinite(max)) {
      throw new Error('maxSubscriptionsPerUser must be >= 0');
    }
    await query(
      `UPDATE workspace_settings SET
         self_service_subscriptions_enabled = $2,
         max_subscriptions_per_user = $3,
         updated_at = NOW()
       WHERE workspace_id = $1`,
      [ws, enabled, Math.floor(max)],
    );
  }
}

export async function getDefaultUserPasswordHash(workspaceId?: string): Promise<string | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ default_user_password_hash: string | null }>(
    `SELECT default_user_password_hash FROM workspace_settings WHERE workspace_id = $1`,
    [ws],
  );
  return res.rows[0]?.default_user_password_hash ?? null;
}

export async function setDefaultUserPassword(
  password: string,
  workspaceId?: string,
): Promise<void> {
  await patchWorkspaceSettings({ defaultUserPassword: password }, workspaceId);
}

/** Hash explicit password or copy workspace default hash for new subscribers. */
export async function resolveNewSubscriberPasswordHash(opts: {
  password?: string;
  workspaceId?: string;
}): Promise<string> {
  if (opts.password?.trim()) {
    if (opts.password.length < 8) throw new Error('Password must be at least 8 characters');
    return hashPassword(opts.password);
  }
  const hash = await getDefaultUserPasswordHash(opts.workspaceId);
  if (!hash) {
    throw new Error('default_password_not_configured');
  }
  return hash;
}

export async function resetSubscriberToDefaultPassword(
  userId: string,
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const hash = await getDefaultUserPasswordHash(ws);
  if (!hash) throw new Error('default_password_not_configured');
  const res = await query(
    `UPDATE users SET password_hash = $3
     WHERE id = $1 AND workspace_id = $2 AND role = 'user'`,
    [userId, ws, hash],
  );
  if (res.rowCount === 0) throw new Error('Subscriber not found');
}
