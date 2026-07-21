import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyAdminRequest } from '@hxxworldmonitor/shared/admin-auth.js';
import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import {
  listPlatformLogFiles,
  PLATFORM_LOG_SERVICES,
  tailPlatformLogFile,
} from '@hxxworldmonitor/shared/platform-logger.js';
import { getAdminMeta, getAdminStats, getPublicCatalog } from './admin-meta-service.js';
import {
  createPreset,
  deletePreset,
  getPresetById,
  listPresets,
  updatePreset,
} from './preset-repository.js';
import {
  deliverAllEnabledSubscriptions,
  deliverMergedSubscriptionsForUser,
  deliverSubscription,
  runMatchPassAll,
} from './subscription-delivery-service.js';
import { runSubscriptionMatchPass } from './subscription-matcher.js';
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  listSubscriptionsPage,
  updateSubscription,
  type SubscriptionRules,
} from './subscription-repository.js';
import type { SubscriptionRules as Rules } from './subscription-rules.js';
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
  updateSubscriber,
} from './user-repository.js';
import { toAdminUserJson } from './user-account.js';
import {
  createUserApiKey,
  getUserApiKeyMeta,
  getUserApiKeyWithSecret,
  revokeUserApiKey,
  rotateUserApiKey,
  updateUserApiKeyExpiry,
} from './user-api-key-service.js';
import { authenticateAdmin, setSubscriberPassword } from './auth-repository.js';
import { signSessionToken } from '@hxxworldmonitor/shared/platform-session.js';
import {
  getWorkspaceSettingsPublic,
  patchWorkspaceSettings,
  resetSubscriberToDefaultPassword,
  resolveNewSubscriberPasswordHash,
} from './workspace-settings-repository.js';
import {
  listIntegrationProvidersPublic,
  updateIntegrationProvider,
  createCustomIntegrationProvider,
  deleteCustomIntegrationProvider,
} from './integration-providers-repository.js';
import {
  listEnginesPublic,
  updateEngine,
  createCustomEngine,
} from './engines-repository.js';
import {
  listIngestBindingsPublic,
  updateIngestBinding,
} from './ingest-bindings-repository.js';
import { isAiProviderSlug } from './integration-provider-catalog.js';
import { testAiModelConnection } from './ai-model-test-service.js';
import { refreshHxxbotConfigCache } from '@hxxworldmonitor/shared/hxxbot-config.js';
import { testHxxbotConnection } from './hxxbot-test-service.js';
import {
  enqueuePlatformJob,
  isSyncJobExecutionAllowed,
  jobHandlersCatalog,
} from './jobs/job-service.js';
import { jobDefinitionToJson, jobRunToJson, jobCheckpointToJson, kgDagStatusToJson } from './jobs/job-admin.js';
import {
  getHandlerQueueStatus,
  listJobDefinitions,
  listRecentJobRuns,
  reclaimStaleJobRuns,
  setJobDefinitionEnabled,
} from './jobs/job-repository.js';
import { listJobCheckpoints } from './jobs/job-checkpoint.js';
import { evaluateKgDag } from './jobs/job-dag.js';
import { getCninfoDisclosureStats } from './enterprise-graph/listed-companies-repository.js';
import { getCninfoDisclosureStats } from './enterprise-graph/listed-companies-repository.js';

type JsonFn = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBodyFn = (req: IncomingMessage) => Promise<string>;

function adminDenied(res: ServerResponse, json: JsonFn, error: string): void {
  json(res, 401, { error });
}

function dbRequired(res: ServerResponse, json: JsonFn): boolean {
  if (!isDatabaseEnabled()) {
    json(res, 503, { error: 'DATABASE_URL not configured' });
    return false;
  }
  return true;
}

function checkAdmin(req: IncomingMessage, res: ServerResponse, json: JsonFn): boolean {
  const auth = verifyAdminRequest(req);
  if (!auth.ok) {
    adminDenied(res, json, auth.error);
    return false;
  }
  return true;
}

async function toAdminUserJsonWithApiKey(user: Awaited<ReturnType<typeof getUserById>>): Promise<Record<string, unknown>> {
  if (!user) return {};
  const apiKey = await getUserApiKeyMeta(user.id);
  return { ...toAdminUserJson(user), apiKey };
}

