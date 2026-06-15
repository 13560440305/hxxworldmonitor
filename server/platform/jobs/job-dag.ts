import {
  countActiveJobRuns,
  enqueueManualJobRun,
} from './job-repository.js';
import { getJobCheckpointTime } from './job-checkpoint.js';

declare const process: { env: Record<string, string | undefined> };

/** Upstream handlers that must both succeed before knowledge-graph-build (DAG). */
export const KG_DAG_UPSTREAM = ['stock-news-ingest', 'earnings-ingest'] as const;

export function isKgDagEnabled(): boolean {
  const raw = process.env.PLATFORM_KG_DAG_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}

/**
 * When stock-news and earnings have both completed since the last kg checkpoint,
 * enqueue a single knowledge-graph-build run.
 */
export async function maybeEnqueueKnowledgeGraphBuild(opts: {
  runId: string;
  handlerKey: string;
}): Promise<{ enqueued: boolean; reason?: string; runId?: string }> {
  if (!isKgDagEnabled()) {
    return { enqueued: false, reason: 'PLATFORM_KG_DAG_ENABLED=false' };
  }
  if (!KG_DAG_UPSTREAM.includes(opts.handlerKey as (typeof KG_DAG_UPSTREAM)[number])) {
    return { enqueued: false, reason: 'not an upstream handler' };
  }

  const kgCheckpointAt = await getJobCheckpointTime('knowledge-graph-build');
  const upstreamTimes = await Promise.all(
    KG_DAG_UPSTREAM.map((key) => getJobCheckpointTime(key)),
  );

  if (upstreamTimes.some((t) => !t)) {
    return { enqueued: false, reason: 'waiting for all upstream jobs' };
  }

  const cycleStart = new Date(Math.min(...upstreamTimes.map((t) => t!.getTime())));
  if (kgCheckpointAt && cycleStart <= kgCheckpointAt) {
    return { enqueued: false, reason: 'knowledge graph already built for this cycle' };
  }

  const active = await countActiveJobRuns('knowledge-graph-build');
  if (active > 0) {
    return { enqueued: false, reason: 'knowledge-graph-build already pending or running' };
  }

  const run = await enqueueManualJobRun({
    handlerKey: 'knowledge-graph-build',
    payload: {
      dag: true,
      triggeredByRunId: opts.runId,
      triggeredByHandler: opts.handlerKey,
      cycleStart: cycleStart.toISOString(),
    },
  });

  return { enqueued: true, runId: run.id };
}
