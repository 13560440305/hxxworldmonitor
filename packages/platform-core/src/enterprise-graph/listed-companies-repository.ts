import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import type { EnterpriseGraphCompany, EnterpriseGraphMarketId } from './types.js';
import { companyExternalKey, getGeoDefaults, inferCnExchange } from './geo.js';

export interface ListedCompanyRow {
  id: string;
  country_code: string;
  market: string;
  source: string;
  source_org_id: string;
  legal_name: string | null;
  short_name: string | null;
  sector: string | null;
  industry: string | null;
  props_json: Record<string, unknown>;
}

export interface ListedSecurityRow {
  id: string;
  company_id: string;
  country_code: string;
  market: string;
  exchange: string;
  region_keys: string[];
  symbol: string;
  display_symbol: string | null;
  name: string | null;
  currency: string;
  security_type: string;
  is_primary: boolean;
  props_json: Record<string, unknown>;
}

export interface UpsertFromAnnouncementInput {
  source: string;
  sourceOrgId: string;
  secCode: string;
  secName: string;
  market?: EnterpriseGraphMarketId;
}

export interface UpsertFromAnnouncementResult {
  companyId: string;
  securityId: string;
  exchange: string;
  symbol: string;
}

export async function upsertCompanyAndSecurityFromAnnouncement(
  input: UpsertFromAnnouncementInput,
  workspaceId?: string,
): Promise<UpsertFromAnnouncementResult> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const market = input.market ?? 'cn';
  const geo = getGeoDefaults(market);
  const symbol = input.secCode.replace(/\D/g, '').padStart(6, '0');
  const exchange = market === 'cn' ? inferCnExchange(symbol) : 'UNKNOWN';
  const orgId = String(input.sourceOrgId).trim();
  const shortName = input.secName.trim();

  const companyRes = await query<{ id: string }>(
    `INSERT INTO listed_companies
       (workspace_id, country_code, market, source, source_org_id, legal_name, short_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workspace_id, market, source, source_org_id) DO UPDATE SET
       short_name = COALESCE(NULLIF(EXCLUDED.short_name, ''), listed_companies.short_name),
       legal_name = COALESCE(NULLIF(EXCLUDED.legal_name, ''), listed_companies.legal_name),
       updated_at = NOW()
     RETURNING id`,
    [ws, geo.countryCode, market, input.source, orgId, shortName, shortName],
  );
  const companyId = companyRes.rows[0]!.id;

  const secRes = await query<{ id: string }>(
    `INSERT INTO listed_securities
       (workspace_id, company_id, country_code, market, exchange, region_keys,
        symbol, display_symbol, name, currency, security_type, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'stock', TRUE)
     ON CONFLICT (workspace_id, market, exchange, symbol) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, ''), listed_securities.name),
       company_id = EXCLUDED.company_id,
       region_keys = EXCLUDED.region_keys,
       updated_at = NOW()
     RETURNING id`,
    [
      ws,
      companyId,
      geo.countryCode,
      market,
      exchange,
      geo.regionKeys,
      symbol,
      symbol,
      shortName,
      geo.currency,
    ],
  );

  return {
    companyId,
    securityId: secRes.rows[0]!.id,
    exchange,
    symbol,
  };
}

export async function findFilingBySourceDoc(
  source: string,
  sourceDocId: string,
  workspaceId?: string,
): Promise<{
  id: string;
  parse_status: string;
  retry_count: number;
  source_url: string | null;
} | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{
    id: string;
    parse_status: string;
    retry_count: number;
    source_url: string | null;
  }>(
    `SELECT id, parse_status, retry_count, source_url FROM company_filings
     WHERE workspace_id = $1 AND source = $2 AND source_doc_id = $3`,
    [ws, source, sourceDocId],
  );
  return res.rows[0] ?? null;
}

