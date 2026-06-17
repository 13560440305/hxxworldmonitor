import { runColdTierPass } from '../cold-tier-worker.js';
import type { IngestPlugin } from './types.js';

export const coldTierArchivePlugin: IngestPlugin = {
  key: 'cold-tier-archive',
  displayName: '冷存储归档',
  tier: 'batch',
  async run() {
    const result = await runColdTierPass();
    return { status: 'ok', ...result };
  },
};
