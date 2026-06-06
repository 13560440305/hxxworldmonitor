import { createHash, randomInt } from 'node:crypto';
import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { sendEmail } from './hxxbot-email.js';
import { getAuthUserByEmail, setSubscriberPassword } from './auth-repository.js';
import { createUser } from './user-repository.js';

export type AuthErrorCode =
  | 'email_required'
  | 'password_required'
  | 'password_too_short'
  | 'code_required'
  | 'invalid_email_password'
  | 'email_already_registered'
  | 'email_not_found'
  | 'invalid_or_expired_code'
  | 'hxxbot_not_configured'
  | 'send_code_too_soon';

const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SEC = 60;

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

function generateSixDigitCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerSubscriber(
  emailRaw: string,
  password: string,
): Promise<Awaited<ReturnType<typeof createUser>>> {
  const email = normalizeEmail(emailRaw);
  if (!email.includes('@')) throw new Error('email_required');
  if (!password) throw new Error('password_required');
  if (password.length < 8) throw new Error('password_too_short');

  const existing = await getAuthUserByEmail(email);
  if (existing?.role === 'admin') throw new Error('email_already_registered');
  if (existing?.role === 'user' && existing.password_hash) {
    throw new Error('email_already_registered');
  }

  return createUser({ email, password });
}

export async function sendPasswordResetCode(emailRaw: string): Promise<void> {
  if (!isHxxbotConfigured()) throw new Error('hxxbot_not_configured');

  const email = normalizeEmail(emailRaw);
  if (!email.includes('@')) throw new Error('email_required');

  const user = await getAuthUserByEmail(email);
  if (!user || user.role !== 'user') throw new Error('email_not_found');

  const ws = getDefaultWorkspaceId();
  const recent = await query<{ created_at: Date }>(
    `SELECT created_at FROM email_verification_codes
     WHERE workspace_id = $1 AND lower(email) = $2 AND purpose = 'password_reset'
     ORDER BY created_at DESC LIMIT 1`,
    [ws, email],
  );
  const last = recent.rows[0]?.created_at;
  if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_SEC * 1000) {
    throw new Error('send_code_too_soon');
  }

  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await query(
    `UPDATE email_verification_codes SET used_at = NOW()
     WHERE workspace_id = $1 AND lower(email) = $2 AND purpose = 'password_reset' AND used_at IS NULL`,
    [ws, email],
  );

  await query(
    `INSERT INTO email_verification_codes (workspace_id, email, purpose, code_hash, expires_at)
     VALUES ($1, $2, 'password_reset', $3, $4)`,
    [ws, email, hashCode(code), expiresAt],
  );

  const subject = 'World Monitor — 密码重置验证码 / Password reset code';
  const text = [
    `您的验证码是：${code}`,
    `${CODE_TTL_MINUTES} 分钟内有效。`,
    '',
    `Your verification code: ${code}`,
    `Valid for ${CODE_TTL_MINUTES} minutes.`,
  ].join('\n');

  await sendEmail({ to: email, subject, text });
}

export async function resetPasswordWithCode(
  emailRaw: string,
  codeRaw: string,
  newPassword: string,
): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim();
  if (!email.includes('@')) throw new Error('email_required');
  if (!code) throw new Error('code_required');
  if (!newPassword) throw new Error('password_required');
  if (newPassword.length < 8) throw new Error('password_too_short');

  const user = await getAuthUserByEmail(email);
  if (!user || user.role !== 'user') throw new Error('email_not_found');

  const ws = getDefaultWorkspaceId();
  const res = await query<{ id: string }>(
    `SELECT id FROM email_verification_codes
     WHERE workspace_id = $1 AND lower(email) = $2 AND purpose = 'password_reset'
       AND code_hash = $3 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [ws, email, hashCode(code)],
  );
  if (!res.rows[0]) throw new Error('invalid_or_expired_code');

  await setSubscriberPassword(user.id, newPassword);
  await query(
    `UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1`,
    [res.rows[0].id],
  );
}
