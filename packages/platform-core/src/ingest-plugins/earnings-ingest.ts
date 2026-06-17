import { runEarningsIngest } from '../equity-ingest.js';
import type { IngestPlugin } from './types.js';

export const earningsIngestPlugin: IngestPlugin = {
  key: 'earnings-ingest',
  displayName: '财报/披露 RSS 采集',
  tier: 'batch',
  async run(ctx) {
    const lang = String(ctx.payload.lang ?? 'en');
    const result = await runEarningsIngest({ lang });
    return { status: 'ok', ...result };
  },
};
