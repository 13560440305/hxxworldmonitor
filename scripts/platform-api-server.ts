import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { checkDatabaseHealth, closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { checkOssHealth, isOssEnabled } from '../server/_shared/blob-store.js';
import { aggregateByCategory, countNewsItems, listRecentNews } from '../server/platform/news-repository.js';
import { buildDigestFromPg } from '../server/platform/digest-from-pg.js';
import { runAllVariantIngest, runRssIngest } from '../server/platform/rss-ingest.js';
import { runColdTierPass } from '../server/platform/cold-tier-worker.js';

declare const process: { env: Record<string, string | undefined> };

const PORT = Number(process.env.PLATFORM_API_PORT ?? 8787);

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/$/, '') || '/';
  console.log(`[platform-api] ${req.method} ${path}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && path === '/platform/v1/health') {
      const [db, oss] = await Promise.all([checkDatabaseHealth(), checkOssHealth()]);
      const newsCount = isDatabaseEnabled() ? await countNewsItems().catch(() => 0) : 0;
      json(res, 200, {
        status: db.ok ? 'ok' : 'degraded',
        database: db,
        oss: { enabled: isOssEnabled(), ...oss },
        newsItems: newsCount,
        timestamp: new Date().toISOString(),
      });
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

    json(res, 404, { error: 'Not found', path });
  } catch (err) {
    console.error('[platform-api]', err);
    json(res, 500, { error: String(err) });
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(PORT, () => {
  console.log(`[platform-api] listening on http://localhost:${PORT}`);
  console.log(`[platform-api] DATABASE_URL=${isDatabaseEnabled() ? 'set' : 'NOT SET'}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
