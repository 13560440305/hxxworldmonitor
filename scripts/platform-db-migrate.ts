/** Optional CLI — migrations also run automatically on platform:api / worker startup. */
import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';
import { runPlatformDbBootstrap } from '../server/platform/platform-db-bootstrap.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-db-migrate');
installProcessLogHandlers(log);

runPlatformDbBootstrap({ logger: log })
  .then((result) => {
    log.info('done', result);
  })
  .catch((err) => {
    log.error('failed', err);
    process.exit(1);
  });
