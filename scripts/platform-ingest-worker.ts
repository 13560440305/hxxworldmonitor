import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { runAllVariantIngest } from '../server/platform/rss-ingest.js';

declare const process: { env: Record<string, string | undefined> };

const INTERVAL_MS = Number(process.env.PLATFORM_INGEST_INTERVAL_MS ?? 600_000);
const RUN_ONCE = process.argv.includes('--once');

async function tick(): Promise<void> {
  const started = Date.now();
  console.log('[platform-ingest] starting ingest run...');
  try {
    const results = await runAllVariantIngest();
    for (const r of results) {
      console.log(
        `[platform-ingest] ${r.variant}/${r.lang}: feeds=${r.feedsTotal} collected=${r.itemsCollected} upserted=${r.itemsUpserted} errors=${r.errors}`,
      );
    }
    console.log(`[platform-ingest] done in ${Date.now() - started}ms`);
  } catch (err) {
    console.error('[platform-ingest] failed:', err);
  }
}

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    console.error('[platform-ingest] DATABASE_URL is required');
    process.exit(1);
  }

  await tick();

  if (RUN_ONCE) {
    await closePool();
    return;
  }

  setInterval(() => { void tick(); }, INTERVAL_MS);
  console.log(`[platform-ingest] scheduled every ${INTERVAL_MS}ms`);
}

process.on('SIGINT', () => { void closePool().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void closePool().then(() => process.exit(0)); });

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
