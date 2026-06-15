import type { IncomingMessage } from 'node:http';
import { verifySessionToken, getSessionSecret, type SessionPayload } from './platform-session.ts';

declare const process: { env: Record<string, string | undefined> };

export type AdminAuthResult =
  | { ok: true; session?: SessionPayload; legacy?: boolean }
  | { ok: false; error: string };

/** @deprecated Legacy env token — prefer DB admin login */
export function isLegacyAdminTokenConfigured(): boolean {
  return Boolean(process.env.PLATFORM_ADMIN_TOKEN?.trim());
}

export function isSessionSigningConfigured(): boolean {
  return Boolean(getSessionSecret());
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const header = req.headers['x-admin-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return undefined;
}

export function verifyAdminRequest(req: IncomingMessage): AdminAuthResult {
  const provided = extractBearerToken(req);
  if (!provided) {
    return { ok: false, error: 'Missing authorization token' };
  }

  const legacy = process.env.PLATFORM_ADMIN_TOKEN?.trim();
  if (legacy && provided === legacy) {
    return { ok: true, legacy: true };
  }

  const session = verifySessionToken(provided);
  if (!session) {
    return { ok: false, error: 'Invalid or expired session token' };
  }
  if (session.role !== 'admin') {
    return { ok: false, error: 'Administrator role required' };
  }
  return { ok: true, session };
}
