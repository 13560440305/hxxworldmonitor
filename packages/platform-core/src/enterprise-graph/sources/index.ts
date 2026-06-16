import type { JobContext } from '../jobs/types.js';
import type { EnterpriseGraphIngestResult, EnterpriseGraphMarketId } from '../types.js';
import { runCnDisclosureIngest } from './cn-disclosure.js';

export { runCnDisclosureIngest, CNINFO_DISCLOSURE_PATHS } from './cn-disclosure.js';

/**
 * US market enterprise graph ingest — implement in platform:executor phase.
 * Future: Finnhub profiles, SEC supply-chain disclosures, OpenFIGI mapping.
 */
export async function runUsEquityGraphIngest(_ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return {
    market: 'us',
    status: 'stub',
    message: 'US equity graph ingest not implemented — wire Finnhub/SEC source in platform:executor',
    entitiesUpserted: 0,
    edgesUpserted: 0,
  };
}

/**
 * Hong Kong market ingest stub — future: HKEX, AkShare, Wind.
 */
export async function runHkEquityGraphIngest(_ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return {
    market: 'hk',
    status: 'stub',
    message: 'HK equity graph ingest not implemented — wire HKEX source in platform:executor',
    entitiesUpserted: 0,
    edgesUpserted: 0,
  };
}

/**
 * Europe market ingest stub — future: Euronext, LSE, Refinitiv.
 */
export async function runEuEquityGraphIngest(_ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  return {
    market: 'eu',
    status: 'stub',
    message: 'EU equity graph ingest not implemented — wire Euronext/LSE source in platform:executor',
    entitiesUpserted: 0,
    edgesUpserted: 0,
  };
}

const INGEST_BY_MARKET: Record<EnterpriseGraphMarketId, (ctx: JobContext) => Promise<EnterpriseGraphIngestResult>> = {
  us: runUsEquityGraphIngest,
  hk: runHkEquityGraphIngest,
  eu: runEuEquityGraphIngest,
  cn: runCnDisclosureIngest,
};

export function getEnterpriseGraphIngestRunner(
  market: string,
): ((ctx: JobContext) => Promise<EnterpriseGraphIngestResult>) | undefined {
  return INGEST_BY_MARKET[market as EnterpriseGraphMarketId];
}
