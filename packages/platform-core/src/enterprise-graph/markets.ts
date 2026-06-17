import type { EnterpriseGraphMarket, EnterpriseGraphMarketId } from './types.js';

export const ENTERPRISE_GRAPH_MARKETS: EnterpriseGraphMarket[] = [
  {
    id: 'us',
    name: 'US Equities',
    currency: 'USD',
    regionKeys: ['global', 'america'],
    sourceHandlerKey: 'enterprise-graph-ingest-us',
    sourceLabel: 'Finnhub / SEC (stub)',
    status: 'stub',
  },
  {
    id: 'hk',
    name: 'Hong Kong',
    currency: 'HKD',
    regionKeys: ['global', 'asia'],
    sourceHandlerKey: 'enterprise-graph-ingest-hk',
    sourceLabel: 'HKEX / AkShare (stub)',
    status: 'stub',
  },
  {
    id: 'eu',
    name: 'Europe',
    currency: 'EUR',
    regionKeys: ['global', 'eu'],
    sourceHandlerKey: 'enterprise-graph-ingest-eu',
    sourceLabel: 'Euronext / LSE (stub)',
    status: 'stub',
  },
  {
    id: 'cn',
    name: 'China A-Share',
    currency: 'CNY',
    regionKeys: ['global', 'asia'],
    sourceHandlerKey: 'disclosure-ingest-cn',
    sourceLabel: 'CNINFO / Firecrawl',
    status: 'active',
  },
];

export function getEnterpriseGraphMarket(id: string): EnterpriseGraphMarket | undefined {
  return ENTERPRISE_GRAPH_MARKETS.find((m) => m.id === id);
}

export function resolveMarketForRegion(region: string): EnterpriseGraphMarketId {
  if (region === 'asia') return 'cn';
  if (region === 'eu') return 'eu';
  if (region === 'america') return 'us';
  return 'us';
}

export function listMarketsForRegion(region: string): EnterpriseGraphMarket[] {
  return ENTERPRISE_GRAPH_MARKETS.filter(
    (m) => m.regionKeys.includes(region) || region === 'global',
  );
}
