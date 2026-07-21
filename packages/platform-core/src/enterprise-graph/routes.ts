import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDefaultWorkspaceId, isDatabaseEnabled } from '@hxxworldmonitor/shared/db.js';
import {
  getEnterpriseGraph,
  getEnterpriseGraphCompany,
  listEnterpriseGraphCompanies,
  listEnterpriseGraphMarkets,
  listCompanyFilings,
} from './service.js';
import { runDisclosureRelationExtractBatch } from './cninfo/pipeline.js';

type JsonFn = (res: ServerResponse, status: number, body: unknown) => void;

function parseCompanyPath(path: string): {
  symbol: string;
  sub?: 'graph' | 'filings' | 'extract-relations';
} | null {
  const match = path.match(
    /^\/platform\/v1\/enterprise-graph\/companies\/([^/]+)(?:\/(graph|filings|extract-relations))?$/,
  );
  if (!match) return null;
  const sub =
    match[2] === 'graph' || match[2] === 'filings' || match[2] === 'extract-relations'
      ? match[2]
      : undefined;
  return {
    symbol: decodeURIComponent(match[1]!),
    sub,
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
  if (parsed && req.method === 'POST' && parsed.sub === 'extract-relations') {
    if (!isDatabaseEnabled()) {
      json(res, 503, { error: 'DATABASE_URL not configured' });
      return true;
    }
    let body: { useLlm?: boolean; force?: boolean; limit?: number } = {};
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw) body = JSON.parse(raw) as typeof body;
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return true;
    }

    const digits = parsed.symbol.replace(/\D/g, '');
    const symbol =
      digits.length >= 4 && digits.length <= 6
        ? digits.padStart(6, '0')
        : parsed.symbol.trim();

    const result = await runDisclosureRelationExtractBatch({
      workspaceId: getDefaultWorkspaceId(),
      symbols: [symbol],
      limit: Math.min(Math.max(Number(body.limit) || 30, 1), 50),
      useLlm: body.useLlm === true,
      force: body.force === true,
    });
    json(res, 200, { ok: true, symbol, ...result });
    return true;
  }

  if (parsed && req.method === 'GET') {
    const { symbol, sub } = parsed;
    const market = url.searchParams.get('market') ?? undefined;
    const region = url.searchParams.get('region') ?? 'global';

    if (sub === 'graph') {
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

    if (sub === 'filings') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw ? Number(limitRaw) : 30;
      const filings = await listCompanyFilings(symbol, { market, limit });
      json(res, 200, {
        symbol,
        market: market ?? null,
        count: filings.length,
        filings,
      });
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
