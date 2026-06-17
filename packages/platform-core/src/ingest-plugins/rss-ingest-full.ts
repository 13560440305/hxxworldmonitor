import {
  runAllVariantIngest,
  runRssIngest,
} from '../rss-ingest.js';
import type { IngestPlugin } from './types.js';

export const rssIngestFullPlugin: IngestPlugin = {
  key: 'rss-ingest-full',
  displayName: 'RSS 全量采集',
  tier: 'batch',
  async run(ctx) {
    if (ctx.payload.all === true) {
      const results = await runAllVariantIngest();
      return { status: 'ok', results };
    }
    const result = await runRssIngest(
      String(ctx.payload.variant ?? 'full'),
      String(ctx.payload.lang ?? 'en'),
    );
    return { status: 'ok', ...result };
  },
};
