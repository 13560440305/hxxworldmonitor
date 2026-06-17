import {
  runFastVariantIngest,
  runRssIngestFast,
} from '../rss-ingest.js';
import type { IngestPlugin } from './types.js';

export const rssIngestFastPlugin: IngestPlugin = {
  key: 'rss-ingest-fast',
  displayName: 'RSS 快采集',
  tier: 'batch',
  async run(ctx) {
    if (ctx.payload.all === true) {
      const results = await runFastVariantIngest();
      return { status: 'ok', results };
    }
    const result = await runRssIngestFast(
      String(ctx.payload.variant ?? 'full'),
      String(ctx.payload.lang ?? 'en'),
    );
    return { status: 'ok', ...result };
  },
};
