import type {
  CategoryBucket,
  ListFeedDigestResponse,
  NewsItem as ProtoNewsItem,
  ThreatLevel as ProtoThreatLevel,
} from '../../src/generated/server/worldmonitor/news/v1/service_server';
import type { ThreatLevel } from '../worldmonitor/news/v1/_classifier';
import { aggregateByCategory, type NewsItemRow } from './news-repository';

declare const process: { env: Record<string, string | undefined> };

const LEVEL_TO_PROTO: Record<string, ProtoThreatLevel> = {
  critical: 'THREAT_LEVEL_CRITICAL',
  high: 'THREAT_LEVEL_HIGH',
  medium: 'THREAT_LEVEL_MEDIUM',
  low: 'THREAT_LEVEL_LOW',
  info: 'THREAT_LEVEL_UNSPECIFIED',
};

export function isPgDigestEnabled(): boolean {
  return process.env.PLATFORM_USE_PG_DIGEST === 'true';
}

function rowToProto(row: NewsItemRow): ProtoNewsItem {
  const level = (row.threat_level ?? 'info') as ThreatLevel;
  return {
    source: row.source,
    title: row.title,
    link: row.link,
    publishedAt: row.published_at.getTime(),
    isAlert: row.is_alert,
    threat: {
      level: LEVEL_TO_PROTO[level] ?? 'THREAT_LEVEL_UNSPECIFIED',
      category: row.category ?? '',
      confidence: row.confidence ?? 0,
      source: 'keyword',
    },
    locationName: '',
  };
}

export async function buildDigestFromPg(
  variant: string,
  lang: string,
): Promise<ListFeedDigestResponse | null> {
  const hours = Number(process.env.PLATFORM_DIGEST_HOURS ?? 48);
  const perCategory = Number(process.env.PLATFORM_DIGEST_PER_CATEGORY ?? 20);

  let grouped = await aggregateByCategory({ variant, lang, hours, perCategory });
  let total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);

  // RSS content is often language-agnostic; fall back to variant-wide rows if lang slice is empty
  if (total === 0 && lang) {
    grouped = await aggregateByCategory({ variant, hours, perCategory });
    total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
  }

  if (total === 0) return null;

  const categories: Record<string, CategoryBucket> = {};
  for (const [category, rows] of Object.entries(grouped)) {
    categories[category] = {
      items: rows.map(rowToProto),
    };
  }

  return {
    categories,
    feedStatuses: { postgres: 'ok' },
    generatedAt: new Date().toISOString(),
  };
}
