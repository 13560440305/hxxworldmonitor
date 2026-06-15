import { loadEnvLocal } from '@hxxworldmonitor/shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import { ensurePlatformDatabaseReady } from '@hxxworldmonitor/platform-core/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '@hxxworldmonitor/shared/platform-logger.js';
import { runSchedulerTick, seedJobDefinitions } from '@hxxworldmonitor/platform-core/jobs/job-seed.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-scheduler');
installProcessLogHandlers(log);

const POLL_MS = Number(process.env.PLATFORM_SCHEDULER_POLL_MS ?? 30_000);
const RUN_ONCE = process.argv.includes('--once');

async function tick(): Promise<void> {
  const enqueued = await runSchedulerTick(log);
  if (enqueued > 0) {
    log.info('scheduler tick complete', { enqueued });
  }
}

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  await ensurePlatformDatabaseReady({ logger: log });
  await seedJobDefinitions(log);

  await tick();

  if (RUN_ONCE) {
    await closePool();
    return;
  }

  log.info('scheduler worker started', { pollMs: POLL_MS });
  setInterval(() => { void tick().catch((err) => log.error('scheduler tick failed', err)); }, POLL_MS);
}

process.on('SIGINT', () => { void closePool().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void closePool().then(() => process.exit(0)); });

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
