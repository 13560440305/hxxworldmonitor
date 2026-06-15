import type { PlatformLogger } from '@hxxworldmonitor/shared/platform-logger.js';
import { getJobHandler } from './registry.js';
import type { JobResult, JobRunRow } from './types.js';
import {
  claimNextPendingRun,
  finishJobRun,
  getHandlerTimeoutSec,
} from './job-repository.js';
import { setJobCheckpoint } from './job-checkpoint.js';
import { maybeEnqueueKnowledgeGraphBuild } from './job-dag.js';

export async function executeJobRun(
  run: JobRunRow,
  workerId: string,
  log: PlatformLogger,
): Promise<void> {
  const handler = getJobHandler(run.handler_key);
  if (!handler) {
    await finishJobRun(run.id, 'failed', {
      errorMessage: `Unknown handler: ${run.handler_key}`,
    });
    return;
  }

  const controller = new AbortController();
  const timeoutSec = await getHandlerTimeoutSec(run.handler_key);
  const timeoutMs = timeoutSec * 1000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    log.info('job run started', { runId: run.id, handler: run.handler_key, workerId });
    const result: JobResult = await handler.run({
      runId: run.id,
      workspaceId: run.workspace_id,
      handlerKey: run.handler_key,
      payload: run.payload_json,
      signal: controller.signal,
    });
    await finishJobRun(run.id, 'succeeded', { stats: result.stats });
    await setJobCheckpoint(run.handler_key, {
      runId: run.id,
      completedAt: new Date().toISOString(),
      stats: result.stats,
    });

    const dag = await maybeEnqueueKnowledgeGraphBuild({
      runId: run.id,
      handlerKey: run.handler_key,
    });
    if (dag.enqueued) {
      log.info('dag enqueued downstream job', {
        upstream: run.handler_key,
        downstream: 'knowledge-graph-build',
        downstreamRunId: dag.runId,
      });
    }

    log.info('job run succeeded', { runId: run.id, handler: run.handler_key, stats: result.stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, 'failed', { errorMessage: message });
    log.error('job run failed', err, { runId: run.id, handler: run.handler_key });
  } finally {
    clearTimeout(timer);
  }
}

export async function runExecutorOnce(
  workerId: string,
  log: PlatformLogger,
): Promise<boolean> {
  const run = await claimNextPendingRun(workerId);
  if (!run) return false;
  await executeJobRun(run, workerId, log);
  return true;
}
