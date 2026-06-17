import type { IngestPlugin } from './types.js';

export const enterpriseGraphHkPlugin: IngestPlugin = {
  key: 'enterprise-graph-ingest-hk',
  displayName: '企业图谱采集（香港）',
  tier: 'heavy',
  async run() {
    return {
      market: 'hk',
      status: 'stub',
      message: 'HK equity graph ingest not implemented — wire HKEX source in platform:executor',
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  },
};
