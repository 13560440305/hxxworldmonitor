import { loadEnvLocal } from '@hxxworldmonitor/shared/load-env.js';

loadEnvLocal();

import {
  closeRedisClient,
  isRedisEnabled,
  publishEmbeddingJob,
  readEmbeddingJobs,
} from '@hxxworldmonitor/shared/redis-client.js';
import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import { runEmbeddingBatch } from '@hxxworldmonitor/platform-core/research-service.js';
import { ensurePlatformDatabaseReady } from '@hxxworldmonitor/platform-core/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '@hxxworldmonitor/shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-embed');
installProcessLogHandlers(log);

const INTERVAL_MS = Number(process.env.PLATFORM_EMBED_INTERVAL_MS ?? 300_000);
const CONSUMER = `embed-${process.pid}`;

async function runOnce(): Promise<void> {
  const result = await runEmbeddingBatch();
  log.info('embedding batch complete', {
    embedded: result.embedded,
    hasMore: result.remaining > 0,
    remaining: result.remaining,
  });
}

async function loop(): Promise<void> {
  log.info('worker started', {
    redis: isRedisEnabled(),
    intervalMs: INTERVAL_MS,
  });

  while (true) {
    if (isRedisEnabled()) {
      const jobs = await readEmbeddingJobs(CONSUMER, 1);
      if (jobs.length > 0) {
        await runOnce();
        continue;
      }
    }
    await runOnce();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }
  await ensurePlatformDatabaseReady({ logger: log });
  try {
    if (once) {
      await runOnce();
      if (isRedisEnabled()) {
        await publishEmbeddingJob({});
      }
    } else {
      await loop();
    }
  } finally {
    await closeRedisClient();
  }
}

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
