import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import type { PlatformLogger } from '@hxxworldmonitor/shared/platform-logger.js';
import { ensureIntegrationProviderSeeds } from './integration-providers-repository.js';
import { ensureEngineSeeds } from './engines-repository.js';
import { ensureIngestBindingSeeds } from './ingest-bindings-repository.js';
import { seedJobDefinitions } from './jobs/job-seed.js';

export interface PlatformSeedResult {
  integrationProvidersInserted: number;
  enginesInserted: number;
  ingestBindingsInserted: number;
  jobDefinitionsSeeded: number;
}

/**
 * Idempotent seed data after schema migrations.
 */
export async function runPlatformSeedBootstrap(opts?: {
  logger?: PlatformLogger;
}): Promise<PlatformSeedResult> {
  const log = opts?.logger;
  const result: PlatformSeedResult = {
    integrationProvidersInserted: 0,
    enginesInserted: 0,
    ingestBindingsInserted: 0,
    jobDefinitionsSeeded: 0,
  };

  if (!isDatabaseEnabled()) {
    return result;
  }

  try {
    result.integrationProvidersInserted = await ensureIntegrationProviderSeeds();
    if (result.integrationProvidersInserted > 0) {
      log?.info('seeded integration providers', { count: result.integrationProvidersInserted });
    }
    result.enginesInserted = await ensureEngineSeeds();
    if (result.enginesInserted > 0) {
      log?.info('seeded engines', { count: result.enginesInserted });
    }
    result.ingestBindingsInserted = await ensureIngestBindingSeeds();
    if (result.ingestBindingsInserted > 0) {
      log?.info('seeded ingest bindings', { count: result.ingestBindingsInserted });
    }
    result.jobDefinitionsSeeded = await seedJobDefinitions(log);
  } catch (err) {
    log?.error('platform seed bootstrap failed', err);
    throw err;
  }

  return result;
}