export async function insertDisclosureFiling(input: {
  companyId: string;
  securityId: string;
  symbol: string;
  companyName: string;
  market: string;
  exchange: string;
  countryCode: string;
  source: string;
  sourceDocId: string;
  title: string;
  category?: string;
  sourceUrl?: string;
  publishedAt?: Date;
}, workspaceId?: string): Promise<string | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ id: string }>(
    `INSERT INTO company_filings
       (workspace_id, symbol, company_name, filing_type, period_end, source_url,
        country_code, market, exchange, company_id, security_id, source, source_doc_id,
        title, category, published_at, parse_status)
     SELECT $1, $2, $3, 'disclosure', NULL, $4,
            $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, 'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM company_filings
       WHERE workspace_id = $1 AND source = $10 AND source_doc_id = $11
     )
     RETURNING id`,
    [
      ws,
      input.symbol,
      input.companyName,
      input.sourceUrl ?? null,
      input.countryCode,
      input.market,
      input.exchange,
      input.companyId,
      input.securityId,
      input.source,
      input.sourceDocId,
      input.title,
      input.category ?? null,
      input.publishedAt ?? null,
    ],
  );
  return res.rows[0]?.id ?? null;
}

export async function findDisclosureDocumentByUrlOrChecksum(
  filingId: string,
  opts: { sourceUrl?: string; checksum?: string },
  workspaceId?: string,
): Promise<{ id: string; object_key: string | null } | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  if (opts.checksum) {
    const byChecksum = await query<{ id: string; object_key: string | null }>(
      `SELECT id, object_key FROM disclosure_documents
       WHERE workspace_id = $1 AND filing_id = $2 AND checksum = $3 LIMIT 1`,
      [ws, filingId, opts.checksum],
    );
    if (byChecksum.rows[0]) return byChecksum.rows[0];
  }
  if (opts.sourceUrl) {
    const byUrl = await query<{ id: string; object_key: string | null }>(
      `SELECT id, object_key FROM disclosure_documents
       WHERE workspace_id = $1 AND filing_id = $2 AND source_url = $3 LIMIT 1`,
      [ws, filingId, opts.sourceUrl],
    );
    if (byUrl.rows[0]) return byUrl.rows[0];
  }
  return null;
}

export async function insertDisclosureDocument(input: {
  filingId: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  sourceUrl?: string;
  objectKey?: string;
  checksum?: string;
  extractStatus?: string;
  extractMethod?: string;
}, workspaceId?: string): Promise<string> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ id: string }>(
    `INSERT INTO disclosure_documents
       (workspace_id, filing_id, file_name, mime_type, byte_size, source_url, object_key, checksum, extract_status, extract_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      ws,
      input.filingId,
      input.fileName ?? null,
      input.mimeType ?? null,
      input.byteSize ?? null,
      input.sourceUrl ?? null,
      input.objectKey ?? null,
      input.checksum ?? null,
      input.extractStatus ?? 'pending',
      input.extractMethod ?? null,
    ],
  );
  return res.rows[0]!.id;
}

export async function hasDisclosureText(filingId: string, workspaceId?: string): Promise<boolean> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ n: string }>(
    `SELECT 1 AS n FROM disclosure_texts WHERE workspace_id = $1 AND filing_id = $2 LIMIT 1`,
    [ws, filingId],
  );
  return res.rows.length > 0;
}

export async function insertDisclosureText(input: {
  filingId: string;
  documentId?: string;
  contentPlain: string;
  contentMarkdown?: string;
  extractMethod: string;
  language?: string;
}, workspaceId?: string): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await query(
    `INSERT INTO disclosure_texts
       (workspace_id, filing_id, document_id, content_plain, content_markdown, char_count, language, extract_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ws,
      input.filingId,
      input.documentId ?? null,
      input.contentPlain,
      input.contentMarkdown ?? null,
      input.contentPlain.length,
      input.language ?? 'zh',
      input.extractMethod,
    ],
  );
}

export async function getFilingById(
  filingId: string,
  workspaceId?: string,
): Promise<{
  id: string;
  symbol: string;
  company_name: string | null;
  source_doc_id: string | null;
  title: string | null;
  source_url: string | null;
  parse_status: string;
} | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{
    id: string;
    symbol: string;
    company_name: string | null;
    source_doc_id: string | null;
    title: string | null;
    source_url: string | null;
    parse_status: string;
  }>(
    `SELECT id, symbol, company_name, source_doc_id, title, source_url, parse_status
     FROM company_filings WHERE workspace_id = $1 AND id = $2`,
    [ws, filingId],
  );
  return res.rows[0] ?? null;
}

