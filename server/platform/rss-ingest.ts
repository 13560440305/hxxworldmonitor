import { VARIANT_FEEDS, INTEL_SOURCES, type ServerFeed } from '../worldmonitor/news/v1/_feeds';
import { fetchAndParseRss, type ParsedItem } from '../worldmonitor/news/v1/list-feed-digest';
import { getDefaultWorkspaceId } from '../_shared/db';
import { type IngestNewsInput, recordIngestRun, upsertNewsItems } from './news-repository';

declare const process: { env: Record<string, string | undefined> };

const BATCH_CONCURRENCY = 20;
const OVERALL_DEADLINE_MS = 25_000;

export interface IngestResult {
  variant: string;
  lang: string;
  feedsTotal: number;
  itemsCollected: number;
  itemsUpserted: number;
  errors: number;
}

function collectFeedEntries(variant: string, lang: string): Array<{ feedCategory: string; feed: ServerFeed }> {
  const feedsByCategory = VARIANT_FEEDS[variant] ?? {};
  const entries: Array<{ feedCategory: string; feed: ServerFeed }> = [];

  for (const [feedCategory, feeds] of Object.entries(feedsByCategory)) {
    for (const feed of feeds.filter((f) => !f.lang || f.lang === lang)) {
      entries.push({ feedCategory, feed });
    }
  }

  if (variant === 'full') {
    for (const feed of INTEL_SOURCES.filter((f) => !f.lang || f.lang === lang)) {
      entries.push({ feedCategory: 'intel', feed });
    }
  }

  return entries;
}

export async function runRssIngest(variant = 'full', lang = 'en'): Promise<IngestResult> {
  const workspaceId = getDefaultWorkspaceId();
  const entries = collectFeedEntries(variant, lang);
  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), OVERALL_DEADLINE_MS);

  const collected: IngestNewsInput[] = [];
  let errors = 0;

  try {
    for (let i = 0; i < entries.length; i += BATCH_CONCURRENCY) {
      if (deadlineController.signal.aborted) break;

      const batch = entries.slice(i, i + BATCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async ({ feedCategory, feed }) => {
          const items = await fetchAndParseRss(feed, variant, deadlineController.signal);
          return items.map((item) => parsedToIngest(item, feed, feedCategory, variant, lang));
        }),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          collected.push(...result.value);
        } else {
          errors += 1;
        }
      }
    }
  } finally {
    clearTimeout(deadlineTimeout);
  }

  const itemsUpserted = await upsertNewsItems(workspaceId, collected);
  await recordIngestRun(workspaceId, variant, lang, {
    feedsTotal: entries.length,
    itemsUpserted,
    errors,
  });

  return {
    variant,
    lang,
    feedsTotal: entries.length,
    itemsCollected: collected.length,
    itemsUpserted,
    errors,
  };
}

function parsedToIngest(
  item: ParsedItem,
  feed: ServerFeed,
  feedCategory: string,
  variant: string,
  lang: string,
): IngestNewsInput {
  return {
    source: item.source,
    title: item.title,
    link: item.link,
    publishedAt: item.publishedAt,
    variant,
    lang,
    category: feedCategory,
    feedCategory,
    threatLevel: item.level,
    isAlert: item.isAlert,
    confidence: item.confidence,
    feedUrl: feed.url,
    feedName: feed.name,
  };
}

export async function runAllVariantIngest(): Promise<IngestResult[]> {
  const variants = (process.env.PLATFORM_INGEST_VARIANTS ?? 'full,tech,finance')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const langs = (process.env.PLATFORM_INGEST_LANGS ?? 'en,zh')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const results: IngestResult[] = [];
  for (const variant of variants) {
    for (const lang of langs) {
      results.push(await runRssIngest(variant, lang));
    }
  }
  return results;
}
