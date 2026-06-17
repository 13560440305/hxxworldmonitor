import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import { buildCatalogGraph, getCatalogCompany, listCatalogCompanies } from './catalog.js';
import { findKgCompanyBySymbol, getKgNeighborGraph, listKgCompanies } from './kg-repository.js';
import { listListedSecurities, findListedSecurityBySymbol } from './listed-companies-repository.js';
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
}): Promise<{ companies: EnterpriseGraphCompany[]; market: EnterpriseGraphMarketId; source: 'kg' | 'catalog' | 'db' }> {
  const region = opts.region ?? 'global';
  const market = (opts.market ?? resolveMarketForRegion(region)) as EnterpriseGraphMarketId;
  const limit = opts.limit ?? 50;

  if (isDatabaseEnabled()) {
    const dbRows = await listListedSecurities({ market, region, limit });
    if (dbRows.length > 0) {
      return { companies: dbRows, market, source: 'db' };
    }

    const kgRows = await listKgCompanies({ limit });
    if (kgRows.length > 0) {
      const companies: EnterpriseGraphCompany[] = kgRows.map((row) => {
        const props = row.props_json ?? {};
        const sym = typeof props.symbol === 'string' ? props.symbol : row.external_key.split(':').pop() ?? row.external_key;
        const rowMarket = (typeof props.market === 'string' ? props.market : market) as EnterpriseGraphMarketId;
        const regions = Array.isArray(props.region_keys)
          ? props.region_keys.map(String)
          : [region, 'global'];
        return {
          symbol: sym,
          name: row.name,
          display: sym,
          market: rowMarket,
          regions,
          sector: typeof props.sector === 'string' ? props.sector : undefined,
        };
      });
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
  const marketId = (market ?? 'cn') as EnterpriseGraphMarketId;

  if (isDatabaseEnabled()) {
    const listed = await findListedSecurityBySymbol(symbol, marketId);
    if (listed) {
      return {
        symbol: listed.symbol,
        name: listed.name ?? listed.company_name ?? listed.symbol,
        display: listed.display_symbol ?? listed.symbol,
        market: listed.market as EnterpriseGraphMarketId,
        regions: listed.region_keys,
      };
    }

    const kgRow = await findKgCompanyBySymbol(symbol, marketId);
    if (kgRow) {
      const props = kgRow.props_json ?? {};
      const sym = typeof props.symbol === 'string' ? props.symbol : symbol;
      return {
        symbol: sym,
        name: kgRow.name,
        display: sym,
        market: (typeof props.market === 'string' ? props.market : marketId) as EnterpriseGraphMarketId,
        regions: Array.isArray(props.region_keys) ? props.region_keys.map(String) : ['global'],
        sector: typeof props.sector === 'string' ? props.sector : undefined,
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
  const sym = symbol.replace(/\D/g, '').length >= 4 ? symbol.replace(/\D/g, '').padStart(6, '0') : symbol;

  if (isDatabaseEnabled()) {
    const kgCompany = await findKgCompanyBySymbol(sym, market);
    if (kgCompany) {
      const { nodes, edges } = await getKgNeighborGraph(kgCompany.id, depth);
      const props = kgCompany.props_json ?? {};
      const center: EnterpriseGraphResponse['center'] = {
        id: kgCompany.external_key,
        symbol: sym,
        name: kgCompany.name,
        entityType: 'company',
        market,
        props,
      };
      const nodeMap = new Map<string, EnterpriseGraphResponse['nodes'][number]>();
      for (const node of nodes) nodeMap.set(node.id, node);
      nodeMap.set(center.id, center);
      return {
        center,
        nodes: [...nodeMap.values()],
        edges,
        market,
        source: 'kg',
        depth,
      };
    }
  }

  const catalogGraph = buildCatalogGraph(sym, market, depth)
    ?? buildCatalogGraph(symbol, market, depth);
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
