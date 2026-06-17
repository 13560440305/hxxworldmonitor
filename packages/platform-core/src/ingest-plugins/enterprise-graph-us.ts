import type { IngestPlugin } from './types.js';

export const enterpriseGraphUsPlugin: IngestPlugin = {
  key: 'enterprise-graph-ingest-us',
  displayName: '企业图谱采集（美国）',
  tier: 'heavy',
  async run() {
    return {
      market: 'us',
      status: 'stub',
      message: 'US equity graph ingest not implemented — wire Finnhub/SEC source in platform:executor',
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  },
};
