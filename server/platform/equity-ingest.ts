import type { ServerFeed } from '../worldmonitor/news/v1/_feeds';
import { fetchAndParseRss } from '../worldmonitor/news/v1/list-feed-digest';
import { getDefaultWorkspaceId, query } from '../_shared/db';
import { runVariantCategoryIngest } from './rss-ingest.js';

declare const process: { env: Record<string, string | undefined> };

const gn = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

const DEFAULT_STOCK_CATEGORIES = [
  'markets',
  'forex',
  'commodities',
  'crypto',
  'economic',
  'analysis',
];

const EARNINGS_FEEDS: ServerFeed[] = [
  {
    name: 'Earnings Reports',
    url: gn(
      '("earnings report" OR "quarterly earnings" OR "revenue beat" OR "earnings miss" OR "EPS") when:2d',
    ),
  },
  { name: 'SEC Press', url: 'https://www.sec.gov/news/pressreleases.rss' },
  {
    name: '10-K / 10-Q',
    url: gn('("10-K" OR "10-Q" OR "annual report" OR "quarterly report") SEC when:7d'),
  },
];

export interface StockNewsIngestResult {
  variant: string;
  lang: string;
  categories: string[];
  feedsTotal: number;
  itemsCollected: number;
  itemsUpserted: number;
  errors: number;
}

export interface EarningsIngestResult {
  feedsTotal: number;
  itemsSeen: number;
  filingsUpserted: number;
  errors: number;
}

export interface KnowledgeGraphBuildResult {
  entitiesUpserted: number;
  edgesUpserted: number;
  sourceFilings: number;
  sourceNews: number;
}

