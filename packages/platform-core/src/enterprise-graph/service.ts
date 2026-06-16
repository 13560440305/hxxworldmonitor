import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import { buildCatalogGraph, getCatalogCompany, listCatalogCompanies } from './catalog.js';
import { findKgCompanyBySymbol, getKgNeighborGraph, listKgCompanies } from './kg-repository.js';
import { ENTERPRISE_GRAPH_MARKETS, getEnterpriseGraphMarket, resolveMarketForRegion } from './markets.js';
import type {
  EnterpriseGraphCompany,
  EnterpriseGraphMarket,
  EnterpriseGraphMarketId,
  EnterpriseGraphResponse,
} from './types.js';

export function listEnterpriseGraphMarkets(region?: string): EnterpriseGraphMarket[] {
  if (!region || region === 'global') return [...ENTERPRISE_GRAPH_MARKETS];
  return ENTERPRISE_GRAPH_MARKETS.filter((m) => m.regionKeys.includes(region));
}

export async function listEnterpriseGraphCompanies(opts: {
  market?: string;
  region?: string;
  limit?: number;
}): Promise<{ companies: EnterpriseGraphCompany[]; market: EnterpriseGraphMarketId; source: 'kg' | 'catalog' }> {
  const region = opts.region ?? 'global';
  const market = (opts.market ?? resolveMarketForRegion(region)) as EnterpriseGraphMarketId;
  const limit = opts.limit ?? 50;

  if (isDatabaseEnabled()) {
    const kgRows = await listKgCompanies({ limit });
    if (kgRows.length > 0) {
      const companies: EnterpriseGraphCompany[] = kgRows.map((row) => ({
        symbol: row.external_key,
        name: row.name,
        display: row.external_key,
        market,
        regions: [region, 'global'],
        sector: typeof row.props_json?.sector === 'string' ? row.props_json.sector : undefined,
      }));
      return { companies, market, source: 'kg' };
    }
  }

  return {
    companies: listCatalogCompanies({ market, region, limit }),
    market,
    source: 'catalog',
  };
}

export async function getEnterpriseGraphCompany(
  symbol: string,
  market?: string,
): Promise<EnterpriseGraphCompany | null> {
  const marketId = (market ?? 'us') as EnterpriseGraphMarketId;

  if (isDatabaseEnabled()) {
    const kgRow = await findKgCompanyBySymbol(symbol);
    if (kgRow) {
      return {
        symbol: kgRow.external_key,
        name: kgRow.name,
        display: kgRow.external_key,
        market: marketId,
        regions: ['global'],
        sector: typeof kgRow.props_json?.sector === 'string' ? kgRow.props_json.sector : undefined,
      };
    }
  }

  return getCatalogCompany(symbol, marketId) ?? getCatalogCompany(symbol) ?? null;
}

export async function getEnterpriseGraph(
  symbol: string,
  opts?: { market?: string; region?: string; depth?: number },
): Promise<EnterpriseGraphResponse | null> {
  const region = opts?.region ?? 'global';
  const market = (opts?.market ?? resolveMarketForRegion(region)) as EnterpriseGraphMarketId;
  const depth = opts?.depth ?? 1;
  const marketMeta = getEnterpriseGraphMarket(market);

  if (isDatabaseEnabled()) {
    const kgCompany = await findKgCompanyBySymbol(symbol);
    if (kgCompany) {
      const { nodes, edges } = await getKgNeighborGraph(kgCompany.id, depth);
      const center = nodes.find((n) => n.symbol.toUpperCase() === symbol.toUpperCase())
        ?? {
          id: kgCompany.external_key,
          symbol: kgCompany.external_key,
          name: kgCompany.name,
          entityType: 'company' as const,
          market,
        };
      if (nodes.length > 0) {
        return {
          center,
          nodes,
          edges,
          market,
          source: 'kg',
          depth,
        };
      }
    }
  }

  const catalogGraph = buildCatalogGraph(symbol, market, depth);
  if (!catalogGraph) return null;

  return {
    center: catalogGraph.center,
    nodes: catalogGraph.nodes,
    edges: catalogGraph.edges,
    market,
    source: 'catalog',
    depth,
    ...(marketMeta ? {} : {}),
  };
}

export { resolveMarketForRegion, getEnterpriseGraphMarket };