export async function listFailedFilingsForRecollect(
  mode: 'failed' | 'partial' | 'all',
  maxRetry: number,
  workspaceId?: string,
): Promise<Array<{ id: string; source_doc_id: string | null; parse_status: string }>> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  if (mode === 'all') {
    const res = await query<{ id: string; source_doc_id: string | null; parse_status: string }>(
      `SELECT id, source_doc_id, parse_status FROM company_filings
       WHERE workspace_id = $1 AND source = 'cninfo' AND source_doc_id IS NOT NULL
       ORDER BY published_at DESC NULLS LAST LIMIT 500`,
      [ws],
    );
    return res.rows;
  }
  const statuses = mode === 'partial' ? ['failed', 'partial'] : ['failed'];
  const res = await query<{ id: string; source_doc_id: string | null; parse_status: string }>(
    `SELECT id, source_doc_id, parse_status FROM company_filings
     WHERE workspace_id = $1 AND source = 'cninfo'
       AND parse_status = ANY($2::text[])
       AND retry_count < $3
     ORDER BY ingested_at ASC NULLS LAST
     LIMIT 200`,
    [ws, statuses, maxRetry],
  );
  return res.rows;
}

export async function listCninfoFilingsInRange(opts: {
  start: Date;
  end: Date;
  symbols?: string[];
  workspaceId?: string;
  limit?: number;
}): Promise<Array<{ id: string; source_doc_id: string | null; parse_status: string }>> {
  const ws = opts.workspaceId ?? getDefaultWorkspaceId();
  const limit = opts.limit ?? 500;
  const params: unknown[] = [ws, opts.start, opts.end];
  let symbolFilter = '';
  if (opts.symbols?.length) {
    const normalized = opts.symbols.map((s) => s.replace(/\D/g, '').padStart(6, '0'));
    params.push(normalized);
    symbolFilter = ` AND symbol = ANY($${params.length}::text[])`;
  }
  params.push(limit);
  const res = await query<{ id: string; source_doc_id: string | null; parse_status: string }>(
    `SELECT id, source_doc_id, parse_status FROM company_filings
     WHERE workspace_id = $1 AND source = 'cninfo' AND source_doc_id IS NOT NULL
       AND published_at >= $2 AND published_at <= $3
       ${symbolFilter}
     ORDER BY published_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows;
}

export async function listListedSecurities(opts: {
  market?: string;
  region?: string;
  limit?: number;
  workspaceId?: string;
}): Promise<EnterpriseGraphCompany[]> {
  const ws = opts.workspaceId ?? getDefaultWorkspaceId();
  const limit = opts.limit ?? 50;
  const market = opts.market;
  const region = opts.region;

  let sql = `
    SELECT s.symbol, s.display_symbol, s.name, s.market, s.region_keys, s.exchange,
           s.props_json, c.sector, c.short_name
    FROM listed_securities s
    JOIN listed_companies c ON c.id = s.company_id
    WHERE s.workspace_id = $1`;
  const params: unknown[] = [ws];

  if (market) {
    params.push(market);
    sql += ` AND s.market = $${params.length}`;
  }
  if (region && region !== 'global') {
    params.push(region);
    sql += ` AND $${params.length} = ANY(s.region_keys)`;
  }
  params.push(limit);
  sql += ` ORDER BY s.updated_at DESC LIMIT $${params.length}`;

  const res = await query<{
    symbol: string;
    display_symbol: string | null;
    name: string | null;
    market: string;
    region_keys: string[];
    exchange: string;
    sector: string | null;
    short_name: string | null;
  }>(sql, params);

  return res.rows.map((row) => ({
    symbol: row.symbol,
    name: row.name ?? row.short_name ?? row.symbol,
    display: row.display_symbol ?? row.symbol,
    market: row.market as EnterpriseGraphMarketId,
    regions: row.region_keys as EnterpriseGraphCompany['regions'],
    sector: row.sector ?? undefined,
  }));
}

export async function findListedSecurityBySymbol(
  symbol: string,
  market?: string,
  workspaceId?: string,
): Promise<(ListedSecurityRow & { company_name: string | null }) | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const sym = symbol.replace(/\D/g, '').padStart(6, '0');
  let sql = `
    SELECT s.*, c.short_name AS company_name
    FROM listed_securities s
    JOIN listed_companies c ON c.id = s.company_id
    WHERE s.workspace_id = $1 AND s.symbol = $2`;
  const params: unknown[] = [ws, sym];
  if (market) {
    params.push(market);
    sql += ` AND s.market = $${params.length}`;
  }
  sql += ' LIMIT 1';
  const res = await query<ListedSecurityRow & { company_name: string | null }>(sql, params);
  return res.rows[0] ?? null;
}

export async function upsertKgCompanyFromSecurity(
  security: ListedSecurityRow & { company_name: string | null },
  workspaceId?: string,
): Promise<string> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const externalKey = companyExternalKey(security.market, security.exchange, security.symbol);
  const res = await query<{ id: string }>(
    `INSERT INTO kg_entities (workspace_id, entity_type, external_key, name, props_json)
     VALUES ($1, 'company', $2, $3, $4)
     ON CONFLICT (workspace_id, entity_type, external_key) DO UPDATE SET
       name = EXCLUDED.name,
       props_json = EXCLUDED.props_json,
       updated_at = NOW()
     RETURNING id`,
    [
      ws,
      externalKey,
      security.name ?? security.company_name ?? security.symbol,
      JSON.stringify({
        symbol: security.symbol,
        market: security.market,
        exchange: security.exchange,
        country_code: security.country_code,
        region_keys: security.region_keys,
      }),
    ],
  );
  return res.rows[0]!.id;
}

export async function upsertKgFilingAndEdge(input: {
  market: string;
  source: string;
  sourceDocId: string;
  title: string;
  companyEntityId: string;
  publishedAt?: Date;
}, workspaceId?: string): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const filingKey = `filing:${input.market}:${input.source}:${input.sourceDocId}`;

  const filingEntity = await query<{ id: string }>(
    `INSERT INTO kg_entities (workspace_id, entity_type, external_key, name, props_json)
     VALUES ($1, 'filing', $2, $3, $4)
     ON CONFLICT (workspace_id, entity_type, external_key) DO UPDATE SET
       name = EXCLUDED.name,
       props_json = EXCLUDED.props_json,
       updated_at = NOW()
     RETURNING id`,
    [
      ws,
      filingKey,
      input.title.slice(0, 200),
      JSON.stringify({
        source: input.source,
        source_doc_id: input.sourceDocId,
        published_at: input.publishedAt?.toISOString(),
      }),
    ],
  );
  const filingId = filingEntity.rows[0]!.id;

  await query(
    `INSERT INTO kg_edges (workspace_id, from_entity_id, to_entity_id, relation_type, props_json)
     VALUES ($1, $2, $3, 'filed', '{}')
     ON CONFLICT (workspace_id, from_entity_id, to_entity_id, relation_type) DO NOTHING`,
    [ws, input.companyEntityId, filingId],
  );
}

export async function updateFilingParseStatus(
  filingId: string,
  status: string,
  opts?: { parseMethod?: string; errorMessage?: string; incrementRetry?: boolean },
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await query(
    `UPDATE company_filings SET
       parse_status = $3,
       parse_method = COALESCE($4, parse_method),
       error_message = $5,
       retry_count = CASE WHEN $6 THEN retry_count + 1 ELSE retry_count END
     WHERE workspace_id = $1 AND id = $2`,
    [
      ws,
      filingId,
      status,
      opts?.parseMethod ?? null,
      opts?.errorMessage ?? null,
      opts?.incrementRetry ?? false,
    ],
  );
}
