import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { hashPassword, verifyPassword } from '@hxxworldmonitor/shared/password.js';
import type { PlatformUserRow } from './user-account.js';
import { assertSubscriberCanLogin, getSubscriberById } from './user-repository.js';

export type AuthUserRow = PlatformUserRow & {
  role: 'admin' | 'user';
  password_hash: string | null;
};

function mapRow(row: AuthUserRow): AuthUserRow {
  return row;
}

export async function getAdminUser(workspaceId?: string): Promise<AuthUserRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<AuthUserRow>(
    `SELECT id, workspace_id, email, display_name, created_at, role, password_hash
     FROM users WHERE workspace_id = $1 AND role = 'admin'
     LIMIT 1`,
    [ws],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function getAuthUserByEmail(
  email: string,
  workspaceId?: string,
): Promise<AuthUserRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<AuthUserRow>(
    `SELECT id, workspace_id, email, display_name, created_at, role, password_hash
     FROM users WHERE workspace_id = $1 AND email = $2`,
    [ws, email.trim().toLowerCase()],
  );
  return res.rows[0] ? mapRow(res.rows[0]) : null;
}

export async function authenticateAdmin(
  email: string,
  password: string,
): Promise<AuthUserRow | null> {
  const user = await getAuthUserByEmail(email);
  if (!user || user.role !== 'admin' || !user.password_hash) return null;
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? user : null;
}

export async function authenticateUser(
  email: string,
  password: string,
): Promise<AuthUserRow | null> {
  const user = await getAuthUserByEmail(email);
  if (!user || user.role !== 'user' || !user.password_hash) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  const sub = await getSubscriberById(user.id);
  if (!sub) return null;
  await assertSubscriberCanLogin(sub);
  return user;
}

export async function setSubscriberPassword(userId: string, password: string): Promise<void> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const passwordHash = await hashPassword(password);
  const res = await query(
    `UPDATE users SET password_hash = $2
     WHERE id = $1 AND role = 'user'`,
    [userId, passwordHash],
  );
  if (res.rowCount === 0) throw new Error('Subscriber not found');
}

export async function createAdminUser(opts: {
  email: string;
  password: string;
  displayName?: string;
  workspaceId?: string;
}): Promise<AuthUserRow> {
  const ws = opts.workspaceId ?? getDefaultWorkspaceId();
  const existing = await getAdminUser(ws);
  if (existing) {
    throw new Error('Administrator already exists for this workspace (only one admin allowed)');
  }

  const email = opts.email.trim().toLowerCase();
  if (!email.includes('@')) throw new Error('Valid email is required');
  if (!opts.password || opts.password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const passwordHash = await hashPassword(opts.password);
  const res = await query<AuthUserRow>(
    `INSERT INTO users (workspace_id, email, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')
     RETURNING id, workspace_id, email, display_name, created_at, role, password_hash`,
    [ws, email, opts.displayName?.trim() || 'Administrator', passwordHash],
  );
  return res.rows[0]!;
}

export async function updateAdminPassword(
  adminId: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const passwordHash = await hashPassword(newPassword);
  const res = await query(
    `UPDATE users SET password_hash = $2
     WHERE id = $1 AND role = 'admin'`,
    [adminId, passwordHash],
  );
  if (res.rowCount === 0) throw new Error('Administrator not found');
}

export async function hasAdminUser(workspaceId?: string): Promise<boolean> {
  return (await getAdminUser(workspaceId)) !== null;
}
