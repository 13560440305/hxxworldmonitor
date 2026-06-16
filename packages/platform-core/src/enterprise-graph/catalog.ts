import type {
  EnterpriseGraphCompany,
  EnterpriseGraphEdge,
  EnterpriseGraphMarketId,
  EnterpriseGraphNode,
} from './types.js';

/** Static catalog MVP — replaced incrementally by executor-ingested KG rows per market. */
const US_CATALOG: EnterpriseGraphCompany[] = [
  { symbol: '^GSPC', name: 'S&P 500', display: 'SPX', market: 'us', regions: ['global', 'america'], sector: 'Index' },
  { symbol: '^DJI', name: 'Dow Jones', display: 'DOW', market: 'us', regions: ['global', 'america'], sector: 'Index' },
  { symbol: '^IXIC', name: 'NASDAQ', display: 'NDX', market: 'us', regions: ['global', 'america'], sector: 'Index' },
  { symbol: 'AAPL', name: 'Apple', display: 'AAPL', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft', display: 'MSFT', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'NVDA', name: 'NVIDIA', display: 'NVDA', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet', display: 'GOOGL', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon', display: 'AMZN', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'META', name: 'Meta', display: 'META', market: 'us', regions: ['global', 'america'], sector: 'Technology' },
  { symbol: 'TSM', name: 'TSMC', display: 'TSM', market: 'us', regions: ['global', 'asia', 'america'], sector: 'Semiconductors' },
  { symbol: 'AVGO', name: 'Broadcom', display: 'AVGO', market: 'us', regions: ['global', 'america'], sector: 'Semiconductors' },
  { symbol: 'JPM', name: 'JPMorgan', display: 'JPM', market: 'us', regions: ['global', 'america'], sector: 'Finance' },
  { symbol: 'TSLA', name: 'Tesla', display: 'TSLA', market: 'us', regions: ['global', 'america'], sector: 'Automotive' },
  { symbol: 'NVO', name: 'Novo Nordisk', display: 'NVO', market: 'us', regions: ['global', 'eu', 'america'], sector: 'Healthcare' },
];

const HK_CATALOG: EnterpriseGraphCompany[] = [
  { symbol: '0700.HK', name: 'Tencent', display: '0700', market: 'hk', regions: ['global', 'asia'], sector: 'Technology' },
  { symbol: '9988.HK', name: 'Alibaba', display: '9988', market: 'hk', regions: ['global', 'asia'], sector: 'Technology' },
  { symbol: '0941.HK', name: 'China Mobile', display: '0941', market: 'hk', regions: ['global', 'asia'], sector: 'Telecom' },
];

const EU_CATALOG: EnterpriseGraphCompany[] = [
  { symbol: 'ASML.AS', name: 'ASML', display: 'ASML', market: 'eu', regions: ['global', 'eu'], sector: 'Semiconductors' },
  { symbol: 'SAP.DE', name: 'SAP', display: 'SAP', market: 'eu', regions: ['global', 'eu'], sector: 'Technology' },
  { symbol: 'NOVO-B.CO', name: 'Novo Nordisk', display: 'NOVO-B', market: 'eu', regions: ['global', 'eu'], sector: 'Healthcare' },
];

const CN_CATALOG: EnterpriseGraphCompany[] = [
  { symbol: '600519', name: '贵州茅台', display: '600519', market: 'cn', regions: ['global', 'asia'], sector: 'Consumer' },
  { symbol: '000001', name: '平安银行', display: '000001', market: 'cn', regions: ['global', 'asia'], sector: 'Finance' },
  { symbol: '300750', name: '宁德时代', display: '300750', market: 'cn', regions: ['global', 'asia'], sector: 'Battery' },
  { symbol: '601318', name: '中国平安', display: '601318', market: 'cn', regions: ['global', 'asia'], sector: 'Finance' },
  { symbol: '600036', name: '招商银行', display: '600036', market: 'cn', regions: ['global', 'asia'], sector: 'Finance' },
];

/** Peer / supply-chain hints until executor fills kg_edges. */
const RELATED: Record<string, string[]> = {
  NVDA: ['AMD', 'TSM', 'AVGO', 'MSFT', 'GOOGL'],
  AAPL: ['MSFT', 'GOOGL', 'TSM'],
  MSFT: ['AAPL', 'GOOGL', 'AMZN', 'NVDA'],
  TSM: ['NVDA', 'AAPL', 'AVGO'],
  AVGO: ['NVDA', 'TSM'],
  GOOGL: ['META', 'MSFT', 'AMZN'],
  AMZN: ['MSFT', 'GOOGL', 'META'],
  META: ['GOOGL', 'AMZN'],
  TSLA: ['NVDA'],
  '0700.HK': ['9988.HK', 'AAPL'],
  '9988.HK': ['0700.HK', 'AMZN'],
  'ASML.AS': ['NVDA', 'TSM'],
  '600519': ['000858', '000568'],
  '300750': ['002594', '601012'],
};

const ALL_CATALOG: EnterpriseGraphCompany[] = [...US_CATALOG, ...HK_CATALOG, ...EU_CATALOG, ...CN_CATALOG];

export function listCatalogCompanies(opts: {
  market?: EnterpriseGraphMarketId;
  region?: string;
  limit?: number;
}): EnterpriseGraphCompany[] {
  const limit = opts.limit ?? 100;
  let rows = ALL_CATALOG;
  if (opts.market) {
    rows = rows.filter((c) => c.market === opts.market);
  }
  if (opts.region && opts.region !== 'global') {
    rows = rows.filter((c) => c.regions.includes(opts.region!) || c.regions.includes('global'));
  }
  return rows.slice(0, limit);
}

export function getCatalogCompany(
  symbol: string,
  market?: EnterpriseGraphMarketId,
): EnterpriseGraphCompany | undefined {
  const upper = symbol.toUpperCase();
  return ALL_CATALOG.find(
    (c) =>
      c.symbol.toUpperCase() === upper
      && (!market || c.market === market),
  );
}

export function buildCatalogGraph(
  symbol: string,
  market: EnterpriseGraphMarketId,
  depth: number,
): { center: EnterpriseGraphNode; nodes: EnterpriseGraphNode[]; edges: EnterpriseGraphEdge[] } | null {
  const company = getCatalogCompany(symbol, market) ?? getCatalogCompany(symbol);
  if (!company) return null;

  const center: EnterpriseGraphNode = {
    id: company.symbol,
    symbol: company.symbol,
    name: company.name,
    entityType: 'company',
    market: company.market,
    props: { sector: company.sector },
  };

  const nodes: EnterpriseGraphNode[] = [center];
  const edges: EnterpriseGraphEdge[] = [];
  const seen = new Set<string>([company.symbol]);

  const relatedKeys = RELATED[company.symbol] ?? RELATED[company.symbol.toUpperCase()] ?? [];
  for (const relSymbol of relatedKeys) {
    const rel = getCatalogCompany(relSymbol) ?? getCatalogCompany(relSymbol, market);
    if (!rel || seen.has(rel.symbol)) continue;
    seen.add(rel.symbol);
    nodes.push({
      id: rel.symbol,
      symbol: rel.symbol,
      name: rel.name,
      entityType: 'company',
      market: rel.market,
      props: { sector: rel.sector },
    });
    edges.push({
      from: center.id,
      to: rel.symbol,
      relationType: depth > 0 ? 'related' : 'related',
    });
  }

  return { center, nodes, edges };
}