function mapAdminApiKeyError(err: unknown): { status: number; error: string } {
  const code = String(err).replace(/^Error:\s*/, '');
  if (code === 'api_key_already_exists') return { status: 409, error: '该用户已有 API Key' };
  if (code === 'api_key_not_found') return { status: 404, error: '未找到 API Key' };
  if (code === 'api_key_storage_not_configured') {
    return { status: 503, error: '未配置 PLATFORM_JWT_SECRET，无法存储 API Key' };
  }
  if (code === 'invalid_expires_at') return { status: 400, error: '无效的过期时间' };
  return { status: 400, error: code };
}

/**
 * Handle /platform/v1/admin/* and public /platform/v1/catalog
 * @returns true if the request was handled
 */
export async function handlePlatformAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
  json: JsonFn,
  readBody: ReadBodyFn,
): Promise<boolean> {
  if (req.method === 'GET' && path === '/platform/v1/catalog') {
    if (!dbRequired(res, json)) return true;
    const catalog = await getPublicCatalog();
    json(res, 200, catalog);
    return true;
  }

  if (!path.startsWith('/platform/v1/admin')) return false;

  if (req.method === 'POST' && path === '/platform/v1/admin/login') {
    if (!dbRequired(res, json)) return true;
    let body: { email?: string; password?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const email = body.email?.trim();
    const password = body.password ?? '';
    if (!email || !password) {
      json(res, 400, { error: 'email and password are required' });
      return true;
    }
    try {
      const user = await authenticateAdmin(email, password);
      if (!user) {
        json(res, 401, { error: 'Invalid email or password' });
        return true;
      }
      const token = signSessionToken({
        sub: user.id,
        role: 'admin',
        ws: user.workspace_id,
        email: user.email,
      });
      json(res, 200, {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role,
        },
      });
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
    return true;
  }

  if (!checkAdmin(req, res, json)) return true;
  if (!dbRequired(res, json)) return true;

  if (req.method === 'GET' && path === '/platform/v1/admin/stats') {
    json(res, 200, await getAdminStats());
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/meta') {
    json(res, 200, await getAdminMeta());
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/logs') {
    const service = url.searchParams.get('service')?.trim();
    const date = url.searchParams.get('date')?.trim() || undefined;
    const lines = Number(url.searchParams.get('lines') ?? 200);

    if (service) {
      json(res, 200, tailPlatformLogFile(service, lines, date));
      return true;
    }

    json(res, 200, {
      services: [...PLATFORM_LOG_SERVICES],
      files: listPlatformLogFiles(),
    });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/presets') {
    const presets = await listPresets();
    json(res, 200, { presets, count: presets.length });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/presets') {
    let body: {
      title?: string;
      slug?: string;
      description?: string;
      rulesJson?: Rules;
      enabled?: boolean;
      sortOrder?: number;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const preset = await createPreset(body as Parameters<typeof createPreset>[0]);
      json(res, 201, { preset });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'PATCH' && /^\/platform\/v1\/admin\/presets\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()!;
    let body: Parameters<typeof updatePreset>[1] = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const preset = await updatePreset(id, body);
    json(res, preset ? 200 : 404, preset ? { preset } : { error: 'Preset not found' });
    return true;
  }

  if (req.method === 'DELETE' && /^\/platform\/v1\/admin\/presets\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()!;
    const ok = await deletePreset(id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Preset not found' });
    return true;
  }

  if (req.method === 'GET' && /^\/platform\/v1\/admin\/presets\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()!;
    const preset = await getPresetById(id);
    json(res, preset ? 200 : 404, preset ? { preset } : { error: 'Preset not found' });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/settings') {
    const settings = await getWorkspaceSettingsPublic();
    json(res, 200, { settings });
    return true;
  }

  if (req.method === 'PATCH' && path === '/platform/v1/admin/settings') {
    let body: {
      defaultUserPassword?: string;
      selfServiceSubscriptionsEnabled?: boolean;
      maxSubscriptionsPerUser?: number;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const hasPatch = body.defaultUserPassword !== undefined
      || body.selfServiceSubscriptionsEnabled !== undefined
      || body.maxSubscriptionsPerUser !== undefined;
    if (!hasPatch) {
      json(res, 400, { error: 'No settings fields to update' });
      return true;
    }
    try {
      await patchWorkspaceSettings({
        defaultUserPassword: body.defaultUserPassword,
        selfServiceSubscriptionsEnabled: body.selfServiceSubscriptionsEnabled,
        maxSubscriptionsPerUser: body.maxSubscriptionsPerUser,
      });
      const settings = await getWorkspaceSettingsPublic();
      json(res, 200, { settings });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  const testIntegrationMatch = path.match(/^\/platform\/v1\/admin\/integrations\/([^/]+)\/test$/);
  if (req.method === 'POST' && testIntegrationMatch) {
    const slug = testIntegrationMatch[1]!;
    if (slug !== 'hxxbot') {
      json(res, 404, { error: '该数据源暂不支持测试连接' });
      return true;
    }
    let body: { baseUrl?: string; apiKey?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const result = await testHxxbotConnection(body);
      json(res, result.ok ? 200 : 422, result);
    } catch (err) {
      json(res, 500, { ok: false, latencyMs: 0, error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/integrations') {
    const providers = await listIntegrationProvidersPublic(undefined, 'data');
    json(res, 200, { providers, total: providers.length });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/engines') {
    const engines = await listEnginesPublic();
    json(res, 200, { engines, total: engines.length });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/engines') {
    let body: {
      slug?: string;
      displayName?: string;
      engineType?: string;
      baseUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      remarks?: string;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const engine = await createCustomEngine({
        slug: body.slug ?? '',
        displayName: body.displayName ?? '',
        engineType: body.engineType ?? 'custom',
        baseUrl: body.baseUrl ?? '',
        apiKey: body.apiKey,
        enabled: body.enabled,
        remarks: body.remarks,
      });
      json(res, 201, { engine });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  const patchEngineMatch = path.match(/^\/platform\/v1\/admin\/engines\/([^/]+)$/);
  if (req.method === 'PATCH' && patchEngineMatch) {
    const slug = patchEngineMatch[1]!;
    let body: {
      displayName?: string;
      engineType?: string;
      baseUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      clearApiKey?: boolean;
      remarks?: string;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const engine = await updateEngine(slug, {
        displayName: body.displayName,
        engineType: body.engineType,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        enabled: body.enabled,
        clearApiKey: body.clearApiKey,
        remarks: body.remarks,
      });
      json(res, engine ? 200 : 404, engine ? { engine } : { error: 'Engine not found' });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/ingest-bindings') {
    const bindings = await listIngestBindingsPublic();
    json(res, 200, { bindings, total: bindings.length });
    return true;
  }

  const patchBindingMatch = path.match(/^\/platform\/v1\/admin\/ingest-bindings\/([^/]+)$/);
  if (req.method === 'PATCH' && patchBindingMatch) {
    const sourceSlug = patchBindingMatch[1]!;
    let body: { engineSlug?: string | null; enabled?: boolean } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const binding = await updateIngestBinding(sourceSlug, {
        engineSlug: body.engineSlug,
        enabled: body.enabled,
      });
      json(res, binding ? 200 : 404, binding ? { binding } : { error: 'Binding not found' });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/integrations') {
    let body: {
      slug?: string;
      displayName?: string;
      category?: string;
      baseUrl?: string;
      apiKey?: string;
      enabled?: boolean;
      remarks?: string;
      ingestEngineSlug?: string | null;
      crawlEngineSlug?: string | null;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const provider = await createCustomIntegrationProvider({
        slug: body.slug ?? '',
        displayName: body.displayName ?? '',
        category: body.category ?? 'custom',
        baseUrl: body.baseUrl ?? '',
        apiKey: body.apiKey,
        enabled: body.enabled,
        remarks: body.remarks,
        ingestEngineSlug: body.ingestEngineSlug ?? body.crawlEngineSlug,
      });
      json(res, 201, { provider });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  const deleteIntegrationMatch = path.match(/^\/platform\/v1\/admin\/integrations\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteIntegrationMatch) {
    const slug = deleteIntegrationMatch[1]!;
    if (isAiProviderSlug(slug)) {
      json(res, 400, { error: 'AI models are configured under /admin/ai-models' });
      return true;
    }
    const deleted = await deleteCustomIntegrationProvider(slug);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Not found or not a custom provider' });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/ai-models') {
    const providers = await listIntegrationProvidersPublic(undefined, 'ai');
    json(res, 200, { providers });
    return true;
  }

  const testAiModelMatch = path.match(/^\/platform\/v1\/admin\/ai-models\/([^/]+)\/test$/);
  if (req.method === 'POST' && testAiModelMatch) {
    const slug = testAiModelMatch[1]!;
    if (!isAiProviderSlug(slug)) {
      json(res, 404, { error: 'Not an AI model provider' });
      return true;
    }
    let body: { baseUrl?: string; modelName?: string; apiKey?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const result = await testAiModelConnection(slug, body);
      json(res, result.ok ? 200 : 422, result);
    } catch (err) {
      json(res, 500, { ok: false, latencyMs: 0, error: String(err) });
    }
    return true;
  }

  const patchIntegrationMatch = path.match(/^\/platform\/v1\/admin\/(?:integrations|ai-models)\/([^/]+)$/);
  if (req.method === 'PATCH' && patchIntegrationMatch) {
    const slug = patchIntegrationMatch[1]!;
    const aiRoute = path.startsWith('/platform/v1/admin/ai-models/');
    if (aiRoute && !isAiProviderSlug(slug)) {
      json(res, 404, { error: 'Not an AI model provider' });
      return true;
    }
    if (!aiRoute && isAiProviderSlug(slug)) {
      json(res, 400, { error: 'AI models are configured under /admin/ai-models' });
      return true;
    }
    let body: {
      displayName?: string;
      category?: string;
      baseUrl?: string;
      apiKey?: string;
      modelName?: string;
      enabled?: boolean;
      clearApiKey?: boolean;
      remarks?: string;
      ingestEngineSlug?: string | null;
      crawlEngineSlug?: string | null;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const provider = await updateIntegrationProvider(slug, {
        displayName: body.displayName,
        category: body.category,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey,
        modelName: body.modelName,
        enabled: body.enabled,
        clearApiKey: body.clearApiKey,
        remarks: body.remarks,
        ingestEngineSlug: body.ingestEngineSlug ?? body.crawlEngineSlug,
      });
      if (slug === 'hxxbot') await refreshHxxbotConfigCache();
      json(res, provider ? 200 : 404, provider ? { provider } : { error: 'Provider not found' });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/users') {
    const email = url.searchParams.get('email');
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true';
    if (email) {
      const user = await getUserByEmail(email);
      json(res, user ? 200 : 404, user ? { user: await toAdminUserJsonWithApiKey(user) } : { error: 'User not found' });
      return true;
    }
    const users = await listUsers(undefined, { includeDeleted });
    const usersWithKeys = await Promise.all(users.map((u) => toAdminUserJsonWithApiKey(u)));
    json(res, 200, {
      users: usersWithKeys,
      count: usersWithKeys.length,
    });
    return true;
  }

  if (req.method === 'GET' && /^\/platform\/v1\/admin\/users\/[^/]+$/.test(path)
      && !path.endsWith('/password')) {
    const id = path.split('/').pop()!;
    const user = await getUserById(id);
    json(res, user ? 200 : 404, user ? { user: await toAdminUserJsonWithApiKey(user) } : { error: 'User not found' });
    return true;
  }

  if (req.method === 'PATCH' && /^\/platform\/v1\/admin\/users\/[^/]+$/.test(path)
      && !path.endsWith('/password')) {
    const id = path.split('/').pop()!;
    let body: {
      displayName?: string | null;
      preferredLang?: string;
      deliveryMode?: string;
      mergedDeliveryTime?: string | null;
      mergedDeliveryTimezone?: string;
      accountStatus?: 'active' | 'disabled' | 'deleted';
      disablePermanent?: boolean;
      disabledUntil?: string | null;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      const user = await updateSubscriber(id, {
        displayName: body.displayName,
        preferredLang: body.preferredLang,
        deliveryMode: body.deliveryMode,
        mergedDeliveryTime: body.mergedDeliveryTime,
        mergedDeliveryTimezone: body.mergedDeliveryTimezone,
        accountStatus: body.accountStatus,
        disablePermanent: body.disablePermanent,
        disabledUntil: body.disabledUntil,
      });
      json(res, user ? 200 : 404, user ? { user: toAdminUserJson(user) } : { error: 'User not found' });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/users') {
    let body: { email?: string; displayName?: string; preferredLang?: string; password?: string } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    if (!body.email?.trim()) {
      json(res, 400, { error: 'email is required' });
      return true;
    }
    try {
      const passwordHash = await resolveNewSubscriberPasswordHash({
        password: body.password,
      });
      const user = await createUser({
        email: body.email,
        displayName: body.displayName,
        preferredLang: body.preferredLang,
        passwordHash,
      });
      json(res, 201, { user: toAdminUserJson(user) });
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, '');
      const status = msg === 'default_password_not_configured' ? 400 : 400;
      json(res, status, {
        error: msg === 'default_password_not_configured'
          ? '请先在系统设置中配置默认用户密码'
          : msg,
      });
    }
    return true;
  }

  if (req.method === 'PATCH' && /^\/platform\/v1\/admin\/users\/[^/]+\/password$/.test(path)) {
    const userId = path.split('/')[5]!;
    let body: { password?: string; useDefault?: boolean } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      if (body.useDefault) {
        await resetSubscriberToDefaultPassword(userId);
      } else if (body.password) {
        await setSubscriberPassword(userId, body.password);
      } else {
        json(res, 400, { error: 'password or useDefault=true is required' });
        return true;
      }
      json(res, 200, { ok: true });
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, '');
      json(res, 400, {
        error: msg === 'default_password_not_configured'
          ? '请先在系统设置中配置默认用户密码'
          : msg,
      });
    }
    return true;
  }

  if (/^\/platform\/v1\/admin\/users\/[^/]+\/api-key/.test(path)) {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;

    const segments = path.split('/');
    const userId = segments[5]!;
    const subAction = segments[7];

    const user = await getUserById(userId);
    if (!user) {
      json(res, 404, { error: 'User not found' });
      return true;
    }

    if (req.method === 'GET' && !subAction) {
      const key = await getUserApiKeyMeta(userId);
      json(res, 200, key);
      return true;
    }

    if (req.method === 'GET' && subAction === 'reveal') {
      const key = await getUserApiKeyWithSecret(userId);
      if (!key.hasKey || !key.apiKey) {
        json(res, 404, { error: 'api_key_not_found' });
        return true;
      }
      json(res, 200, {
        hasKey: true,
        apiKey: key.apiKey,
        keyPrefix: key.keyPrefix,
        expiresAt: key.expiresAt,
        permanent: key.permanent,
        createdAt: key.createdAt,
        expired: key.expired,
      });
      return true;
    }

    if (req.method === 'POST' && !subAction) {
      let body: { permanent?: boolean; expiresAt?: string | null } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        const key = await createUserApiKey(userId, body);
        json(res, 201, {
          hasKey: key.hasKey,
          apiKey: key.apiKey,
          keyPrefix: key.keyPrefix,
          expiresAt: key.expiresAt,
          permanent: key.permanent,
          createdAt: key.createdAt,
          expired: key.expired,
        });
      } catch (err) {
        const mapped = mapAdminApiKeyError(err);
        json(res, mapped.status, { error: mapped.error });
      }
      return true;
    }

    if (req.method === 'POST' && subAction === 'rotate') {
      let body: { permanent?: boolean; expiresAt?: string | null } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        const key = await rotateUserApiKey(userId, body);
        json(res, 200, {
          hasKey: key.hasKey,
          apiKey: key.apiKey,
          keyPrefix: key.keyPrefix,
          expiresAt: key.expiresAt,
          permanent: key.permanent,
          createdAt: key.createdAt,
          expired: key.expired,
        });
      } catch (err) {
        const mapped = mapAdminApiKeyError(err);
        json(res, mapped.status, { error: mapped.error });
      }
      return true;
    }

    if (req.method === 'PATCH' && subAction === 'expiry') {
      let body: { permanent?: boolean; expiresAt?: string | null } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        const key = await updateUserApiKeyExpiry(userId, body);
        json(res, 200, key);
      } catch (err) {
        const mapped = mapAdminApiKeyError(err);
        json(res, mapped.status, { error: mapped.error });
      }
      return true;
    }

    if (req.method === 'DELETE' && !subAction) {
      await revokeUserApiKey(userId);
      json(res, 200, { ok: true });
      return true;
    }

    json(res, 405, { error: 'Method not allowed' });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/subscriptions') {
    const userId = url.searchParams.get('userId') ?? undefined;
    const enabledOnly = url.searchParams.get('enabled') === 'true';
    const q = url.searchParams.get('q') ?? undefined;
    const pageRaw = Number(url.searchParams.get('page') ?? '1');
    const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? '20');
    const page = Number.isFinite(pageRaw) ? pageRaw : 1;
    const pageSize = Number.isFinite(pageSizeRaw) ? pageSizeRaw : 20;

    const result = await listSubscriptionsPage({
      userId,
      enabledOnly,
      q,
      page,
      pageSize,
    });
    const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
    json(res, 200, {
      subscriptions: result.items,
      count: result.items.length,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages,
    });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/subscriptions') {
    let body: {
      userId?: string;
      email?: string;
      name?: string;
      presetId?: string;
      rulesJson?: SubscriptionRules;
      enabled?: boolean;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    try {
      let userId = body.userId;
      if (!userId && body.email) {
        const passwordHash = await resolveNewSubscriberPasswordHash({});
        const user = await createUser({ email: body.email, passwordHash });
        userId = user.id;
      }
      if (!userId || !body.name?.trim()) {
        json(res, 400, { error: 'name and userId (or email) required' });
        return true;
      }
      if (!(await getUserById(userId))) {
        json(res, 404, { error: 'User not found' });
        return true;
      }
      const subscription = await createSubscription({
        userId,
        name: body.name,
        presetId: body.presetId,
        rulesJson: body.rulesJson,
        enabled: body.enabled,
      });
      json(res, 201, { subscription });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'PATCH' && /^\/platform\/v1\/admin\/subscriptions\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()!;
    let body: {
      name?: string;
      presetId?: string | null;
      rulesJson?: SubscriptionRules;
      enabled?: boolean;
    } = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch { /* empty */ }
    const subscription = await updateSubscription(id, body);
    json(res, subscription ? 200 : 404, subscription ? { subscription } : { error: 'Not found' });
    return true;
  }

  if (req.method === 'DELETE' && /^\/platform\/v1\/admin\/subscriptions\/[^/]+$/.test(path)) {
    const id = path.split('/').pop()!;
    const ok = await deleteSubscription(id);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
    return true;
  }

  if (req.method === 'POST' && /^\/platform\/v1\/admin\/subscriptions\/[^/]+\/match$/.test(path)) {
    const id = path.split('/')[5]!;
    const sub = await getSubscriptionById(id);
    if (!sub) {
      json(res, 404, { error: 'Subscription not found' });
      return true;
    }
    const result = await runSubscriptionMatchPass(sub);
    json(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === 'POST' && /^\/platform\/v1\/admin\/subscriptions\/[^/]+\/deliver$/.test(path)) {
    const id = path.split('/')[5]!;
    try {
      const result = await deliverSubscription(id, { force: true });
      json(res, 200, { ok: true, ...result });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && /^\/platform\/v1\/admin\/users\/[^/]+\/deliver-merged$/.test(path)) {
    const id = path.split('/')[5]!;
    try {
      const result = await deliverMergedSubscriptionsForUser(id, { force: true });
      json(res, 200, { ok: true, ...result });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/run/match-all') {
    if (isSyncJobExecutionAllowed()) {
      const result = await runMatchPassAll();
      json(res, 200, { ok: true, sync: true, ...result });
      return true;
    }
    const queued = await enqueuePlatformJob({
      handlerKey: 'subscription-match-deliver',
      payload: { mode: 'match' },
    });
    json(res, 202, { ok: true, queued: true, ...queued });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/run/deliver-all') {
    if (isSyncJobExecutionAllowed()) {
      try {
        const result = await deliverAllEnabledSubscriptions({ forceDeliver: true });
        json(res, 200, { ok: true, sync: true, ...result });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return true;
    }
    try {
      const queued = await enqueuePlatformJob({
        handlerKey: 'subscription-match-deliver',
        payload: { mode: 'deliver', forceDeliver: true },
      });
      json(res, 202, { ok: true, queued: true, ...queued });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/handlers') {
    if (!checkAdmin(req, res, json)) return true;
    json(res, 200, { handlers: jobHandlersCatalog() });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/definitions') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const defs = await listJobDefinitions();
    json(res, 200, { definitions: defs.map(jobDefinitionToJson) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/runs') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const limit = Number(url.searchParams.get('limit') ?? 30);
    const runs = await listRecentJobRuns(limit);
    json(res, 200, { runs: runs.map(jobRunToJson) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/queue-status') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const handlerKey = (url.searchParams.get('handlerKey') ?? 'disclosure-ingest-cn').trim();
    if (!handlerKey) {
      json(res, 400, { error: 'handlerKey is required' });
      return true;
    }
    const status = await getHandlerQueueStatus(handlerKey);
    json(res, 200, { status });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/jobs/reclaim-stale') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    let body: { lockTtlSec?: number } = {};
    try {
      const raw = await readBody(req);
      if (raw.trim()) body = JSON.parse(raw) as typeof body;
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    const lockTtlSec = Number(body.lockTtlSec ?? 300);
    const reclaimed = await reclaimStaleJobRuns(
      Number.isFinite(lockTtlSec) && lockTtlSec > 0 ? lockTtlSec : 300,
    );
    json(res, 200, { ok: true, reclaimed });
    return true;
  }

  if (req.method === 'POST' && path === '/platform/v1/admin/jobs/enqueue') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    let body: { handlerKey?: string; payload?: Record<string, unknown> } = {};
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    if (!body.handlerKey?.trim()) {
      json(res, 400, { error: 'handlerKey is required' });
      return true;
    }
    const handlerKey = body.handlerKey.trim();
    const payload = body.payload ?? {};
    if (handlerKey === 'disclosure-ingest-cn') {
      const force = payload.force === true;
      const symbols = Array.isArray(payload.symbols) ? payload.symbols : [];
      const allowFullMarket = payload.allowFullMarket === true;
      if (force && symbols.length === 0 && !allowFullMarket) {
        json(res, 400, {
          error:
            'force=true without symbols requires allowFullMarket=true (full-market re-download is heavy)',
        });
        return true;
      }
    }
    try {
      const queued = await enqueuePlatformJob({
        handlerKey,
        payload,
      });
      const queueStatus = await getHandlerQueueStatus(handlerKey);
      json(res, 202, { ok: true, queued: true, ...queued, queueStatus });
    } catch (err) {
      json(res, 400, { error: String(err) });
    }
    return true;
  }

  if (req.method === 'PATCH' && /^\/platform\/v1\/admin\/jobs\/definitions\/[^/]+$/.test(path)) {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const handlerKey = decodeURIComponent(path.split('/')[6]!);
    let body: { enabled?: boolean } = {};
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }
    if (typeof body.enabled !== 'boolean') {
      json(res, 400, { error: 'enabled (boolean) is required' });
      return true;
    }
    const updated = await setJobDefinitionEnabled(handlerKey, body.enabled);
    if (!updated) {
      json(res, 404, { error: 'Job definition not found' });
      return true;
    }
    json(res, 200, { definition: jobDefinitionToJson(updated) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/checkpoints') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const checkpoints = await listJobCheckpoints();
    json(res, 200, { checkpoints: checkpoints.map(jobCheckpointToJson) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/jobs/dag-status') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const dag = await evaluateKgDag();
    json(res, 200, { dag: kgDagStatusToJson(dag) });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/admin/disclosure/stats') {
    if (!checkAdmin(req, res, json)) return true;
    if (!dbRequired(res, json)) return true;
    const stats = await getCninfoDisclosureStats();
    json(res, 200, { stats });
    return true;
  }

  json(res, 404, { error: 'Admin route not found', path });
  return true;
}
