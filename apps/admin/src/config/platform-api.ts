/** Self-hosted Platform REST API (scripts/platform-api-server.ts). */

const DISABLED = new Set(['false', '0', 'off', 'no']);

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * In dev, localhost Platform API is reached via Vite proxy at `/platform/*`
 * (same-origin) so CSP does not block cross-port fetch to :8787.
 */
function resolveFetchBase(configured: string): string {
  if (!import.meta.env.DEV) return configured;
  try {
    const { hostname } = new URL(configured);
    if (isLocalhostHost(hostname)) return '';
  } catch {
    /* use configured URL as-is */
  }
  return configured;
}

/** Whether `VITE_PLATFORM_API_URL` is set (ignores dev proxy base rewrite). */
export function isPlatformApiConfigured(): boolean {
  const raw = import.meta.env.VITE_PLATFORM_API_URL?.trim();
  if (!raw || DISABLED.has(raw.toLowerCase())) return false;
  return true;
}

/** Base URL from `VITE_PLATFORM_API_URL`, or null when unset/disabled. */
export function getPlatformApiBaseUrl(): string | null {
  if (!isPlatformApiConfigured()) return null;
  return resolveFetchBase(normalizeBaseUrl(import.meta.env.VITE_PLATFORM_API_URL!.trim()));
}

/** News digest URLs to try in order (Platform API first when configured). */
export function getDigestFetchUrls(variant: string, lang: string): string[] {
  const urls: string[] = [];
  const base = getPlatformApiBaseUrl();
  const q = `variant=${encodeURIComponent(variant)}&lang=${encodeURIComponent(lang)}`;

  if (base !== null) {
    const prefix = base ? `${base}/platform` : '/platform';
    urls.push(`${prefix}/v1/news/digest?${q}`);
  }
  urls.push(`/api/news/v1/list-feed-digest?${q}`);
  return urls;
}

export interface PlatformNewsRow {
  source: string;
  title: string;
  link: string;
  published_at: string;
  category: string | null;
  threat_level: string | null;
  is_alert: boolean;
  confidence: number | null;
}

function platformApiPrefix(): string | null {
  const base = getPlatformApiBaseUrl();
  if (base === null) return null;
  return base ? `${base}/platform` : '/platform';
}

/** Fetch one category from Platform PG (avoids browser rss-proxy / Google News). */
export async function fetchPlatformCategoryNews(
  variant: string,
  lang: string,
  category: string,
  limit = 20,
): Promise<PlatformNewsRow[]> {
  const prefix = platformApiPrefix();
  if (!prefix) return [];

  const langAttempts = lang ? [lang, ''] : [''];
  for (const langParam of langAttempts) {
    const params = new URLSearchParams({
      variant,
      category,
      limit: String(limit),
      hours: '168',
    });
    if (langParam) params.set('lang', langParam);

    try {
      const resp = await fetch(`${prefix}/v1/news?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as { items?: PlatformNewsRow[] };
      const items = data.items ?? [];
      if (items.length > 0) return items;
    } catch {
      /* try next lang attempt */
    }
  }
  return [];
}
