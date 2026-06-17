import type { EnterpriseGraphMarketId } from './types.js';

export type StockRegionKey =
  | 'global'
  | 'america'
  | 'mena'
  | 'eu'
  | 'asia'
  | 'latam'
  | 'africa'
  | 'oceania';

export interface GeoMarketDefaults {
  market: EnterpriseGraphMarketId;
  countryCode: string;
  regionKeys: StockRegionKey[];
  currency: string;
}

const GEO_DEFAULTS: Record<EnterpriseGraphMarketId, GeoMarketDefaults> = {
  cn: { market: 'cn', countryCode: 'CN', regionKeys: ['asia', 'global'], currency: 'CNY' },
  hk: { market: 'hk', countryCode: 'HK', regionKeys: ['asia', 'global'], currency: 'HKD' },
  us: { market: 'us', countryCode: 'US', regionKeys: ['america', 'global'], currency: 'USD' },
  eu: { market: 'eu', countryCode: 'EU', regionKeys: ['eu', 'global'], currency: 'EUR' },
};

/** Infer CN exchange from A-share / B-share code prefix. */
export function inferCnExchange(symbol: string): 'SSE' | 'SZSE' | 'BSE' {
  const code = symbol.replace(/\D/g, '').padStart(6, '0');
  const first = code[0];
  if (first === '6') return 'SSE';
  if (first === '8' || first === '4') return 'BSE';
  return 'SZSE';
}

export function getGeoDefaults(market: EnterpriseGraphMarketId): GeoMarketDefaults {
  return GEO_DEFAULTS[market] ?? GEO_DEFAULTS.cn;
}

export function companyExternalKey(market: string, exchange: string, symbol: string): string {
  return `${market}:${exchange}:${symbol}`;
}

export function filingExternalKey(market: string, source: string, sourceDocId: string): string {
  return `filing:${market}:${source}:${sourceDocId}`;
}
