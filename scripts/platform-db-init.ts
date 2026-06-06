import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';
import { runPlatformDbBootstrap } from '../server/platform/platform-db-bootstrap.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-db-init');
installProcessLogHandlers(log);

/** First-time / full schema bootstrap (same as migrate; kept for npm script compatibility). */
runPlatformDbBootstrap({ logger: log })
  .then((result) => {
    log.info('done', result);
  })
  .catch((err) => {
    log.error('failed', err);
    process.exit(1);
  });
