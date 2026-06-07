import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDatabaseEnabled } from '../_shared/db.js';
import { isSessionSigningConfigured } from '../_shared/admin-auth.js';
import { verifyUserRequest } from '../_shared/user-auth.js';
import { signSessionToken } from '../_shared/platform-session.js';
import { authenticateUser } from './auth-repository.js';
import { assertSubscriberCanLogin, getUserById, updateSubscriber } from './user-repository.js';
import { listSubscriptions } from './subscription-repository.js';
import { describeRulesLang } from './subscription-rules.js';
import {
  registerSubscriber,
  resetPasswordWithCode,
  sendPasswordResetCode,
} from './user-auth-service.js';
import {
  SelfServiceSubscriptionError,
  getUserSubscriptionCatalog,
  subscribeUserToPreset,
  syncUserSubscriptionLanguages,
  unsubscribeUserSubscription,
} from './user-subscription-service.js';

type JsonFn = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBodyFn = (req: IncomingMessage) => Promise<string>;

function publicUser(user: Awaited<ReturnType<typeof getUserById>>) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    preferred_lang: user.preferred_lang,
    created_at: user.created_at,
  };
}

function authErrorStatus(code: string): number {
  if (code === 'invalid_email_password' || code === 'invalid_or_expired_code') return 401;
  if (code === 'email_not_found' || code === 'preset_not_found' || code === 'subscription_not_found') return 404;
  if (code === 'hxxbot_not_configured') return 503;
  if (code === 'send_code_too_soon') return 429;
  if (code === 'self_service_disabled' || code === 'subscription_limit_reached' || code === 'already_subscribed') {
    return 403;
  }
  return 400;
}

function selfServiceErrorStatus(code: string): number {
  return authErrorStatus(code);
}

async function issueUserToken(
  userId: string,
  json: JsonFn,
  res: ServerResponse,
): Promise<void> {
  const user = await getUserById(userId);
  if (!user) {
    json(res, 401, { error: 'invalid_email_password' });
    return;
  }
  const token = signSessionToken({
    sub: user.id,
    role: 'user',
    ws: user.workspace_id,
    email: user.email,
  });
  json(res, 200, { token, user: publicUser(user) });
}

export async function handleUserAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  json: JsonFn,
  readBody: ReadBodyFn,
): Promise<boolean> {
  if (!path.startsWith('/platform/v1/auth')) return false;

  if (req.method === 'GET' && path === '/platform/v1/auth/status') {
    json(res, 200, {
      enabled: isDatabaseEnabled() && isSessionSigningConfigured(),
    });
    return true;
  }

  if (!isDatabaseEnabled()) {
    json(res, 503, { error: 'DATABASE_URL not configured' });
    return true;
  }

  if (!isSessionSigningConfigured()) {
    json(res, 503, { error: 'PLATFORM_JWT_SECRET not configured' });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/auth/login') {
    let body: { email?: string; password?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const email = body.email?.trim();
    const password = body.password ?? '';
    if (!email || !password) {
      json(res, 400, { error: 'email_required' });
      return true;
    }
    try {
      const authUser = await authenticateUser(email, password);
      if (!authUser) {
        json(res, 401, { error: 'invalid_email_password' });
        return true;
      }
      await issueUserToken(authUser.id, json, res);
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, code === 'account_disabled' || code === 'account_deleted' ? 403 : 401, { error: code });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/auth/register') {
    let body: { email?: string; password?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const user = await registerSubscriber(body.email ?? '', body.password ?? '');
      await issueUserToken(user.id, json, res);
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, authErrorStatus(code), { error: code });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/auth/send-reset-code') {
    let body: { email?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      await sendPasswordResetCode(body.email ?? '');
      json(res, 200, { ok: true });
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, authErrorStatus(code), { error: code });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/auth/reset-password') {
    let body: { email?: string; code?: string; password?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      await resetPasswordWithCode(body.email ?? '', body.code ?? '', body.password ?? '');
      json(res, 200, { ok: true });
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, authErrorStatus(code), { error: code });
    }
    return true;
  }

  const auth = verifyUserRequest(req);
  if (!auth.ok) {
    json(res, 401, { error: auth.error });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/auth/me') {
    const user = await getUserById(auth.session.sub);
    if (!user) {
      json(res, 401, { error: 'User not found' });
      return true;
    }
    try {
      await assertSubscriberCanLogin(user);
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, 403, { error: code });
      return true;
    }
    if (!user) {
      json(res, 401, { error: 'User not found' });
      return true;
    }
    json(res, 200, { user: publicUser(user) });
    return true;
  }

  if (req.method === 'PATCH' && path === '/platform/v1/auth/me') {
    let body: { displayName?: string | null; preferredLang?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const user = await getUserById(auth.session.sub);
    if (!user) {
      json(res, 401, { error: 'User not found' });
      return true;
    }
    try {
      await assertSubscriberCanLogin(user);
    } catch (err) {
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, 403, { error: code });
      return true;
    }
    const updated = await updateSubscriber(auth.session.sub, {
      displayName: body.displayName,
      preferredLang: body.preferredLang,
    });
    if (!updated) {
      json(res, 404, { error: 'User not found' });
      return true;
    }
    if (body.preferredLang?.trim()) {
      await syncUserSubscriptionLanguages(auth.session.sub, body.preferredLang.trim());
    }
    json(res, 200, { user: publicUser(updated) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/auth/catalog') {
    const user = await getUserById(auth.session.sub);
    if (!user) {
      json(res, 401, { error: 'User not found' });
      return true;
    }
    try {
      await assertSubscriberCanLogin(user);
      const catalog = await getUserSubscriptionCatalog(auth.session.sub);
      json(res, 200, catalog);
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceErrorStatus(err.code), { error: err.code });
        return true;
      }
      const code = String(err).replace(/^Error:\s*/, '');
      json(res, code === 'account_disabled' || code === 'account_deleted' ? 403 : 400, { error: code });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/auth/subscriptions') {
    let body: { presetId?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const presetId = body.presetId?.trim();
    if (!presetId) {
      json(res, 400, { error: 'preset_id_required' });
      return true;
    }
    try {
      const user = await getUserById(auth.session.sub);
      if (!user) {
        json(res, 401, { error: 'User not found' });
        return true;
      }
      await assertSubscriberCanLogin(user);
      const subscription = await subscribeUserToPreset(auth.session.sub, presetId);
      json(res, 201, { subscription });
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceErrorStatus(err.code), { error: err.code });
        return true;
      }
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'DELETE' && /^\/platform\/v1\/auth\/subscriptions\/[^/]+$/.test(path)) {
    const subscriptionId = path.split('/').pop()!;
    try {
      const user = await getUserById(auth.session.sub);
      if (!user) {
        json(res, 401, { error: 'User not found' });
        return true;
      }
      await assertSubscriberCanLogin(user);
      await unsubscribeUserSubscription(auth.session.sub, subscriptionId);
      json(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceErrorStatus(err.code), { error: err.code });
        return true;
      }
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/auth/subscriptions') {
    const subs = await listSubscriptions({ userId: auth.session.sub });
    json(res, 200, {
      subscriptions: subs.map((s) => ({
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        preset_title: s.preset_title ?? null,
        rules_summary: describeRulesLang(s.rules_json),
        created_at: s.created_at,
      })),
      count: subs.length,
    });
    return true;
  }

  json(res, 404, { error: 'Not found' });
  return true;
}
