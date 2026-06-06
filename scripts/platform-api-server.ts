import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { checkDatabaseHealth, closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { checkOssHealth, isOssEnabled } from '../server/_shared/blob-store.js';
import { isRedisEnabled, closeRedisClient, publishEmbeddingJob } from '../server/_shared/redis-client.js';
import { aggregateByCategory, countNewsItems, listRecentNews } from '../server/platform/news-repository.js';
import { buildDigestFromPg } from '../server/platform/digest-from-pg.js';
import { countEmbeddings } from '../server/platform/embedding-repository.js';
import { createMonitorProfile, listMonitorProfiles } from '../server/platform/monitor-repository.js';
import {
  buildMonitorReport,
  compareEntities,
  runEmbeddingBatch,
  semanticSearchByText,
} from '../server/platform/research-service.js';
import { runAllVariantIngest, runRssIngest } from '../server/platform/rss-ingest.js';
import { runColdTierPass } from '../server/platform/cold-tier-worker.js';
import { generateAiBrief } from '../server/platform/brief-service.js';
import { getLatestBrief } from '../server/platform/brief-repository.js';
import { sendEmail, type SendEmailInput } from '../server/platform/hxxbot-email.js';
import { runQaSession } from '../server/platform/hxxbot-qa.js';
import { getTranslateLanguages, translateText } from '../server/platform/hxxbot-translate.js';
import { sendBriefEmail, sendEmailNotification } from '../server/platform/notification-service.js';
import {
  deliverAllEnabledSubscriptions,
  deliverSubscription,
  runMatchPassAll,
} from '../server/platform/subscription-delivery-service.js';
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  listSubscriptions,
  updateSubscription,
  type SubscriptionRules,
} from '../server/platform/subscription-repository.js';
import { runSubscriptionMatchPass } from '../server/platform/subscription-matcher.js';
import { handlePlatformAdminRoutes } from '../server/platform/admin-api.js';
import { handleUserAuthRoutes } from '../server/platform/user-auth-api.js';
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
} from '../server/platform/user-repository.js';
import {
  getHxxbotPublicStatus,
  isHxxbotConfigured,
} from '../server/_shared/hxxbot-config.js';
import {
  createPlatformLogger,
  getPlatformLogDir,
  installProcessLogHandlers,
} from '../server/_shared/platform-logger.js';
import {
  isAutoMigrateEnabled,
  runPlatformDbBootstrap,
} from '../server/platform/platform-db-bootstrap.js';

declare const process: { env: Record<string, string | undefined> };

const PORT = Number(process.env.PLATFORM_API_PORT ?? 8787);
const log = createPlatformLogger('platform-api');
installProcessLogHandlers(log);

const HXXBOT_CONFIG_HINT =
  '请在 .env.local 配置 HXXBOT_SITE_URL=https://www.hxxbot.com 与 HXXBOT_API_KEY';

