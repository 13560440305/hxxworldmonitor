import { loadEnvLocal } from '@hxxworldmonitor/shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import { runAllVariantIngest } from '@hxxworldmonitor/platform-core/rss-ingest.js';
import { ensurePlatformDatabaseReady } from '@hxxworldmonitor/platform-core/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '@hxxworldmonitor/shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-ingest');
installProcessLogHandlers(log);

const INTERVAL_MS = Number(process.env.PLATFORM_INGEST_INTERVAL_MS ?? 600_000);
const RUN_ONCE = process.argv.includes('--once');

async function tick(): Promise<void> {
  const started = Date.now();
  log.info('starting full ingest run');
  try {
    const results = await runAllVariantIngest();
    for (const r of results) {
      log.info('ingest variant complete', {
        variant: r.variant,
        lang: r.lang,
        feeds: r.feedsTotal,
        collected: r.itemsCollected,
        upserted: r.itemsUpserted,
        errors: r.errors,
      });
    }
    log.info('ingest run finished', { durationMs: Date.now() - started });
  } catch (err) {
    log.error('ingest run failed', err);
  }
}

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  await ensurePlatformDatabaseReady({ logger: log });

  await tick();

  if (RUN_ONCE) {
    await closePool();
    return;
  }

  setInterval(() => { void tick(); }, INTERVAL_MS);
  log.info('scheduled ingest worker', { intervalMs: INTERVAL_MS });
}

process.on('SIGINT', () => { void closePool().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void closePool().then(() => process.exit(0)); });

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
