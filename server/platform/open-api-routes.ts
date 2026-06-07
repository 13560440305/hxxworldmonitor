import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDatabaseEnabled } from '../_shared/db.js';
import {
  assertSubscriberCanLogin,
  createUser,
  getUserByEmail,
} from './user-repository.js';
import {
  ensureUserApiKey,
  getUserApiKeyWithSecret,
  isIntegrationSecretConfigured,
  resolveUserByApiKey,
  rotateUserApiKey,
  verifyIntegrationSecret,
} from './user-api-key-service.js';
import {
  SelfServiceSubscriptionError,
  getUserSubscriptionCatalog,
  subscribeUserToPreset,
  unsubscribeUserSubscription,
} from './user-subscription-service.js';
import { listSubscriptions } from './subscription-repository.js';
import { describeRulesLang } from './subscription-rules.js';

type JsonFn = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBodyFn = (req: IncomingMessage) => Promise<string>;

function extractBearer(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization?.trim();
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const integration = req.headers['x-integration-key'];
  if (typeof integration === 'string' && integration.trim()) return integration.trim();
  return undefined;
}

function extractIntegrationSecret(req: IncomingMessage): string | undefined {
  const header = req.headers['x-integration-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return extractBearer(req);
}

function requireIntegration(
  req: IncomingMessage,
  res: ServerResponse,
  json: JsonFn,
): boolean {
  if (!isIntegrationSecretConfigured()) {
    json(res, 503, { error: 'integration_secret_not_configured' });
    return false;
  }
  if (!verifyIntegrationSecret(extractIntegrationSecret(req))) {
    json(res, 401, { error: 'invalid_integration_secret' });
    return false;
  }
  return true;
}

async function requireOpenApiUser(
  req: IncomingMessage,
  res: ServerResponse,
  json: JsonFn,
): Promise<{ userId: string } | null> {
  const token = extractBearer(req);
  if (!token) {
    json(res, 401, { error: 'missing_api_key' });
    return null;
  }
  const result = await resolveUserByApiKey(token);
  if (!result.ok) {
    if (result.reason === 'expired') {
      json(res, 401, { error: 'api_key_expired', expiresAt: result.expiresAt ?? null });
      return null;
    }
    if (result.reason === 'account_unavailable') {
      json(res, 403, { error: 'account_unavailable' });
      return null;
    }
    json(res, 401, { error: 'invalid_api_key' });
    return null;
  }
  return { userId: result.context.userId };
}

function publicUserJson(user: Awaited<ReturnType<typeof getUserByEmail>>) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    preferred_lang: user.preferred_lang,
  };
}

function keyResponse(key: Awaited<ReturnType<typeof getUserApiKeyWithSecret>>, created: boolean) {
  return {
    apiKey: key.apiKey,
    keyPrefix: key.keyPrefix,
    expiresAt: key.expiresAt,
    permanent: key.permanent,
    created,
  };
}

function selfServiceStatus(code: string): number {
  if (code === 'preset_not_found' || code === 'subscription_not_found') return 404;
  if (code === 'self_service_disabled' || code === 'subscription_limit_reached' || code === 'already_subscribed') {
    return 403;
  }
  return 400;
}

/**
 * External Open API: /platform/v1/open/*
 * @returns true if handled
 */
export async function handleOpenApiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  json: JsonFn,
  readBody: ReadBodyFn,
): Promise<boolean> {
  if (!path.startsWith('/platform/v1/open')) return false;

  if (!isDatabaseEnabled()) {
    json(res, 503, { error: 'DATABASE_URL not configured' });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/open/users/key') {
    if (!requireIntegration(req, res, json)) return true;
    const email = new URL(req.url ?? '', 'http://local').searchParams.get('email')?.trim();
    if (!email) {
      json(res, 400, { error: 'email_required' });
      return true;
    }
    try {
      let user = await getUserByEmail(email);
      let userCreated = false;
      if (!user) {
        user = await createUser({ email });
        userCreated = true;
      }
      await assertSubscriberCanLogin(user);
      const { key, created } = await ensureUserApiKey(user.id, { permanent: true });
      json(res, 200, {
        user: publicUserJson(user),
        ...keyResponse(key, created || userCreated),
      });
    } catch (err) {
      json(res, 400, { error: String(err).replace(/^Error:\s*/, '') });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/open/users') {
    if (!requireIntegration(req, res, json)) return true;
    let body: {
      email?: string;
      displayName?: string;
      preferredLang?: string;
      permanent?: boolean;
      expiresAt?: string | null;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    if (!body.email?.trim()) {
      json(res, 400, { error: 'email_required' });
      return true;
    }
    try {
      let user = await getUserByEmail(body.email);
      let userCreated = false;
      if (!user) {
        user = await createUser({
          email: body.email,
          displayName: body.displayName,
          preferredLang: body.preferredLang,
        });
        userCreated = true;
      }
      await assertSubscriberCanLogin(user);
      const { key, created } = await ensureUserApiKey(user.id, body);
      json(res, userCreated ? 201 : 200, {
        user: publicUserJson(user),
        ...keyResponse(key, created || userCreated),
      });
    } catch (err) {
      json(res, 400, { error: String(err).replace(/^Error:\s*/, '') });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/open/users/key/rotate') {
    if (!requireIntegration(req, res, json)) return true;
    let body: { email?: string; permanent?: boolean; expiresAt?: string | null } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    if (!body.email?.trim()) {
      json(res, 400, { error: 'email_required' });
      return true;
    }
    try {
      const user = await getUserByEmail(body.email);
      if (!user) {
        json(res, 404, { error: 'user_not_found' });
        return true;
      }
      await assertSubscriberCanLogin(user);
      const key = await rotateUserApiKey(user.id, body);
      json(res, 200, { user: publicUserJson(user), ...keyResponse(key, true) });
    } catch (err) {
      json(res, 400, { error: String(err).replace(/^Error:\s*/, '') });
    }
    return true;
  }

  const openUser = await requireOpenApiUser(req, res, json);
  if (!openUser) return true;

  if (req.method === 'GET' && path === '/platform/v1/open/catalog') {
    try {
      const catalog = await getUserSubscriptionCatalog(openUser.userId);
      json(res, 200, catalog);
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceStatus(err.code), { error: err.code });
        return true;
      }
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/open/subscriptions') {
    const subs = await listSubscriptions({ userId: openUser.userId });
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

  if (req.method === 'POST' && path === '/platform/v1/open/subscriptions') {
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
      const subscription = await subscribeUserToPreset(openUser.userId, presetId);
      json(res, 201, { subscription });
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceStatus(err.code), { error: err.code });
        return true;
      }
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'DELETE' && /^\/platform\/v1\/open\/subscriptions\/[^/]+$/.test(path)) {
    const subscriptionId = path.split('/').pop()!;
    try {
      await unsubscribeUserSubscription(openUser.userId, subscriptionId);
      json(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof SelfServiceSubscriptionError) {
        json(res, selfServiceStatus(err.code), { error: err.code });
        return true;
      }
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  json(res, 404, { error: 'Not found', path });
  return true;
}
