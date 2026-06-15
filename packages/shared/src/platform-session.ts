import { createHmac, timingSafeEqual } from 'node:crypto';

declare const process: { env: Record<string, string | undefined> };

export type UserRole = 'admin' | 'user';

export interface SessionPayload {
  sub: string;
  role: UserRole;
  ws: string;
  email: string;
}

const DEFAULT_TTL_SEC = 86_400;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBuffer(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function getSessionSecret(): string | undefined {
  return (
    process.env.PLATFORM_JWT_SECRET?.trim()
    || process.env.PLATFORM_ADMIN_TOKEN?.trim()
    || undefined
  );
}

export function getSessionTtlSec(): number {
  const hours = Number(process.env.PLATFORM_ADMIN_SESSION_HOURS ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_SEC;
  return Math.floor(hours * 3600);
}

export function signSessionToken(payload: Omit<SessionPayload, never>): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('PLATFORM_JWT_SECRET or PLATFORM_ADMIN_TOKEN required for sessions');
  }
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + getSessionTtlSec(),
  }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const actual = base64UrlToBuffer(sig!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(base64UrlToBuffer(body!).toString('utf8')) as SessionPayload & { exp?: number };
    if (!payload.sub || !payload.role || !payload.ws || !payload.email) return null;
    if (payload.exp !== undefined && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      sub: payload.sub,
      role: payload.role,
      ws: payload.ws,
      email: payload.email,
    };
  } catch {
    return null;
  }
}
