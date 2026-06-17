import { runKnowledgeGraphBuild } from '../equity-ingest.js';
import type { IngestPlugin } from './types.js';

export const knowledgeGraphBuildPlugin: IngestPlugin = {
  key: 'knowledge-graph-build',
  displayName: '企业知识图谱构建',
  tier: 'heavy',
  async run(ctx) {
    const lookbackHours = ctx.payload.lookbackHours != null
      ? Number(ctx.payload.lookbackHours)
      : undefined;
    const sinceRaw = ctx.payload.cycleStart ?? ctx.payload.since;
    const since = typeof sinceRaw === 'string' ? new Date(sinceRaw) : undefined;
    const result = await runKnowledgeGraphBuild({
      lookbackHours,
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    });
    return { status: 'ok', ...result, dag: ctx.payload.dag === true };
  },
};
