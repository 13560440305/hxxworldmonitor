import { runIngestPlugin } from '../../ingest-plugins/run-ingest-plugin.js';
import type { JobContext } from '../../jobs/types.js';
import type { EnterpriseGraphIngestResult } from '../types.js';

export { CNINFO_DISCLOSURE_PATHS } from '../../ingest-plugins/cninfo-disclosure.js';

/** @deprecated Use runIngestPlugin('cninfo-disclosure') via job handler. */
export async function runCnDisclosureIngest(ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  const result = await runIngestPlugin('cninfo-disclosure', ctx);
  return {
    market: 'cn',
    status: result.status === 'error' ? 'stub' : result.status,
    message: result.message,
    entitiesUpserted: result.entitiesUpserted ?? 0,
    edgesUpserted: result.edgesUpserted ?? 0,
  };
}
