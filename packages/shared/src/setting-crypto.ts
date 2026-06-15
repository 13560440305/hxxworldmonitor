import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

declare const process: { env: Record<string, string | undefined> };

function settingCryptoKey(): Buffer | null {
  const secret = process.env.PLATFORM_JWT_SECRET?.trim()
    || process.env.PLATFORM_ADMIN_TOKEN?.trim();
  if (!secret) return null;
  return createHash('sha256').update(`wm-setting:${secret}`).digest();
}

/** Encrypt workspace setting values for admin-only display (AES-256-GCM). */
export function encryptSettingValue(plain: string): string {
  const key = settingCryptoKey();
  if (!key) throw new Error('PLATFORM_JWT_SECRET required to store default password');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptSettingValue(payload: string | null | undefined): string | null {
  if (!payload?.trim()) return null;
  const key = settingCryptoKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(payload, 'base64url');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
