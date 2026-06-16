import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import {
  getEnterpriseGraph,
  getEnterpriseGraphCompany,
  listEnterpriseGraphCompanies,
  listEnterpriseGraphMarkets,
} from './service.js';

type JsonFn = (res: ServerResponse, status: number, body: unknown) => void;

function parseCompanyPath(path: string): { symbol: string; wantsGraph: boolean } | null {
  const match = path.match(/^\/platform\/v1\/enterprise-graph\/companies\/([^/]+)(?:\/(graph))?$/);
  if (!match) return null;
  return {
    symbol: decodeURIComponent(match[1]!),
    wantsGraph: match[2] === 'graph',
  };
}

/**
 * Public read API for enterprise graph UI.
 * Data ingestion is handled separately per market in platform:executor job handlers.
 */
export async function handleEnterpriseGraphRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL,
  json: JsonFn,
): Promise<boolean> {
  if (!path.startsWith('/platform/v1/enterprise-graph')) {
    return false;
  }

  if (req.method === 'GET' && path === '/platform/v1/enterprise-graph/markets') {
    const region = url.searchParams.get('region') ?? undefined;
    json(res, 200, {
      markets: listEnterpriseGraphMarkets(region),
      database: isDatabaseEnabled(),
    });
    return true;
  }

  if (req.method === 'GET' && path === '/platform/v1/enterprise-graph/companies') {
    const market = url.searchParams.get('market') ?? undefined;
    const region = url.searchParams.get('region') ?? 'global';
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : 50;
    const result = await listEnterpriseGraphCompanies({ market, region, limit });
    json(res, 200, {
      ...result,
      count: result.companies.length,
    });
    return true;
  }

  const parsed = parseCompanyPath(path);
  if (parsed && req.method === 'GET') {
    const { symbol, wantsGraph } = parsed;
    const market = url.searchParams.get('market') ?? undefined;
    const region = url.searchParams.get('region') ?? 'global';

    if (wantsGraph) {
      const depthRaw = url.searchParams.get('depth');
      const depth = depthRaw ? Number(depthRaw) : 1;
      const graph = await getEnterpriseGraph(symbol, { market, region, depth });
      if (!graph) {
        json(res, 404, { error: 'Graph not found', symbol });
        return true;
      }
      json(res, 200, graph);
      return true;
    }

    const company = await getEnterpriseGraphCompany(symbol, market);
    if (!company) {
      json(res, 404, { error: 'Company not found', symbol });
      return true;
    }
    json(res, 200, { company });
    return true;
  }

  json(res, 404, { error: 'Not found', path });
  return true;
}
