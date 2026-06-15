import { VARIANT_FEEDS, INTEL_SOURCES, type ServerFeed } from '../../../server/worldmonitor/news/v1/_feeds';
import { fetchAndParseRss, type ParsedItem } from '../../../server/worldmonitor/news/v1/list-feed-digest';
import { getDefaultWorkspaceId } from '@hxxworldmonitor/shared/db';
import { type IngestNewsInput, recordIngestRun, upsertNewsItems } from './news-repository';

declare const process: { env: Record<string, string | undefined> };

const FULL_BATCH_CONCURRENCY = 20;
const FULL_OVERALL_DEADLINE_MS = 25_000;

const FAST_BATCH_CONCURRENCY = 12;
const FAST_OVERALL_DEADLINE_MS = 15_000;
const DEFAULT_FAST_CATEGORIES = ['politics', 'us', 'gov', 'tech', 'ai', 'finance', 'intel'];

export type IngestTier = 'full' | 'fast';

export interface IngestResult {
  variant: string;
  lang: string;
  tier: IngestTier;
  feedsTotal: number;
  itemsCollected: number;
  itemsUpserted: number;
  errors: number;
}

function parseCsvEnv(key: string, fallback: string): string[] {
  return (process.env[key] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectFeedEntries(
  variant: string,
  lang: string,
  opts?: { categories?: string[]; maxFeedsPerCategory?: number },
): Array<{ feedCategory: string; feed: ServerFeed }> {
  const feedsByCategory = VARIANT_FEEDS[variant] ?? {};
  const entries: Array<{ feedCategory: string; feed: ServerFeed }> = [];
  const allowed = opts?.categories ? new Set(opts.categories) : null;

  for (const [feedCategory, feeds] of Object.entries(feedsByCategory)) {
    if (allowed && !allowed.has(feedCategory)) continue;
    for (const feed of feeds.filter((f) => !f.lang || f.lang === lang)) {
      entries.push({ feedCategory, feed });
    }
  }

  if (variant === 'full' && (!allowed || allowed.has('intel'))) {
    for (const feed of INTEL_SOURCES.filter((f) => !f.lang || f.lang === lang)) {
      entries.push({ feedCategory: 'intel', feed });
    }
  }

  if (!opts?.maxFeedsPerCategory) return entries;

  const perCategory = new Map<string, number>();
  return entries.filter(({ feedCategory }) => {
    const count = perCategory.get(feedCategory) ?? 0;
    if (count >= opts.maxFeedsPerCategory!) return false;
    perCategory.set(feedCategory, count + 1);
    return true;
  });
}

async function runRssIngestTier(
  variant = 'full',
  lang = 'en',
  tier: IngestTier = 'full',
): Promise<IngestResult> {
  const workspaceId = getDefaultWorkspaceId();
  const isFast = tier === 'fast';
  const categories = isFast
    ? parseCsvEnv('PLATFORM_INGEST_FAST_CATEGORIES', DEFAULT_FAST_CATEGORIES.join(','))
    : undefined;
  const maxFeedsPerCategory = isFast
    ? Number(process.env.PLATFORM_INGEST_FAST_MAX_FEEDS_PER_CATEGORY ?? 4)
    : undefined;
  const entries = collectFeedEntries(variant, lang, {
    categories,
    maxFeedsPerCategory: Number.isFinite(maxFeedsPerCategory) ? maxFeedsPerCategory : undefined,
  });
  const batchConcurrency = isFast ? FAST_BATCH_CONCURRENCY : FULL_BATCH_CONCURRENCY;
  const deadlineMs = isFast ? FAST_OVERALL_DEADLINE_MS : FULL_OVERALL_DEADLINE_MS;

  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), deadlineMs);

  const collected: IngestNewsInput[] = [];
  let errors = 0;

  try {
    for (let i = 0; i < entries.length; i += batchConcurrency) {
      if (deadlineController.signal.aborted) break;

      const batch = entries.slice(i, i + batchConcurrency);
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
    tier,
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

export async function runRssIngest(variant = 'full', lang = 'en'): Promise<IngestResult> {
  return runRssIngestTier(variant, lang, 'full');
}

export async function runRssIngestFast(variant = 'full', lang = 'en'): Promise<IngestResult> {
  return runRssIngestTier(variant, lang, 'fast');
}

/** Ingest selected categories for any variant (used by stock-news job). */
export async function runVariantCategoryIngest(
  variant: string,
  lang: string,
  categories: string[],
): Promise<IngestResult> {
  const workspaceId = getDefaultWorkspaceId();
  const entries = collectFeedEntries(variant, lang, { categories });
  const batchConcurrency = FULL_BATCH_CONCURRENCY;
  const deadlineMs = FULL_OVERALL_DEADLINE_MS;
  const deadlineController = new AbortController();
  const deadlineTimeout = setTimeout(() => deadlineController.abort(), deadlineMs);

  const collected: IngestNewsInput[] = [];
  let errors = 0;

  try {
    for (let i = 0; i < entries.length; i += batchConcurrency) {
      if (deadlineController.signal.aborted) break;
      const batch = entries.slice(i, i + batchConcurrency);
      const settled = await Promise.allSettled(
        batch.map(async ({ feedCategory, feed }) => {
          const items = await fetchAndParseRss(feed, variant, deadlineController.signal);
          return items.map((item) => parsedToIngest(item, feed, feedCategory, variant, lang));
        }),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') collected.push(...result.value);
        else errors += 1;
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
    tier: 'full',
    feedsTotal: entries.length,
    itemsCollected: collected.length,
    itemsUpserted,
    errors,
  };
}

async function runVariantIngestForTier(tier: IngestTier): Promise<IngestResult[]> {
  const variantsKey = tier === 'fast' ? 'PLATFORM_INGEST_FAST_VARIANTS' : 'PLATFORM_INGEST_VARIANTS';
  const langsKey = tier === 'fast' ? 'PLATFORM_INGEST_FAST_LANGS' : 'PLATFORM_INGEST_LANGS';
  const defaultVariants = tier === 'fast' ? 'full' : 'full,tech,finance';
  const variants = parseCsvEnv(variantsKey, defaultVariants);
  const langs = parseCsvEnv(langsKey, 'en,zh');

  const results: IngestResult[] = [];
  for (const variant of variants) {
    for (const lang of langs) {
      results.push(await runRssIngestTier(variant, lang, tier));
    }
  }
  return results;
}

export async function runAllVariantIngest(): Promise<IngestResult[]> {
  return runVariantIngestForTier('full');
}

export async function runFastVariantIngest(): Promise<IngestResult[]> {
  return runVariantIngestForTier('fast');
}
