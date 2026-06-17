import { getPlatformApiBaseUrl, isPlatformApiConfigured } from '@/config/platform-api';
import { ENTITY_REGISTRY } from '@/config/entities';
import { getStockMarketForSymbol, STOCK_CATALOG } from '@/config/stock-catalog';

export type EnterpriseGraphMarketId = 'us' | 'hk' | 'eu' | 'cn';

export interface EnterpriseGraphCompanyDto {
  symbol: string;
  name: string;
  display: string;
  market: EnterpriseGraphMarketId;
  regions: string[];
  sector?: string;
  price?: number | null;
  change?: number | null;
}

export interface EnterpriseGraphNodeDto {
  id: string;
  symbol: string;
  name: string;
  entityType: 'company' | 'news_item' | 'sector' | 'filing';
  market?: EnterpriseGraphMarketId;
}

export interface EnterpriseGraphEdgeDto {
  from: string;
  to: string;
  relationType: string;
}

export interface EnterpriseGraphDto {
  center: EnterpriseGraphNodeDto;
  nodes: EnterpriseGraphNodeDto[];
  edges: EnterpriseGraphEdgeDto[];
  market: EnterpriseGraphMarketId;
  source: 'kg' | 'catalog' | 'db';
  depth: number;
}

function apiPrefix(): string | null {
  if (!isPlatformApiConfigured()) return null;
  const base = getPlatformApiBaseUrl();
  return base ? `${base}/platform` : '/platform';
}

export function resolveMarketForRegion(region: string): EnterpriseGraphMarketId {
  if (region === 'asia') return 'cn';
  if (region === 'eu') return 'eu';
  return 'us';
}

export async function fetchEnterpriseGraphCompanies(
  region: string,
  market?: EnterpriseGraphMarketId,
  limit = 50,
): Promise<{ companies: EnterpriseGraphCompanyDto[]; market: EnterpriseGraphMarketId; source: string } | null> {
  const prefix = apiPrefix();
  if (!prefix) return null;

  const params = new URLSearchParams({
    region,
    limit: String(limit),
  });
  if (market) params.set('market', market);

  try {
    const resp = await fetch(`${prefix}/v1/enterprise-graph/companies?${params}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return null;
    return await resp.json() as {
      companies: EnterpriseGraphCompanyDto[];
      market: EnterpriseGraphMarketId;
      source: string;
    };
  } catch {
    return null;
  }
}

export async function fetchEnterpriseGraph(
  symbol: string,
  region: string,
  market?: EnterpriseGraphMarketId,
  depth = 1,
): Promise<EnterpriseGraphDto | null> {
  const prefix = apiPrefix();
  const marketId = market ?? resolveMarketForRegion(region);

  if (prefix) {
    const params = new URLSearchParams({ region, depth: String(depth) });
    if (market) params.set('market', market);

    try {
      const resp = await fetch(
        `${prefix}/v1/enterprise-graph/companies/${encodeURIComponent(symbol)}/graph?${params}`,
        { signal: AbortSignal.timeout(12_000) },
      );
      if (resp.ok) {
        return await resp.json() as EnterpriseGraphDto;
      }
    } catch {
      /* fall through to local catalog */
    }
  }

  return buildLocalEnterpriseGraph(symbol, marketId, depth);
}

/** Peer hints for offline / API-fallback graph (subset of platform catalog). */
const LOCAL_GRAPH_RELATED: Record<string, string[]> = {
  NVDA: ['AMD', 'TSM', 'AVGO', 'MSFT'],
  AAPL: ['MSFT', 'GOOGL', 'TSM'],
  MSFT: ['AAPL', 'GOOGL', 'AMZN', 'NVDA'],
  TSM: ['NVDA', 'AAPL', 'AVGO'],
  '600519': ['000858', '000568'],
  '300750': ['002594', '601012'],
};

function normalizeCatalogSymbol(symbol: string): string {
  const digits = symbol.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length <= 6) return digits.padStart(6, '0');
  return symbol.trim();
}

function findCatalogEntry(symbol: string, market?: EnterpriseGraphMarketId) {
  const upper = symbol.toUpperCase();
  const cn = normalizeCatalogSymbol(symbol);
  return STOCK_CATALOG.find((entry) => {
    if (entry.symbol.toUpperCase() === upper || entry.symbol === cn) return true;
    return entry.display.toUpperCase() === upper;
  }) ?? STOCK_CATALOG.find((entry) => {
    if (market && entry.market !== market) return false;
    return entry.symbol.toUpperCase() === upper || entry.symbol === cn;
  });
}

function buildLocalEnterpriseGraph(
  symbol: string,
  market: EnterpriseGraphMarketId,
  depth: number,
): EnterpriseGraphDto | null {
  const catalogEntry = findCatalogEntry(symbol, market);
  if (catalogEntry) {
    const center: EnterpriseGraphNodeDto = {
      id: catalogEntry.symbol,
      symbol: catalogEntry.symbol,
      name: catalogEntry.name,
      entityType: 'company',
      market: catalogEntry.market,
    };
    const nodes: EnterpriseGraphNodeDto[] = [center];
    const edges: EnterpriseGraphEdgeDto[] = [];
    const related = LOCAL_GRAPH_RELATED[catalogEntry.symbol]
      ?? LOCAL_GRAPH_RELATED[catalogEntry.symbol.toUpperCase()]
      ?? [];
    for (const relSymbol of related) {
      const rel = findCatalogEntry(relSymbol, market);
      if (!rel || nodes.some((n) => n.symbol === rel.symbol)) continue;
      nodes.push({
        id: rel.symbol,
        symbol: rel.symbol,
        name: rel.name,
        entityType: 'company',
        market: rel.market,
      });
      edges.push({ from: center.id, to: rel.symbol, relationType: depth > 0 ? 'related' : 'related' });
    }
    return {
      center,
      nodes,
      edges,
      market: catalogEntry.market,
      source: 'catalog',
      depth,
    };
  }

  const upper = symbol.toUpperCase();
  const entity = ENTITY_REGISTRY.find(
    (e) => e.id.toUpperCase() === upper || e.aliases.some((a) => a.toUpperCase() === upper),
  );
  if (!entity || entity.type !== 'company') {
    return null;
  }

  const center: EnterpriseGraphNodeDto = {
    id: entity.id,
    symbol: entity.id,
    name: entity.name,
    entityType: 'company',
    market: getStockMarketForSymbol(entity.id) as EnterpriseGraphMarketId,
  };

  const nodes: EnterpriseGraphNodeDto[] = [center];
  const edges: EnterpriseGraphEdgeDto[] = [];

  for (const relId of entity.related ?? []) {
    const rel = ENTITY_REGISTRY.find((e) => e.id === relId);
    if (!rel) continue;
    nodes.push({
      id: rel.id,
      symbol: rel.id,
      name: rel.name,
      entityType: 'company',
      market: getStockMarketForSymbol(rel.id) as EnterpriseGraphMarketId,
    });
    edges.push({ from: center.id, to: rel.id, relationType: 'related' });
  }

  return {
    center,
    nodes,
    edges,
    market,
    source: 'catalog',
    depth,
  };
}
