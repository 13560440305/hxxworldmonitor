import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { refreshHxxbotConfigCache } from '../server/_shared/hxxbot-config.js';
import { ensurePlatformDatabaseReady } from '../server/platform/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';
import { runExecutorOnce } from '../server/platform/jobs/job-runner.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-executor');
installProcessLogHandlers(log);

const POLL_MS = Number(process.env.PLATFORM_EXECUTOR_POLL_MS ?? 5_000);
const RUN_ONCE = process.argv.includes('--once');
const WORKER_ID = `executor-${process.pid}`;

async function loopOnce(): Promise<boolean> {
  return runExecutorOnce(WORKER_ID, log);
}

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  await ensurePlatformDatabaseReady({ logger: log });
  try {
    await refreshHxxbotConfigCache();
  } catch (err) {
    log.warn('HXXBOT config load failed', err);
  }

  if (RUN_ONCE) {
    const ran = await loopOnce();
    log.info('executor once complete', { ran });
    await closePool();
    return;
  }

  log.info('executor worker started', { workerId: WORKER_ID, pollMs: POLL_MS });
  while (true) {
    try {
      const ran = await loopOnce();
      if (!ran) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      log.error('executor loop error', err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

process.on('SIGINT', () => { void closePool().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void closePool().then(() => process.exit(0)); });

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
