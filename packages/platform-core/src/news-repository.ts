import { createHash } from 'node:crypto';
import type pg from 'pg';
import { getDefaultWorkspaceId, query, withTransaction } from '@hxxworldmonitor/shared/db';

export interface NewsItemRow {
  id: string;
  source: string;
  title: string;
  link: string;
  published_at: Date;
  variant: string;
  lang: string;
  category: string | null;
  threat_level: string | null;
  is_alert: boolean;
  confidence: number | null;
}

export interface IngestNewsInput {
  source: string;
  title: string;
  link: string;
  publishedAt: number;
  variant: string;
  lang: string;
  category: string;
  feedCategory: string;
  threatLevel: string;
  isAlert: boolean;
  confidence: number;
  feedUrl: string;
  feedName: string;
}

export function linkHash(link: string): string {
  return createHash('sha256').update(link.trim()).digest('hex');
}

export async function upsertFeed(
  client: pg.PoolClient,
  workspaceId: string,
  feed: { name: string; url: string; category: string; variant: string; lang: string },
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO feeds (workspace_id, name, url, category, variant, lang)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, url) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       variant = EXCLUDED.variant,
       lang = EXCLUDED.lang
     RETURNING id`,
    [workspaceId, feed.name, feed.url, feed.category, feed.variant, feed.lang],
  );
  return res.rows[0]!.id;
}

export async function upsertNewsItems(
  workspaceId: string,
  items: IngestNewsInput[],
): Promise<number> {
  if (items.length === 0) return 0;

  let upserted = 0;
  await withTransaction(async (client) => {
    for (const item of items) {
      const feedId = await upsertFeed(client, workspaceId, {
        name: item.feedName,
        url: item.feedUrl,
        category: item.feedCategory,
        variant: item.variant,
        lang: item.lang,
      });

      const hash = linkHash(item.link);
      const res = await client.query(
        `INSERT INTO news_items (
          workspace_id, feed_id, source, title, link, link_hash,
          published_at, variant, lang, category, threat_level, is_alert, confidence
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (workspace_id, link_hash) DO UPDATE SET
          feed_id = EXCLUDED.feed_id,
          variant = EXCLUDED.variant,
          lang = EXCLUDED.lang,
          title = EXCLUDED.title,
          category = EXCLUDED.category,
          threat_level = EXCLUDED.threat_level,
          is_alert = EXCLUDED.is_alert,
          confidence = EXCLUDED.confidence,
          ingested_at = NOW()
        RETURNING id`,
        [
          workspaceId,
          feedId,
          item.source,
          item.title,
          item.link,
          hash,
          new Date(item.publishedAt),
          item.variant,
          item.lang,
          item.category,
          item.threatLevel,
          item.isAlert,
          item.confidence,
        ],
      );
      if (res.rowCount) upserted += 1;
    }
  });

  return upserted;
}

export async function listRecentNews(opts: {
  workspaceId?: string;
  variant?: string;
  lang?: string;
  langs?: string[];
  category?: string;
  limit?: number;
  hours?: number;
}): Promise<NewsItemRow[]> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const limit = Math.min(opts.limit ?? 50, 200);
  const hours = opts.hours ?? 168;
  const params: unknown[] = [workspaceId, hours];
  let sql = `
    SELECT id, source, title, link, published_at, variant, lang,
           category, threat_level, is_alert, confidence
    FROM news_items
    WHERE workspace_id = $1
      AND published_at >= NOW() - make_interval(hours => $2)
  `;

  if (opts.variant) {
    params.push(opts.variant);
    sql += ` AND variant = $${params.length}`;
  }
  const langFilter = opts.langs?.length
    ? [...new Set(opts.langs.map((l) => l.trim()).filter(Boolean))]
    : (opts.lang?.trim() ? [opts.lang.trim()] : []);
  if (langFilter.length === 1) {
    params.push(langFilter[0]);
    sql += ` AND lang = $${params.length}`;
  } else if (langFilter.length > 1) {
    params.push(langFilter);
    sql += ` AND lang = ANY($${params.length}::text[])`;
  }
  if (opts.category) {
    params.push(opts.category);
    sql += ` AND category = $${params.length}`;
  }

  params.push(limit);
  sql += ` ORDER BY published_at DESC LIMIT $${params.length}`;

  const res = await query<NewsItemRow>(sql, params);
  return res.rows;
}

export async function aggregateByCategory(opts: {
  workspaceId?: string;
  variant?: string;
  lang?: string;
  hours?: number;
  perCategory?: number;
}): Promise<Record<string, NewsItemRow[]>> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const hours = opts.hours ?? 48;
  const perCategory = opts.perCategory ?? 20;

  const res = await query<NewsItemRow & { rn: string }>(
    `SELECT * FROM (
       SELECT id, source, title, link, published_at, variant, lang,
              category, threat_level, is_alert, confidence,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(category, 'uncategorized') ORDER BY published_at DESC) AS rn
       FROM news_items
       WHERE workspace_id = $1
         AND published_at >= NOW() - make_interval(hours => $4)
         AND ($2::text IS NULL OR variant = $2)
         AND ($3::text IS NULL OR lang = $3)
     ) sub
     WHERE rn <= $5
     ORDER BY category, published_at DESC`,
    [workspaceId, opts.variant ?? null, opts.lang ?? null, hours, perCategory],
  );

  const out: Record<string, NewsItemRow[]> = {};
  for (const row of res.rows) {
    const cat = row.category ?? 'uncategorized';
    if (!out[cat]) out[cat] = [];
    const { rn: _rn, ...item } = row as NewsItemRow & { rn: string };
    out[cat].push(item);
  }
  return out;
}

export async function recordIngestRun(
  workspaceId: string,
  variant: string,
  lang: string,
  stats: { feedsTotal: number; itemsUpserted: number; errors: number },
): Promise<void> {
  await query(
    `INSERT INTO ingest_runs (workspace_id, variant, lang, feeds_total, items_upserted, errors, status, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW())`,
    [workspaceId, variant, lang, stats.feedsTotal, stats.itemsUpserted, stats.errors],
  );
}

export async function countNewsItems(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM news_items WHERE workspace_id = $1',
    [ws],
  );
  return Number(res.rows[0]?.count ?? 0);
}
