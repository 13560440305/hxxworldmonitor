import type { MarketSymbol } from '@/types';

export type StockRegionKey =
  | 'global'
  | 'america'
  | 'mena'
  | 'eu'
  | 'asia'
  | 'latam'
  | 'africa'
  | 'oceania';

export interface StockCatalogEntry extends MarketSymbol {
  regions: StockRegionKey[];
  market: 'us' | 'hk' | 'eu' | 'cn';
}

/** Region metadata for stocks panel filtering (mirrors platform catalog MVP). */
export const STOCK_CATALOG: StockCatalogEntry[] = [
  { symbol: '^GSPC', name: 'S&P 500', display: 'SPX', regions: ['global', 'america'], market: 'us' },
  { symbol: '^DJI', name: 'Dow Jones', display: 'DOW', regions: ['global', 'america'], market: 'us' },
  { symbol: '^IXIC', name: 'NASDAQ', display: 'NDX', regions: ['global', 'america'], market: 'us' },
  { symbol: 'AAPL', name: 'Apple', display: 'AAPL', regions: ['global', 'america'], market: 'us' },
  { symbol: 'MSFT', name: 'Microsoft', display: 'MSFT', regions: ['global', 'america'], market: 'us' },
  { symbol: 'NVDA', name: 'NVIDIA', display: 'NVDA', regions: ['global', 'america'], market: 'us' },
  { symbol: 'GOOGL', name: 'Alphabet', display: 'GOOGL', regions: ['global', 'america'], market: 'us' },
  { symbol: 'AMZN', name: 'Amazon', display: 'AMZN', regions: ['global', 'america'], market: 'us' },
  { symbol: 'META', name: 'Meta', display: 'META', regions: ['global', 'america'], market: 'us' },
  { symbol: 'TSM', name: 'TSMC', display: 'TSM', regions: ['global', 'asia', 'america'], market: 'us' },
  { symbol: 'AVGO', name: 'Broadcom', display: 'AVGO', regions: ['global', 'america'], market: 'us' },
  { symbol: 'JPM', name: 'JPMorgan', display: 'JPM', regions: ['global', 'america'], market: 'us' },
  { symbol: 'TSLA', name: 'Tesla', display: 'TSLA', regions: ['global', 'america'], market: 'us' },
  { symbol: 'NVO', name: 'Novo Nordisk', display: 'NVO', regions: ['global', 'eu', 'america'], market: 'us' },
  { symbol: '0700.HK', name: 'Tencent', display: '0700', regions: ['global', 'asia'], market: 'hk' },
  { symbol: '9988.HK', name: 'Alibaba', display: '9988', regions: ['global', 'asia'], market: 'hk' },
  { symbol: '0941.HK', name: 'China Mobile', display: '0941', regions: ['global', 'asia'], market: 'hk' },
  { symbol: 'ASML.AS', name: 'ASML', display: 'ASML', regions: ['global', 'eu'], market: 'eu' },
  { symbol: 'SAP.DE', name: 'SAP', display: 'SAP', regions: ['global', 'eu'], market: 'eu' },
  { symbol: 'NOVO-B.CO', name: 'Novo Nordisk', display: 'NOVO-B', regions: ['global', 'eu'], market: 'eu' },
  { symbol: '600519', name: '贵州茅台', display: '600519', regions: ['global', 'asia'], market: 'cn' },
  { symbol: '000001', name: '平安银行', display: '000001', regions: ['global', 'asia'], market: 'cn' },
  { symbol: '300750', name: '宁德时代', display: '300750', regions: ['global', 'asia'], market: 'cn' },
  { symbol: '601318', name: '中国平安', display: '601318', regions: ['global', 'asia'], market: 'cn' },
];

export function resolveStockMarket(region: string): 'us' | 'hk' | 'eu' | 'cn' {
  if (region === 'asia') return 'cn';
  if (region === 'eu') return 'eu';
  return 'us';
}

export function filterSymbolsForRegion(region: string, market?: string): Set<string> {
  const m = market ?? resolveStockMarket(region);
  const symbols = STOCK_CATALOG.filter((entry) => {
    if (entry.market !== m) return false;
    if (region === 'global') return true;
    return entry.regions.includes(region as StockRegionKey);
  });
  return new Set(symbols.map((s) => s.symbol.toUpperCase()));
}

export function listCatalogCompaniesForRegion(region: string, market?: string): StockCatalogEntry[] {
  const m = market ?? resolveStockMarket(region);
  return STOCK_CATALOG.filter((entry) => {
    if (entry.market !== m) return false;
    if (region === 'global') return true;
    return entry.regions.includes(region as StockRegionKey);
  });
}

export function getStockMarketForSymbol(symbol: string): 'us' | 'hk' | 'eu' | 'cn' {
  const entry = STOCK_CATALOG.find((s) => s.symbol.toUpperCase() === symbol.toUpperCase());
  return entry?.market ?? 'us';
}
