import type { JobContext } from '../jobs/types.js';
import type { EnterpriseGraphIngestResult, EnterpriseGraphMarketId } from '../types.js';
import { runIngestPluginForHandler } from '../../ingest-plugins/run-ingest-plugin.js';

export { CNINFO_DISCLOSURE_PATHS } from '../../ingest-plugins/cninfo-disclosure.js';

const MARKET_BY_HANDLER: Record<string, EnterpriseGraphMarketId> = {
  'enterprise-graph-ingest-us': 'us',
  'enterprise-graph-ingest-hk': 'hk',
  'enterprise-graph-ingest-eu': 'eu',
  'disclosure-ingest-cn': 'cn',
};

function toGraphResult(
  handlerKey: string,
  result: Awaited<ReturnType<typeof runIngestPluginForHandler>>,
): EnterpriseGraphIngestResult {
  const market = (result.market as EnterpriseGraphMarketId | undefined)
    ?? MARKET_BY_HANDLER[handlerKey]
    ?? 'us';
  const status = result.status === 'error' ? 'stub' : (result.status ?? 'ok');
  return {
    market,
    status: status as EnterpriseGraphIngestResult['status'],
    message: result.message,
    entitiesUpserted: Number(result.entitiesUpserted ?? 0),
    edgesUpserted: Number(result.edgesUpserted ?? 0),
  };
}

export async function runUsEquityGraphIngest(ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return toGraphResult('enterprise-graph-ingest-us', await runIngestPluginForHandler('enterprise-graph-ingest-us', ctx));
}

export async function runHkEquityGraphIngest(ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return toGraphResult('enterprise-graph-ingest-hk', await runIngestPluginForHandler('enterprise-graph-ingest-hk', ctx));
}

export async function runEuEquityGraphIngest(ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return toGraphResult('enterprise-graph-ingest-eu', await runIngestPluginForHandler('enterprise-graph-ingest-eu', ctx));
}

export async function runCnDisclosureIngest(ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return toGraphResult('disclosure-ingest-cn', await runIngestPluginForHandler('disclosure-ingest-cn', ctx));
}

const HANDLER_BY_MARKET: Record<EnterpriseGraphMarketId, string> = {
  us: 'enterprise-graph-ingest-us',
  hk: 'enterprise-graph-ingest-hk',
  eu: 'enterprise-graph-ingest-eu',
  cn: 'disclosure-ingest-cn',
};

export function getEnterpriseGraphIngestRunner(
  market: string,
): ((ctx: JobContext) => Promise<EnterpriseGraphIngestResult>) | undefined {
  const handlerKey = HANDLER_BY_MARKET[market as EnterpriseGraphMarketId];
  if (!handlerKey) return undefined;
  return async (ctx) => toGraphResult(handlerKey, await runIngestPluginForHandler(handlerKey, ctx));
}
