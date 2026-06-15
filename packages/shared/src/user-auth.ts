import type { IncomingMessage } from 'node:http';
import { verifySessionToken, type SessionPayload } from './platform-session.ts';

export type UserAuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; error: string };

function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
}

export function verifyUserRequest(req: IncomingMessage): UserAuthResult {
  const provided = extractBearerToken(req);
  if (!provided) {
    return { ok: false, error: 'Missing authorization token' };
  }

  const session = verifySessionToken(provided);
  if (!session) {
    return { ok: false, error: 'Invalid or expired session token' };
  }
  if (session.role !== 'user') {
    return { ok: false, error: 'Subscriber account required' };
  }
  return { ok: true, session };
}
