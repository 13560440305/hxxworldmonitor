import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import type { PlatformLogger } from '@hxxworldmonitor/shared/platform-logger.js';
import { ensureIntegrationProviderSeeds } from './integration-providers-repository.js';
import { seedJobDefinitions } from './jobs/job-seed.js';

export interface PlatformSeedResult {
  integrationProvidersInserted: number;
  jobDefinitionsSeeded: number;
}

/**
 * Idempotent seed data after schema migrations.
 * Inserts missing integration provider rows (base_url defaults + empty api_key).
 */
export async function runPlatformSeedBootstrap(opts?: {
  logger?: PlatformLogger;
}): Promise<PlatformSeedResult> {
  const log = opts?.logger;
  const result: PlatformSeedResult = { integrationProvidersInserted: 0, jobDefinitionsSeeded: 0 };

  if (!isDatabaseEnabled()) {
    return result;
  }

  try {
    result.integrationProvidersInserted = await ensureIntegrationProviderSeeds();
    if (result.integrationProvidersInserted > 0) {
      log?.info('seeded integration providers', { count: result.integrationProvidersInserted });
    }
    result.jobDefinitionsSeeded = await seedJobDefinitions(log);
  } catch (err) {
    log?.error('platform seed bootstrap failed', err);
    throw err;
  }

  return result;
}
