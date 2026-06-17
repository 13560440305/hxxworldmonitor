import type { IngestPlugin } from './types.js';

export const enterpriseGraphEuPlugin: IngestPlugin = {
  key: 'enterprise-graph-ingest-eu',
  displayName: '企业图谱采集（欧洲）',
  tier: 'heavy',
  async run() {
    return {
      market: 'eu',
      status: 'stub',
      message: 'EU equity graph ingest not implemented — wire Euronext/LSE source in platform:executor',
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  },
};
