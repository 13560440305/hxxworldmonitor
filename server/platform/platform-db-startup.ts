import type { PlatformLogger } from '../_shared/platform-logger.js';
import { isDatabaseEnabled } from '../_shared/db.js';
import {
  isAutoMigrateEnabled,
  runPlatformDbBootstrap,
  type BootstrapResult,
} from './platform-db-bootstrap.js';

declare const process: { exit(code?: number): never };

/**
 * On platform:api / worker startup: detect pending SQL migrations and apply them.
 * Controlled by PLATFORM_DB_AUTO_MIGRATE (default true when unset).
 */
export async function ensurePlatformDatabaseReady(opts: {
  logger: PlatformLogger;
  /** Exit process when bootstrap fails (default true). */
  exitOnFailure?: boolean;
}): Promise<BootstrapResult | null> {
  if (!isDatabaseEnabled()) {
    return null;
  }

  if (!isAutoMigrateEnabled()) {
    opts.logger.info(
      'database auto-migrate is off (PLATFORM_DB_AUTO_MIGRATE=false); schema will not be updated on startup',
    );
    return null;
  }

  opts.logger.info('checking database schema (auto-migrate on startup)…');
  try {
    const result = await runPlatformDbBootstrap({ logger: opts.logger });
    if (result.applied.length) {
      opts.logger.info('applied new database migrations', { files: result.applied });
    } else if (result.stamped.length) {
      opts.logger.info('database schema up to date (legacy migrations stamped)', {
        files: result.stamped,
      });
    } else {
      opts.logger.info('database schema up to date', {
        migrations: result.unchanged.length,
      });
    }
    return result;
  } catch (err) {
    opts.logger.error(
      'database bootstrap failed — check DATABASE_URL and migration SQL in deploy/init/',
      err,
    );
    if (opts.exitOnFailure !== false) {
      process.exit(1);
    }
    throw err;
  }
}
