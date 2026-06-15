import {
  countActiveJobRuns,
  enqueueManualJobRun,
} from './job-repository.js';
import { getJobCheckpoint, getJobCheckpointTime } from './job-checkpoint.js';

declare const process: { env: Record<string, string | undefined> };

/** Upstream handlers that must both succeed before knowledge-graph-build (DAG). */
export const KG_DAG_UPSTREAM = ['stock-news-ingest', 'earnings-ingest'] as const;
export const KG_DAG_DOWNSTREAM = 'knowledge-graph-build';

export function isKgDagEnabled(): boolean {
  const raw = process.env.PLATFORM_KG_DAG_ENABLED?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}

export interface KgDagStatus {
  enabled: boolean;
  upstream: readonly string[];
  downstream: string;
  checkpoints: Record<string, { completedAt: string | null; runId?: string }>;
  cycleStart: string | null;
  readyToEnqueue: boolean;
  reason: string;
  activeDownstreamRuns: number;
}

/** Read-only DAG evaluation (Admin UI + maybeEnqueue). */
export async function evaluateKgDag(): Promise<KgDagStatus> {
  const checkpoints: KgDagStatus['checkpoints'] = {};
  for (const key of [...KG_DAG_UPSTREAM, KG_DAG_DOWNSTREAM]) {
    const cp = await getJobCheckpoint(key);
    checkpoints[key] = {
      completedAt: cp?.completedAt ?? null,
      runId: cp?.runId,
    };
  }

  const activeDownstreamRuns = await countActiveJobRuns(KG_DAG_DOWNSTREAM);

  if (!isKgDagEnabled()) {
    return {
      enabled: false,
      upstream: KG_DAG_UPSTREAM,
      downstream: KG_DAG_DOWNSTREAM,
      checkpoints,
      cycleStart: null,
      readyToEnqueue: false,
      reason: 'PLATFORM_KG_DAG_ENABLED=false',
      activeDownstreamRuns,
    };
  }

  const kgCheckpointAt = await getJobCheckpointTime(KG_DAG_DOWNSTREAM);
  const upstreamTimes = await Promise.all(
    KG_DAG_UPSTREAM.map((key) => getJobCheckpointTime(key)),
  );

  if (upstreamTimes.some((t) => !t)) {
    return {
      enabled: true,
      upstream: KG_DAG_UPSTREAM,
      downstream: KG_DAG_DOWNSTREAM,
      checkpoints,
      cycleStart: null,
      readyToEnqueue: false,
      reason: 'waiting for all upstream jobs',
      activeDownstreamRuns,
    };
  }

  const cycleStart = new Date(Math.min(...upstreamTimes.map((t) => t!.getTime())));
  const cycleStartIso = cycleStart.toISOString();

  if (kgCheckpointAt && cycleStart <= kgCheckpointAt) {
    return {
      enabled: true,
      upstream: KG_DAG_UPSTREAM,
      downstream: KG_DAG_DOWNSTREAM,
      checkpoints,
      cycleStart: cycleStartIso,
      readyToEnqueue: false,
      reason: 'knowledge graph already built for this cycle',
      activeDownstreamRuns,
    };
  }

  if (activeDownstreamRuns > 0) {
    return {
      enabled: true,
      upstream: KG_DAG_UPSTREAM,
      downstream: KG_DAG_DOWNSTREAM,
      checkpoints,
      cycleStart: cycleStartIso,
      readyToEnqueue: false,
      reason: 'knowledge-graph-build already pending or running',
      activeDownstreamRuns,
    };
  }

  return {
    enabled: true,
    upstream: KG_DAG_UPSTREAM,
    downstream: KG_DAG_DOWNSTREAM,
    checkpoints,
    cycleStart: cycleStartIso,
    readyToEnqueue: true,
    reason: 'ready',
    activeDownstreamRuns: 0,
  };
}

/**
 * When stock-news and earnings have both completed since the last kg checkpoint,
 * enqueue a single knowledge-graph-build run.
 */
export async function maybeEnqueueKnowledgeGraphBuild(opts: {
  runId: string;
  handlerKey: string;
}): Promise<{ enqueued: boolean; reason?: string; runId?: string }> {
  if (!KG_DAG_UPSTREAM.includes(opts.handlerKey as (typeof KG_DAG_UPSTREAM)[number])) {
    return { enqueued: false, reason: 'not an upstream handler' };
  }

  const status = await evaluateKgDag();
  if (!status.readyToEnqueue) {
    return { enqueued: false, reason: status.reason };
  }

  const run = await enqueueManualJobRun({
    handlerKey: KG_DAG_DOWNSTREAM,
    payload: {
      dag: true,
      triggeredByRunId: opts.runId,
      triggeredByHandler: opts.handlerKey,
      cycleStart: status.cycleStart,
    },
  });

  return { enqueued: true, runId: run.id };
}
