import type { CninfoAnnouncement } from './client.js';
import { CNINFO_SOURCE } from './client.js';
import { upsertCompanyAndSecurityFromAnnouncement } from '../listed-companies-repository.js';

export async function upsertMasterFromAnnouncement(
  ann: CninfoAnnouncement,
  workspaceId?: string,
): Promise<{ companyId: string; securityId: string; exchange: string; symbol: string }> {
  return upsertCompanyAndSecurityFromAnnouncement(
    {
      source: CNINFO_SOURCE,
      sourceOrgId: ann.orgId,
      secCode: ann.secCode,
      secName: ann.secName,
      market: 'cn',
    },
    workspaceId,
  );
}