function hxxbotNotConfigured(): boolean {
  return !isHxxbotConfigured();
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function attachRequestLogging(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): void {
  const started = Date.now();
  let logged = false;
  const origEnd = res.end.bind(res);
  res.end = ((...args: Parameters<typeof res.end>) => {
    if (!logged) {
      logged = true;
      const durationMs = Date.now() - started;
      const status = res.statusCode || 200;
      const meta = { status, durationMs, method: req.method ?? 'GET' };
      if (status >= 500) log.error(`${req.method} ${path}`, undefined, meta);
      else if (status >= 400) log.warn(`${req.method} ${path}`, meta);
      else log.info(`${req.method} ${path}`, meta);
    }
    return origEnd(...args);
  }) as typeof res.end;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  attachRequestLogging(req, res, path);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    });
    res.end();
    return;
  }

  try {
    if (await handleUserAuthRoutes(req, res, path, json, readBody)) {
      return;
    }
    if (await handlePlatformAdminRoutes(req, res, path, url, json, readBody)) {
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/health') {
      const [db, oss] = await Promise.all([checkDatabaseHealth(), checkOssHealth()]);
      const newsCount = isDatabaseEnabled() ? await countNewsItems().catch(() => 0) : 0;
      const embedCount = isDatabaseEnabled() ? await countEmbeddings().catch(() => 0) : 0;
      json(res, 200, {
        status: db.ok ? 'ok' : 'degraded',
        database: db,
        redis: { enabled: isRedisEnabled() },
        oss: { enabled: isOssEnabled(), ...oss },
        newsItems: newsCount,
        embeddings: embedCount,
        hxxbot: getHxxbotPublicStatus(),
        phase: '2-research-mvp',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // --- HXXBOT tool marketplace (Phase 1) ---
    if (req.method === 'GET' && path === '/platform/v1/hxxbot/status') {
      json(res, 200, {
        ...getHxxbotPublicStatus(),
        tools: [
          'builtin.email_send',
          'builtin.qa_session',
          'builtin.translate',
          'builtin.translate_languages',
        ],
      });
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/translate/languages') {
      if (hxxbotNotConfigured()) {
        json(res, 503, { error: HXXBOT_CONFIG_HINT });
        return;
      }
      const locale = url.searchParams.get('locale') ?? url.searchParams.get('lang') ?? 'zh-CN';
      const languages = await getTranslateLanguages(locale);
      json(res, 200, languages);
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/translate') {
      if (hxxbotNotConfigured()) {
        json(res, 503, { error: HXXBOT_CONFIG_HINT });
        return;
      }
      let body: { text?: string; to?: string; from?: string } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.text?.trim() || !body.to?.trim()) {
        json(res, 400, { error: 'text and to are required' });
        return;
      }
      const result = await translateText(body.text, body.to, body.from);
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/qa') {
      if (hxxbotNotConfigured()) {
        json(res, 503, { error: HXXBOT_CONFIG_HINT });
        return;
      }
      let body: {
        question?: string;
        messages?: Array<{ role: string; content: string }>;
        model_id?: string;
      } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        const result = await runQaSession({
          question: body.question,
          messages: body.messages as Parameters<typeof runQaSession>[0]['messages'],
          model_id: body.model_id,
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/email/send') {
      if (hxxbotNotConfigured()) {
        json(res, 503, { error: HXXBOT_CONFIG_HINT });
        return;
      }
      let body: SendEmailInput & { userId?: string; payloadRef?: string; track?: boolean } = {} as SendEmailInput;
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        if (body.track === false) {
          const result = await sendEmail(body);
          json(res, 200, { ok: true, ...result });
        } else {
          const result = await sendEmailNotification(body);
          json(res, 200, { ok: true, ...result });
        }
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/briefs/generate') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      if (hxxbotNotConfigured()) {
        json(res, 503, { error: HXXBOT_CONFIG_HINT });
        return;
      }
      let body: {
        variant?: string;
        lang?: string;
        mode?: 'brief' | 'analysis';
        geoContext?: string;
        modelId?: string;
        force?: boolean;
      } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      try {
        const result = await generateAiBrief(body);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/briefs/latest') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const variant = url.searchParams.get('variant') ?? 'full';
      const lang = url.searchParams.get('lang') ?? 'en';
      const mode = url.searchParams.get('mode') ?? 'brief';
      const brief = await getLatestBrief({
        briefType: 'world',
        scopeKey: `${variant}:${lang}:${mode}`,
      });
      if (!brief) {
        json(res, 404, { error: 'No brief found' });
        return;
      }
      json(res, 200, { brief });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/briefs/email') {
      if (!isDatabaseEnabled() || hxxbotNotConfigured()) {
        json(res, 503, { error: `DATABASE_URL 与 HXXBOT 均需在 .env.local 配置` });
        return;
      }
      let body: {
        to?: string;
        subject?: string;
        variant?: string;
        lang?: string;
        mode?: 'brief' | 'analysis';
        generate?: boolean;
        html?: boolean;
      } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.to?.trim()) {
        json(res, 400, { error: 'to is required' });
        return;
      }
      try {
        let briefBody: string;
        let briefId: string | undefined;
        if (body.generate !== false) {
          const generated = await generateAiBrief({
            variant: body.variant,
            lang: body.lang,
            mode: body.mode,
          });
          briefBody = generated.brief.body;
          briefId = generated.brief.id;
        } else {
          const variant = body.variant ?? 'full';
          const lang = body.lang ?? 'en';
          const mode = body.mode ?? 'brief';
          const existing = await getLatestBrief({
            briefType: 'world',
            scopeKey: `${variant}:${lang}:${mode}`,
          });
          if (!existing) {
            json(res, 404, { error: 'No brief found; set generate=true or run /briefs/generate first' });
            return;
          }
          briefBody = existing.body;
          briefId = existing.id;
        }
        const subject = body.subject?.trim() || 'World Monitor — AI Brief';
        const sent = await sendBriefEmail({
          to: body.to.trim(),
          subject,
          briefBody,
          html: body.html,
          briefId,
        });
        json(res, 200, { ok: true, briefId, ...sent });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    // --- Phase 1: Users & email subscriptions ---
    if (req.method === 'GET' && path === '/platform/v1/users') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const email = url.searchParams.get('email');
      if (email) {
        const user = await getUserByEmail(email);
        json(res, user ? 200 : 404, user ? { user } : { error: 'User not found' });
        return;
      }
      const users = await listUsers();
      json(res, 200, { users, count: users.length });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/users') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      let body: { email?: string; displayName?: string } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.email?.trim()) {
        json(res, 400, { error: 'email is required' });
        return;
      }
      try {
        const user = await createUser({ email: body.email, displayName: body.displayName });
        json(res, 201, { user });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/subscriptions') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const userId = url.searchParams.get('userId') ?? undefined;
      const enabledOnly = url.searchParams.get('enabled') === 'true';
      const subs = await listSubscriptions({ userId, enabledOnly });
      json(res, 200, { subscriptions: subs, count: subs.length });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/subscriptions') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      let body: {
        userId?: string;
        email?: string;
        name?: string;
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
          const user = await createUser({ email: body.email });
          userId = user.id;
        }
        if (!userId || !body.name?.trim()) {
          json(res, 400, { error: 'name and userId (or email) required' });
          return;
        }
        const user = await getUserById(userId);
        if (!user) {
          json(res, 404, { error: 'User not found' });
          return;
        }
        const subscription = await createSubscription({
          userId,
          name: body.name,
          rulesJson: body.rulesJson,
          enabled: body.enabled,
        });
        json(res, 201, { subscription });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'PATCH' && /^\/platform\/v1\/subscriptions\/[^/]+$/.test(path)) {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const subId = path.split('/').pop()!;
      let body: { name?: string; rulesJson?: SubscriptionRules; enabled?: boolean } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      const subscription = await updateSubscription(subId, body);
      if (!subscription) {
        json(res, 404, { error: 'Subscription not found' });
        return;
      }
      json(res, 200, { subscription });
      return;
    }

    if (req.method === 'DELETE' && /^\/platform\/v1\/subscriptions\/[^/]+$/.test(path)) {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const subId = path.split('/').pop()!;
      const ok = await deleteSubscription(subId);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Subscription not found' });
      return;
    }

    if (req.method === 'POST' && /^\/platform\/v1\/subscriptions\/[^/]+\/match$/.test(path)) {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const subId = path.split('/')[4]!;
      const sub = await getSubscriptionById(subId);
      if (!sub) {
        json(res, 404, { error: 'Subscription not found' });
        return;
      }
      const result = await runSubscriptionMatchPass(sub);
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && /^\/platform\/v1\/subscriptions\/[^/]+\/deliver$/.test(path)) {
      if (!isDatabaseEnabled() || hxxbotNotConfigured()) {
        json(res, 503, { error: `DATABASE_URL 与 HXXBOT 均需在 .env.local 配置` });
        return;
      }
      const subId = path.split('/')[4]!;
      try {
        const result = await deliverSubscription(subId);
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/subscriptions/match-all') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const result = await runMatchPassAll();
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/subscriptions/deliver-all') {
      if (!isDatabaseEnabled() || hxxbotNotConfigured()) {
        json(res, 503, { error: `DATABASE_URL 与 HXXBOT 均需在 .env.local 配置` });
        return;
      }
      try {
        const result = await deliverAllEnabledSubscriptions();
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        json(res, 400, { error: String(err) });
      }
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/news/digest') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const variant = url.searchParams.get('variant') ?? 'full';
      const lang = url.searchParams.get('lang') ?? 'en';
      const digest = await buildDigestFromPg(variant, lang);
      json(res, 200, digest ?? {
        categories: {},
        feedStatuses: {},
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/news') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const items = await listRecentNews({
        variant: url.searchParams.get('variant') ?? undefined,
        lang: url.searchParams.get('lang') ?? undefined,
        category: url.searchParams.get('category') ?? undefined,
        limit: Number(url.searchParams.get('limit') ?? 50),
        hours: Number(url.searchParams.get('hours') ?? 168),
      });
      json(res, 200, { items, count: items.length });
      return;
    }

    if (req.method === 'GET' && path === '/platform/v1/aggregate/by-category') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const grouped = await aggregateByCategory({
        variant: url.searchParams.get('variant') ?? 'full',
        lang: url.searchParams.get('lang') ?? 'en',
        hours: Number(url.searchParams.get('hours') ?? 48),
        perCategory: Number(url.searchParams.get('perCategory') ?? 20),
      });
      json(res, 200, {
        categories: grouped,
        generatedAt: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/ingest/run') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      let body: { variant?: string; lang?: string; all?: boolean } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty body ok */ }

      const result = body.all
        ? await runAllVariantIngest()
        : await runRssIngest(body.variant ?? 'full', body.lang ?? 'en');
      json(res, 200, { ok: true, result });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/cold-tier/run') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      const result = await runColdTierPass();
      json(res, 200, { ok: true, result });
      return;
    }

    // --- Phase 2: AI Research ---
    if (req.method === 'GET' && path === '/platform/v1/research/monitors') {
      const monitors = await listMonitorProfiles();
      json(res, 200, { monitors, count: monitors.length });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/research/monitors') {
      let body: {
        monitorType?: 'competitor' | 'brand' | 'industry';
        name?: string;
        configJson?: Record<string, unknown>;
      } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.name || !body.monitorType) {
        json(res, 400, { error: 'name and monitorType required' });
        return;
      }
      const monitor = await createMonitorProfile({
        monitorType: body.monitorType,
        name: body.name,
        configJson: body.configJson,
      });
      json(res, 201, { monitor });
      return;
    }

    if (req.method === 'GET' && /^\/platform\/v1\/research\/monitors\/[^/]+\/report$/.test(path)) {
      const monitorId = path.split('/')[5]!;
      const report = await buildMonitorReport(monitorId);
      if (!report) {
        json(res, 404, { error: 'Monitor not found or disabled' });
        return;
      }
      json(res, 200, report);
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/research/search') {
      let body: { query?: string; variant?: string; lang?: string; limit?: number } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.query?.trim()) {
        json(res, 400, { error: 'query required' });
        return;
      }
      const hits = await semanticSearchByText({
        query: body.query.trim(),
        variant: body.variant,
        lang: body.lang,
        limit: body.limit,
      });
      json(res, 200, { hits, count: hits.length });
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/research/entities/compare') {
      let body: { entityA?: string; entityB?: string; entityType?: string; days?: number } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (!body.entityA || !body.entityB) {
        json(res, 400, { error: 'entityA and entityB required' });
        return;
      }
      const result = await compareEntities({
        entityA: body.entityA,
        entityB: body.entityB,
        entityType: body.entityType,
        days: body.days,
      });
      json(res, 200, result);
      return;
    }

    if (req.method === 'POST' && path === '/platform/v1/embedding/run') {
      if (!isDatabaseEnabled()) {
        json(res, 503, { error: 'DATABASE_URL not configured' });
        return;
      }
      let body: { batchSize?: number; queue?: boolean } = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw) as typeof body;
      } catch { /* empty */ }
      if (body.queue && isRedisEnabled()) {
        await publishEmbeddingJob({ batchSize: body.batchSize });
        json(res, 202, { ok: true, queued: true });
        return;
      }
      const result = await runEmbeddingBatch({ batchSize: body.batchSize });
      json(res, 200, { ok: true, result });
      return;
    }

    json(res, 404, { error: 'Not found', path });
  } catch (err) {
    log.error('request failed', err, { path, method: req.method });
    json(res, 500, { error: String(err) });
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

async function startServer(): Promise<void> {
  if (isDatabaseEnabled()) {
    if (isAutoMigrateEnabled()) {
      log.info('running database bootstrap (PLATFORM_DB_AUTO_MIGRATE)');
      try {
        const bootstrap = await runPlatformDbBootstrap({ logger: log });
        if (bootstrap.applied.length) {
          log.info('applied migrations', { files: bootstrap.applied });
        }
      } catch (err) {
        log.error('database bootstrap failed — fix DATABASE_URL or run npm run platform:db:migrate', err);
        process.exit(1);
      }
    } else {
      log.info('database auto-migrate disabled (PLATFORM_DB_AUTO_MIGRATE=false)');
    }
  }

  server.listen(PORT, () => {
    log.info(`listening on http://localhost:${PORT}`, {
      logDir: getPlatformLogDir(),
      database: isDatabaseEnabled() ? 'configured' : 'NOT SET',
      autoMigrate: isDatabaseEnabled() ? isAutoMigrateEnabled() : false,
    });
  });
}

void startServer();

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error(
      `port ${PORT} already in use — stop the existing platform:api process or change PLATFORM_API_PORT in .env.local`,
      err,
    );
    process.exit(1);
  }
  log.error('server error', err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  server.close();
  await closePool();
  await closeRedisClient();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
