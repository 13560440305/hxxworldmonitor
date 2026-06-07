import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import { hashPassword } from '../_shared/password.js';
import {
  effectiveSubscriberStatus,
  isSubscriberLoginAllowed,
  type PlatformUserRow,
  type SubscriberAccountStatus,
  type SubscriberUserRow,
} from './user-account.js';
import {
  normalizeDeliveryMode,
  normalizeDeliveryTime,
  normalizeTimezone,
} from './delivery-preferences.js';

export type { PlatformUserRow, SubscriberUserRow } from './user-account.js';

const SUBSCRIBER_COLUMNS = `
  id, workspace_id, email, display_name, role, preferred_lang,
  delivery_mode, merged_delivery_time, merged_delivery_timezone, merged_delivery_last_sent_date,
  created_at, account_status, disabled_until, deleted_at
`;

function mapSubscriberRow(row: SubscriberUserRow): SubscriberUserRow {
  return row;
}

export async function reactivateSubscriberIfDisableExpired(userId: string): Promise<void> {
  await query(
    `UPDATE users SET account_status = 'active', disabled_until = NULL
     WHERE id = $1 AND role = 'user' AND account_status = 'disabled'
       AND disabled_until IS NOT NULL AND disabled_until <= NOW()`,
    [userId],
  );
}

export async function getSubscriberById(id: string): Promise<SubscriberUserRow | null> {
  await reactivateSubscriberIfDisableExpired(id);
  const res = await query<SubscriberUserRow>(
    `SELECT ${SUBSCRIBER_COLUMNS} FROM users WHERE id = $1 AND role = 'user'`,
    [id],
  );
  return res.rows[0] ? mapSubscriberRow(res.rows[0]) : null;
}

export async function getUserById(id: string): Promise<SubscriberUserRow | null> {
  return getSubscriberById(id);
}

export async function getUserByEmail(
  email: string,
  workspaceId?: string,
): Promise<SubscriberUserRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<SubscriberUserRow>(
    `SELECT ${SUBSCRIBER_COLUMNS}
     FROM users WHERE workspace_id = $1 AND email = $2 AND role = 'user'`,
    [ws, email.trim().toLowerCase()],
  );
  const row = res.rows[0];
  if (!row) return null;
  await reactivateSubscriberIfDisableExpired(row.id);
  return getSubscriberById(row.id);
}

export async function listUsers(
  workspaceId?: string,
  opts?: { includeDeleted?: boolean },
): Promise<SubscriberUserRow[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  let sql = `SELECT ${SUBSCRIBER_COLUMNS}
     FROM users WHERE workspace_id = $1 AND role = 'user'`;
  if (!opts?.includeDeleted) {
    sql += ` AND account_status != 'deleted'`;
  }
  sql += ' ORDER BY created_at DESC';
  const res = await query<SubscriberUserRow>(sql, [ws]);
  return res.rows.map(mapSubscriberRow);
}

export async function createUser(opts: {
  email: string;
  displayName?: string;
  preferredLang?: string;
  password?: string;
  passwordHash?: string;
  workspaceId?: string;
}): Promise<SubscriberUserRow> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const email = opts.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Valid email is required');
  }
  const preferredLang = (opts.preferredLang?.trim() || 'zh').slice(0, 16);
  let passwordHash: string | null = null;
  if (opts.passwordHash) {
    passwordHash = opts.passwordHash;
  } else if (opts.password) {
    if (opts.password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    passwordHash = await hashPassword(opts.password);
  }

  const res = await query<SubscriberUserRow>(
    `INSERT INTO users (workspace_id, email, display_name, role, preferred_lang, password_hash, account_status)
     VALUES ($1, $2, $3, 'user', $4, $5, 'active')
     ON CONFLICT (workspace_id, email) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       preferred_lang = COALESCE(EXCLUDED.preferred_lang, users.preferred_lang),
       password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
       account_status = CASE
         WHEN users.account_status = 'deleted' THEN 'active'
         ELSE users.account_status
       END,
       deleted_at = CASE WHEN users.account_status = 'deleted' THEN NULL ELSE users.deleted_at END
     WHERE users.role = 'user'
     RETURNING ${SUBSCRIBER_COLUMNS}`,
    [workspaceId, email, opts.displayName?.trim() || null, preferredLang, passwordHash],
  );
  if (!res.rows[0]) {
    throw new Error('Email is reserved for administrator account');
  }
  return mapSubscriberRow(res.rows[0]!);
}

