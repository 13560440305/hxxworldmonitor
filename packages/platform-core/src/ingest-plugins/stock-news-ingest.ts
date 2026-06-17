import { runStockNewsIngest } from '../equity-ingest.js';
import type { IngestPlugin } from './types.js';

export const stockNewsIngestPlugin: IngestPlugin = {
  key: 'stock-news-ingest',
  displayName: '股票新闻采集',
  tier: 'batch',
  async run(ctx) {
    const lang = String(ctx.payload.lang ?? 'en');
    const categories = Array.isArray(ctx.payload.categories)
      ? ctx.payload.categories.map(String)
      : undefined;
    const result = await runStockNewsIngest({ lang, categories });
    return { status: 'ok', ...result };
  },
};
