import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import { hashPassword } from '../_shared/password.js';
import { decryptSettingValue, encryptSettingValue } from '../_shared/setting-crypto.js';

export interface WorkspaceSettingsPublic {
  hasDefaultPassword: boolean;
  defaultPasswordUpdatedAt: string | null;
  /** Decrypted default password for admin settings UI (null if legacy hash-only row). */
  defaultUserPassword: string | null;
}

export async function getWorkspaceSettingsPublic(
  workspaceId?: string,
): Promise<WorkspaceSettingsPublic> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{
    default_user_password_hash: string | null;
    default_user_password_enc: string | null;
    updated_at: Date | null;
  }>(
    `SELECT default_user_password_hash, default_user_password_enc, updated_at
     FROM workspace_settings WHERE workspace_id = $1`,
    [ws],
  );
  const row = res.rows[0];
  return {
    hasDefaultPassword: Boolean(row?.default_user_password_hash),
    defaultPasswordUpdatedAt: row?.updated_at?.toISOString() ?? null,
    defaultUserPassword: decryptSettingValue(row?.default_user_password_enc),
  };
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
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const passwordHash = await hashPassword(password);
  const passwordEnc = encryptSettingValue(password);
  await query(
    `INSERT INTO workspace_settings (workspace_id, default_user_password_hash, default_user_password_enc, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET
       default_user_password_hash = EXCLUDED.default_user_password_hash,
       default_user_password_enc = EXCLUDED.default_user_password_enc,
       updated_at = NOW()`,
    [ws, passwordHash, passwordEnc],
  );
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