function parseCsvEnv(key: string, fallback: string): string[] {
  return (process.env[key] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extract ticker from headlines like "Apple (AAPL) beats estimates". */
export function extractTickerSymbol(title: string): string | null {
  const paren = title.match(/\(([A-Z]{1,5})\)/);
  if (paren?.[1]) return paren[1];
  const prefix = title.match(/^([A-Z]{1,5})\s*[-:]/);
  if (prefix?.[1] && prefix[1].length >= 2) return prefix[1];
  return null;
}

export async function runStockNewsIngest(opts?: {
  markets?: string[];
  lang?: string;
  categories?: string[];
}): Promise<StockNewsIngestResult> {
  const lang = opts?.lang ?? 'en';
  const categories = opts?.categories?.length
    ? opts.categories
    : parseCsvEnv('PLATFORM_STOCK_NEWS_CATEGORIES', DEFAULT_STOCK_CATEGORIES.join(','));

  const result = await runVariantCategoryIngest('finance', lang, categories);
  return {
    variant: result.variant,
    lang: result.lang,
    categories,
    feedsTotal: result.feedsTotal,
    itemsCollected: result.itemsCollected,
    itemsUpserted: result.itemsUpserted,
    errors: result.errors,
  };
}

export async function runEarningsIngest(opts?: { lang?: string }): Promise<EarningsIngestResult> {
  const workspaceId = getDefaultWorkspaceId();
  const lang = opts?.lang ?? 'en';
  const variant = 'finance';
  const deadline = AbortSignal.timeout(Number(process.env.PLATFORM_EARNINGS_DEADLINE_MS ?? 20_000));

  let itemsSeen = 0;
  let filingsUpserted = 0;
  let errors = 0;

  for (const feed of EARNINGS_FEEDS) {
    try {
      const items = await fetchAndParseRss(feed, variant, deadline);
      for (const item of items) {
        itemsSeen += 1;
        const symbol = extractTickerSymbol(item.title) ?? 'UNKNOWN';
        const res = await query(
          `INSERT INTO company_filings (
            workspace_id, symbol, company_name, filing_type, source_url,
            published_at, metadata_json
          ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7)
          ON CONFLICT (workspace_id, symbol, filing_type, period_end, source_url) DO NOTHING`,
          [
            workspaceId,
            symbol,
            item.source || null,
            'earnings_news',
            item.link,
            item.publishedAt,
            JSON.stringify({
              title: item.title,
              feedName: feed.name,
              lang,
            }),
          ],
        );
        if (res.rowCount && res.rowCount > 0) filingsUpserted += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return {
    feedsTotal: EARNINGS_FEEDS.length,
    itemsSeen,
    filingsUpserted,
    errors,
  };
}

/** Build a minimal company ↔ news relation graph from recent filings + finance headlines. */
export async function runKnowledgeGraphBuild(opts?: {
  lookbackHours?: number;
  since?: Date;
}): Promise<KnowledgeGraphBuildResult> {
  const workspaceId = getDefaultWorkspaceId();
  const hours = opts?.lookbackHours ?? Number(process.env.PLATFORM_KG_LOOKBACK_HOURS ?? 168);
  const since = opts?.since ?? new Date(Date.now() - hours * 3600_000);

  const filings = await query<{
    id: string;
    symbol: string;
    company_name: string | null;
    source_url: string | null;
  }>(
    `SELECT id, symbol, company_name, source_url
     FROM company_filings
     WHERE workspace_id = $1 AND ingested_at >= $2
     ORDER BY ingested_at DESC
     LIMIT 500`,
    [workspaceId, since],
  );

  const news = await query<{ id: string; title: string; link: string }>(
    `SELECT id, title, link
     FROM news_items
     WHERE workspace_id = $1 AND variant = 'finance'
       AND ingested_at >= $2
     ORDER BY ingested_at DESC
     LIMIT 1000`,
    [workspaceId, since],
  );

  let entitiesUpserted = 0;
  let edgesUpserted = 0;

  for (const filing of filings.rows) {
    const symbol = filing.symbol;
    if (!symbol || symbol === 'UNKNOWN') continue;

    const entityRes = await query<{ id: string }>(
      `INSERT INTO kg_entities (workspace_id, entity_type, external_key, name, props_json)
       VALUES ($1, 'company', $2, $3, $4)
       ON CONFLICT (workspace_id, entity_type, external_key) DO UPDATE SET
         name = EXCLUDED.name,
         props_json = EXCLUDED.props_json,
         updated_at = NOW()
       RETURNING id`,
      [
        workspaceId,
        symbol,
        filing.company_name ?? symbol,
        JSON.stringify({ symbol, source: 'company_filings' }),
      ],
    );
    const companyId = entityRes.rows[0]?.id;
    if (!companyId) continue;
    entitiesUpserted += 1;

    for (const item of news.rows) {
      if (!item.title.toUpperCase().includes(symbol)) continue;

      const newsEntity = await query<{ id: string }>(
        `INSERT INTO kg_entities (workspace_id, entity_type, external_key, name, props_json)
         VALUES ($1, 'news_item', $2, $3, $4)
         ON CONFLICT (workspace_id, entity_type, external_key) DO UPDATE SET
           name = EXCLUDED.name,
           props_json = EXCLUDED.props_json,
           updated_at = NOW()
         RETURNING id`,
        [
          workspaceId,
          item.id,
          item.title.slice(0, 200),
          JSON.stringify({ link: item.link, source: 'news_items' }),
        ],
      );
      const newsId = newsEntity.rows[0]?.id;
      if (!newsId) continue;
      entitiesUpserted += 1;

      const edgeRes = await query(
        `INSERT INTO kg_edges (workspace_id, from_entity_id, to_entity_id, relation_type, props_json)
         VALUES ($1, $2, $3, 'mentioned_in', '{}')
         ON CONFLICT (workspace_id, from_entity_id, to_entity_id, relation_type) DO NOTHING`,
        [workspaceId, companyId, newsId],
      );
      if (edgeRes.rowCount && edgeRes.rowCount > 0) edgesUpserted += 1;
    }
  }

  return {
    entitiesUpserted,
    edgesUpserted,
    sourceFilings: filings.rows.length,
    sourceNews: news.rows.length,
  };
}
