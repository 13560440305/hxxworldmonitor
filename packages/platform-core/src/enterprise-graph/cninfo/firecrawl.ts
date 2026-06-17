import type { ResolvedEngine } from '../../engines-repository.js';

export interface FirecrawlScrapeResult {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  metadata?: Record<string, unknown>;
}

export async function firecrawlScrapeUrl(
  engine: ResolvedEngine,
  url: string,
  signal?: AbortSignal,
): Promise<FirecrawlScrapeResult> {
  const base = engine.baseUrl.replace(/\/+$/, '');
  const endpoint = `${base}/v1/scrape`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${engine.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: true,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Firecrawl scrape failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }

  const json = (await resp.json()) as { success?: boolean; data?: FirecrawlScrapeResult; error?: string };
  if (!json.success && json.error) {
    throw new Error(`Firecrawl scrape error: ${json.error}`);
  }
  return json.data ?? {};
}