export async function updateSubscriber(
  id: string,
  patch: {
    displayName?: string | null;
    preferredLang?: string;
    deliveryMode?: string;
    mergedDeliveryTime?: string | null;
    mergedDeliveryTimezone?: string;
    accountStatus?: SubscriberAccountStatus;
    disablePermanent?: boolean;
    disabledUntil?: string | null;
  },
): Promise<SubscriberUserRow | null> {
  const existing = await getSubscriberById(id);
  if (!existing) return null;

  let accountStatus = patch.accountStatus ?? existing.account_status;
  let disabledUntil: Date | null = existing.disabled_until;
  let deletedAt: Date | null = existing.deleted_at;

  if (patch.accountStatus === 'active') {
    accountStatus = 'active';
    disabledUntil = null;
    deletedAt = null;
  } else if (patch.accountStatus === 'disabled') {
    accountStatus = 'disabled';
    deletedAt = null;
    if (patch.disablePermanent) {
      disabledUntil = null;
    } else if (patch.disabledUntil) {
      const until = new Date(patch.disabledUntil);
      if (Number.isNaN(until.getTime())) throw new Error('Invalid disabledUntil');
      if (until.getTime() <= Date.now()) throw new Error('禁用结束时间须晚于当前时间');
      disabledUntil = until;
    } else if (!patch.disablePermanent) {
      throw new Error('临时禁用须设置结束时间');
    }
  } else if (patch.accountStatus === 'deleted') {
    accountStatus = 'deleted';
    disabledUntil = null;
    deletedAt = new Date();
  }

  const displayName = patch.displayName !== undefined
    ? (patch.displayName?.trim() || null)
    : existing.display_name;
  const preferredLang = patch.preferredLang?.trim()?.slice(0, 16) ?? existing.preferred_lang;
  const deliveryMode = patch.deliveryMode !== undefined
    ? normalizeDeliveryMode(patch.deliveryMode)
    : normalizeDeliveryMode(existing.delivery_mode);
  const mergedDeliveryTime = patch.mergedDeliveryTime !== undefined
    ? normalizeDeliveryTime(patch.mergedDeliveryTime)
    : normalizeDeliveryTime(existing.merged_delivery_time);
  const mergedDeliveryTimezone = patch.mergedDeliveryTimezone !== undefined
    ? normalizeTimezone(patch.mergedDeliveryTimezone)
    : normalizeTimezone(existing.merged_delivery_timezone);

  const res = await query<SubscriberUserRow>(
    `UPDATE users SET
       display_name = $2,
       preferred_lang = $3,
       delivery_mode = $4,
       merged_delivery_time = $5,
       merged_delivery_timezone = $6,
       account_status = $7,
       disabled_until = $8,
       deleted_at = $9
     WHERE id = $1 AND role = 'user'
     RETURNING ${SUBSCRIBER_COLUMNS}`,
    [
      id,
      displayName,
      preferredLang,
      deliveryMode,
      mergedDeliveryTime,
      mergedDeliveryTimezone,
      accountStatus,
      disabledUntil,
      deletedAt,
    ],
  );
  return res.rows[0] ? mapSubscriberRow(res.rows[0]) : null;
}

export async function assertSubscriberCanLogin(row: SubscriberUserRow): Promise<void> {
  await reactivateSubscriberIfDisableExpired(row.id);
  const fresh = await getSubscriberById(row.id);
  if (!fresh || !isSubscriberLoginAllowed(fresh)) {
    const eff = fresh ? effectiveSubscriberStatus(fresh) : 'deleted';
    if (eff === 'disabled') throw new Error('account_disabled');
    if (eff === 'deleted') throw new Error('account_deleted');
    throw new Error('account_unavailable');
  }
}

export async function markMergedDeliverySent(userId: string, localDate: string): Promise<void> {
  await query(
    `UPDATE users SET merged_delivery_last_sent_date = $2::date WHERE id = $1 AND role = 'user'`,
    [userId, localDate],
  );
}
