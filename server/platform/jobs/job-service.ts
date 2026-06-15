import { enqueueManualJobRun } from './job-repository.js';
import { listJobHandlers } from './registry.js';

declare const process: { env: Record<string, string | undefined> };

/** When true, platform API may run jobs inline (legacy). Default: enqueue only. */
export function isSyncJobExecutionAllowed(): boolean {
  const raw = process.env.PLATFORM_ALLOW_SYNC_JOBS?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export async function enqueuePlatformJob(opts: {
  handlerKey: string;
  payload?: Record<string, unknown>;
}): Promise<{ runId: string; handlerKey: string; status: 'pending' }> {
  const run = await enqueueManualJobRun(opts);
  return { runId: run.id, handlerKey: run.handler_key, status: 'pending' };
}

export function jobHandlersCatalog(): Array<{ key: string; tier: string }> {
  return listJobHandlers().map((h) => ({ key: h.key, tier: h.tier }));
}
