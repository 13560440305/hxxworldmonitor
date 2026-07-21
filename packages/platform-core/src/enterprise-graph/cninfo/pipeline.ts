import { buildColdObjectKey, isStorageEnabled, uploadColdObject } from '@hxxworldmonitor/shared/blob-store.js';
import type { JobContext } from '../../jobs/types.js';
import { getJobCheckpoint } from '../../jobs/job-checkpoint.js';
import type { ResolvedEngine } from '../../engines-repository.js';
import { getGeoDefaults } from '../geo.js';
import {
  findDisclosureDocumentByUrlOrChecksum,
  findFilingBySourceDoc,
  findListedSecurityBySymbol,
  getDisclosureTextPlain,
  getFilingById,
  hasDisclosureText,
  insertDisclosureDocument,
  insertDisclosureFiling,
  insertDisclosureText,
  listFailedFilingsForRecollect,
  listCninfoFilingsInRange,
  listFilingsWithDisclosureText,
  filingHasExtractedRelations,
  updateFilingParseStatus,
  upsertKgCompanyFromSecurity,
  upsertKgExtractedRelations,
  upsertKgFilingAndEdge,
} from '../listed-companies-repository.js';
import {
  announcementPublishedAt,
  buildAdjunctDownloadUrl,
  CNINFO_SOURCE,
  listCninfoAnnouncementsInRange,
  type CninfoAnnouncement,
} from './client.js';
import { downloadAdjunctPdf } from './downloader.js';
import { extractDisclosureText } from './extractor.js';
import { upsertMasterFromAnnouncement } from './master-data.js';
import { extractDisclosureRelationsHybrid } from './relation-extract-llm.js';

declare const process: { env: Record<string, string | undefined> };

const HANDLER_KEY = 'disclosure-ingest-cn';
const MAX_RETRY = Number(process.env.CNINFO_MAX_PARSE_RETRY ?? 5);
const DEFAULT_LOOKBACK_DAYS = Number(process.env.CNINFO_DEFAULT_LOOKBACK_DAYS ?? 1);

export interface CninfoPipelineConfig {
  cninfoBaseUrl: string;
  engine: ResolvedEngine | null;
  workspaceId: string;
}

export interface CninfoPipelineStats {
  status: 'ok' | 'error';
  market: 'cn';
  listed: number;
  filingsNew: number;
  skippedExisting: number;
  downloaded: number;
  extracted: number;
  failed: number;
  forced: number;
  relationsExtracted: number;
  entitiesUpserted: number;
  edgesUpserted: number;
  lastAnnTime?: string;
  message?: string;
}

interface PipelinePayload {
  force?: boolean;
  recollect?: 'failed' | 'partial' | 'all';
  since?: string;
  lookbackDays?: number;
  symbols?: string[];
}

function parsePayload(payload: Record<string, unknown>): PipelinePayload {
  return {
    force: payload.force === true,
    recollect:
      payload.recollect === 'failed' || payload.recollect === 'partial' || payload.recollect === 'all'
        ? payload.recollect
        : undefined,
    since: typeof payload.since === 'string' ? payload.since : undefined,
    lookbackDays: typeof payload.lookbackDays === 'number' ? payload.lookbackDays : undefined,
    symbols: Array.isArray(payload.symbols) ? payload.symbols.map(String) : undefined,
  };
}

function resolveDateWindow(
  payload: PipelinePayload,
  checkpointLastAnn?: string,
): { start: Date; end: Date } {
  const end = new Date();
  const lookbackDays = payload.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  if (payload.since) {
    const since = new Date(payload.since);
    if (!Number.isNaN(since.getTime())) {
      return { start: since, end };
    }
  }

  const ignoreCheckpoint = payload.force || payload.recollect === 'all';
  if (!ignoreCheckpoint && checkpointLastAnn) {
    const cp = new Date(checkpointLastAnn);
    if (!Number.isNaN(cp.getTime())) {
      return { start: cp, end };
    }
  }

  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return { start, end };
}

function shouldSkipFiling(
  existing: { parse_status: string; retry_count: number } | null,
  payload: PipelinePayload,
): boolean {
  if (!existing) return false;
  if (payload.force || payload.recollect === 'all') return false;
  if (payload.recollect === 'failed') {
    return existing.parse_status !== 'failed' || existing.retry_count >= MAX_RETRY;
  }
  if (payload.recollect === 'partial') {
    if (existing.parse_status === 'failed' && existing.retry_count < MAX_RETRY) return false;
    if (existing.parse_status === 'partial') return false;
    return existing.parse_status === 'extracted';
  }
  return existing.parse_status === 'extracted' || existing.parse_status === 'partial';
}

function adjunctPathFromUrl(sourceUrl: string | null | undefined): string | undefined {
  if (!sourceUrl) return undefined;
  const marker = 'static.cninfo.com.cn/';
  const idx = sourceUrl.indexOf(marker);
  if (idx >= 0) return sourceUrl.slice(idx + marker.length);
  return sourceUrl.replace(/^https?:\/\/[^/]+\//, '');
}

export async function runCninfoDisclosurePipeline(
  ctx: JobContext,
  config: CninfoPipelineConfig,
): Promise<CninfoPipelineStats> {
  const payload = parsePayload(ctx.payload);
  const stats: CninfoPipelineStats = {
    status: 'ok',
    market: 'cn',
    listed: 0,
    filingsNew: 0,
    skippedExisting: 0,
    downloaded: 0,
    extracted: 0,
    failed: 0,
    forced: payload.force || Boolean(payload.recollect) ? 1 : 0,
    relationsExtracted: 0,
    entitiesUpserted: 0,
    edgesUpserted: 0,
  };

  const checkpoint = await getJobCheckpoint(HANDLER_KEY, config.workspaceId);
  const cpStats = checkpoint?.stats;
  const lastAnnTime =
    typeof cpStats?.lastAnnTime === 'string'
      ? cpStats.lastAnnTime
      : undefined;

  let maxAnnTimeMs = lastAnnTime ? new Date(lastAnnTime).getTime() : 0;

  if (payload.recollect && payload.recollect !== 'all') {
    await reprocessFailedFilings(ctx, config, payload, stats);
    stats.lastAnnTime = maxAnnTimeMs > 0 ? new Date(maxAnnTimeMs).toISOString() : lastAnnTime;
    return stats;
  }

  const { start, end } = resolveDateWindow(payload, lastAnnTime);
  const announcements = await listCninfoAnnouncementsInRange({
    baseUrl: config.cninfoBaseUrl,
    seDateStart: start,
    seDateEnd: end,
    symbols: payload.symbols,
    signal: ctx.signal,
  });

  for (const ann of announcements) {
    if (ann.announcementTime > maxAnnTimeMs) maxAnnTimeMs = ann.announcementTime;

    try {
      const master = await upsertMasterFromAnnouncement(ann, config.workspaceId);
      stats.listed += 1;

      const existing = await findFilingBySourceDoc(CNINFO_SOURCE, ann.announcementId, config.workspaceId);
      if (shouldSkipFiling(existing, payload)) {
        stats.skippedExisting += 1;
        continue;
      }

      const geo = getGeoDefaults('cn');
      let filingId = existing?.id;

      if (!filingId) {
        const newId = await insertDisclosureFiling(
          {
            companyId: master.companyId,
            securityId: master.securityId,
            symbol: master.symbol,
            companyName: ann.secName,
            market: 'cn',
            exchange: master.exchange,
            countryCode: geo.countryCode,
            source: CNINFO_SOURCE,
            sourceDocId: ann.announcementId,
            title: ann.announcementTitle,
            category: ann.pageColumn,
            sourceUrl: ann.adjunctUrl ? buildAdjunctDownloadUrl(ann.adjunctUrl) : undefined,
            publishedAt: announcementPublishedAt(ann),
          },
          config.workspaceId,
        );
        if (!newId) {
          const again = await findFilingBySourceDoc(CNINFO_SOURCE, ann.announcementId, config.workspaceId);
          filingId = again?.id;
          if (!filingId) {
            stats.skippedExisting += 1;
            continue;
          }
        } else {
          filingId = newId;
          stats.filingsNew += 1;
        }
      }

      await processFilingDownloadExtract({
        filingId: filingId!,
        ann,
        cninfoBaseUrl: config.cninfoBaseUrl,
        config,
        payload,
        stats,
        signal: ctx.signal,
      });
    } catch {
      stats.failed += 1;
    }
  }

  if (maxAnnTimeMs > 0) {
    stats.lastAnnTime = new Date(maxAnnTimeMs).toISOString();
  } else if (lastAnnTime) {
    stats.lastAnnTime = lastAnnTime;
  }

  if (payload.force && !payload.recollect && announcements.length === 0) {
    await reprocessFilingsInWindow(ctx, config, payload, start, end, stats);
  }

  return stats;
}

async function reprocessFilingsInWindow(
  ctx: JobContext,
  config: CninfoPipelineConfig,
  payload: PipelinePayload,
  start: Date,
  end: Date,
  stats: CninfoPipelineStats,
): Promise<void> {
  const rows = await listCninfoFilingsInRange({
    start,
    end,
    symbols: payload.symbols,
    workspaceId: config.workspaceId,
    limit: 500,
  });

  for (const row of rows) {
    const filing = await getFilingById(row.id, config.workspaceId);
    if (!filing?.source_doc_id) continue;

    const adjunctUrl = adjunctPathFromUrl(filing.source_url);
    const ann: CninfoAnnouncement = {
      announcementId: filing.source_doc_id,
      secCode: filing.symbol,
      secName: filing.company_name ?? filing.symbol,
      orgId: filing.symbol,
      announcementTitle: filing.title ?? filing.source_doc_id,
      announcementTime: 0,
      adjunctUrl,
    };

    try {
      await processFilingDownloadExtract({
        filingId: row.id,
        ann,
        cninfoBaseUrl: config.cninfoBaseUrl,
        config,
        payload: { ...payload, force: true },
        stats,
        signal: ctx.signal,
      });
    } catch {
      stats.failed += 1;
    }
  }
}

async function reprocessFailedFilings(
  ctx: JobContext,
  config: CninfoPipelineConfig,
  payload: PipelinePayload,
  stats: CninfoPipelineStats,
): Promise<void> {
  const rows = await listFailedFilingsForRecollect(
    payload.recollect!,
    MAX_RETRY,
    config.workspaceId,
    payload.symbols,
  );
  for (const row of rows) {
    const filing = await getFilingById(row.id, config.workspaceId);
    if (!filing?.source_doc_id) continue;

    const adjunctUrl = adjunctPathFromUrl(filing.source_url);
    const ann: CninfoAnnouncement = {
      announcementId: filing.source_doc_id,
      secCode: filing.symbol,
      secName: filing.company_name ?? filing.symbol,
      orgId: filing.symbol,
      announcementTitle: filing.title ?? filing.source_doc_id,
      announcementTime: 0,
      adjunctUrl,
    };

    try {
      await processFilingDownloadExtract({
        filingId: row.id,
        ann,
        cninfoBaseUrl: config.cninfoBaseUrl,
        config,
        payload: { ...payload, force: true },
        stats,
        signal: ctx.signal,
      });
    } catch {
      stats.failed += 1;
    }
  }
}

async function processFilingDownloadExtract(opts: {
  filingId: string;
  ann: CninfoAnnouncement;
  cninfoBaseUrl: string;
  config: CninfoPipelineConfig;
  payload: PipelinePayload;
  stats: CninfoPipelineStats;
  signal?: AbortSignal;
}): Promise<void> {
  const { filingId, ann, cninfoBaseUrl, config, payload, stats, signal } = opts;
  const force = payload.force || Boolean(payload.recollect);

  if (!ann.adjunctUrl) {
    await updateFilingParseStatus(filingId, 'partial', { parseMethod: 'metadata_only' }, config.workspaceId);
    await upsertKgForFiling(filingId, ann, config, stats);
    return;
  }

  const sourceUrl = buildAdjunctDownloadUrl(ann.adjunctUrl);
  const hasText = await hasDisclosureText(filingId, config.workspaceId);
  const existingDoc = await findDisclosureDocumentByUrlOrChecksum(filingId, { sourceUrl }, config.workspaceId);

  if (!force && hasText && existingDoc?.object_key) {
    await updateFilingParseStatus(filingId, 'extracted', undefined, config.workspaceId);
    await upsertKgForFiling(filingId, ann, config, stats);
    return;
  }

  let documentId = existingDoc?.id;
  let downloadMethod = 'direct_http';

  if (!existingDoc?.object_key || force) {
    try {
      const download = await downloadAdjunctPdf({
        adjunctUrl: ann.adjunctUrl,
        engine: config.engine,
        signal,
      });
      downloadMethod = download.method;

      let objectKey: string | undefined;
      if (isStorageEnabled()) {
        objectKey = buildColdObjectKey('disclosure', filingId, 'pdf');
        await uploadColdObject(objectKey, download.buffer, download.mimeType);
      }

      if (!documentId) {
        documentId = await insertDisclosureDocument(
          {
            filingId,
            fileName: ann.adjunctUrl.split('/').pop(),
            mimeType: download.mimeType,
            byteSize: download.byteSize,
            sourceUrl: download.sourceUrl,
            objectKey,
            checksum: download.checksum,
            extractStatus: 'pending',
            extractMethod: download.method,
          },
          config.workspaceId,
        );
      }
      stats.downloaded += 1;

      if (!force && hasText) {
        await upsertKgForFiling(filingId, ann, config, stats);
        return;
      }

      try {
        const detailUrl = `${cninfoBaseUrl.replace(/\/+$/, '')}/new/disclosure/detail?announcementId=${ann.announcementId}`;
        const extracted = await extractDisclosureText({
          download,
          detailUrl,
          engine: config.engine,
          signal,
        });
        await insertDisclosureText(
          {
            filingId,
            documentId,
            contentPlain: extracted.plainText,
            contentMarkdown: extracted.markdown,
            extractMethod: extracted.method,
          },
          config.workspaceId,
        );
        await updateFilingParseStatus(
          filingId,
          extracted.charCount > 100 ? 'extracted' : 'partial',
          { parseMethod: extracted.method },
          config.workspaceId,
        );
        stats.extracted += 1;
      } catch (extractErr) {
        await updateFilingParseStatus(
          filingId,
          'failed',
          {
            parseMethod: downloadMethod,
            errorMessage: extractErr instanceof Error ? extractErr.message : String(extractErr),
            incrementRetry: true,
          },
          config.workspaceId,
        );
        stats.failed += 1;
      }
    } catch (dlErr) {
      await updateFilingParseStatus(
        filingId,
        'failed',
        {
          parseMethod: downloadMethod,
          errorMessage: dlErr instanceof Error ? dlErr.message : String(dlErr),
          incrementRetry: true,
        },
        config.workspaceId,
      );
      stats.failed += 1;
    }
  }

  await upsertKgForFiling(filingId, ann, config, stats);
}

async function extractAndUpsertRelations(opts: {
  filingId: string;
  ann: CninfoAnnouncement;
  plainText: string;
  config: CninfoPipelineConfig;
  stats: CninfoPipelineStats;
  useLlm?: boolean;
  force?: boolean;
}): Promise<void> {
  const { filingId, ann, plainText, config, stats } = opts;
  if (!opts.force && (await filingHasExtractedRelations(filingId, config.workspaceId))) {
    return;
  }

  const { relations } = await extractDisclosureRelationsHybrid({
    plainText,
    companyName: ann.secName,
    useLlm: opts.useLlm === true,
  });
  if (!relations.length) return;

  const sym = ann.secCode ? ann.secCode.replace(/\D/g, '').padStart(6, '0') : null;
  if (!sym) return;
  const security = await findListedSecurityBySymbol(sym, 'cn', config.workspaceId);
  if (!security) return;

  const companyEntityId = await upsertKgCompanyFromSecurity(security, config.workspaceId);
  const result = await upsertKgExtractedRelations({
    companyEntityId,
    filingId,
    sourceDocId: ann.announcementId,
    market: 'cn',
    relations,
    workspaceId: config.workspaceId,
  });
  stats.relationsExtracted += relations.length;
  stats.entitiesUpserted += result.entitiesUpserted;
  stats.edgesUpserted += result.edgesUpserted;
}

async function upsertKgForFiling(
  filingId: string,
  ann: CninfoAnnouncement,
  config: CninfoPipelineConfig,
  stats: CninfoPipelineStats,
): Promise<void> {
  const sym = ann.secCode ? ann.secCode.replace(/\D/g, '').padStart(6, '0') : null;
  if (!sym) return;

  const security = await findListedSecurityBySymbol(sym, 'cn', config.workspaceId);
  if (!security) return;

  const companyEntityId = await upsertKgCompanyFromSecurity(security, config.workspaceId);
  stats.entitiesUpserted += 1;

  await upsertKgFilingAndEdge(
    {
      market: 'cn',
      source: CNINFO_SOURCE,
      sourceDocId: ann.announcementId,
      title: ann.announcementTitle,
      companyEntityId,
      publishedAt: ann.announcementTime > 0 ? new Date(ann.announcementTime) : undefined,
    },
    config.workspaceId,
  );
  stats.edgesUpserted += 1;

  // When text already exists (skip re-download path), still try relation extract once.
  const plain = await getDisclosureTextPlain(filingId, config.workspaceId);
  if (plain) {
    await extractAndUpsertRelations({
      filingId,
      ann,
      plainText: plain,
      config,
      stats,
    });
  }
}

/** Batch: extract relations from already-stored disclosure texts (no re-download). */
export async function runDisclosureRelationExtractBatch(opts: {
  workspaceId: string;
  symbols?: string[];
  limit?: number;
  useLlm?: boolean;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<{
  status: 'ok';
  scanned: number;
  skipped: number;
  relationsExtracted: number;
  entitiesUpserted: number;
  edgesUpserted: number;
  method: 'rule' | 'rule+llm';
}> {
  const rows = await listFilingsWithDisclosureText({
    limit: opts.limit ?? 100,
    symbols: opts.symbols,
    workspaceId: opts.workspaceId,
    skipAlreadyExtracted: opts.force !== true,
  });

  let relationsExtracted = 0;
  let entitiesUpserted = 0;
  let edgesUpserted = 0;
  let method: 'rule' | 'rule+llm' = 'rule';

  for (const row of rows) {
    if (opts.signal?.aborted) break;

    const hybrid = await extractDisclosureRelationsHybrid({
      plainText: row.contentPlain,
      companyName: row.title ?? row.symbol,
      useLlm: opts.useLlm === true,
    });
    if (hybrid.method === 'rule+llm') method = 'rule+llm';
    if (!hybrid.relations.length) continue;

    const security = await findListedSecurityBySymbol(row.symbol, 'cn', opts.workspaceId);
    if (!security) continue;
    const companyEntityId = await upsertKgCompanyFromSecurity(security, opts.workspaceId);
    const result = await upsertKgExtractedRelations({
      companyEntityId,
      filingId: row.filingId,
      sourceDocId: row.sourceDocId,
      market: 'cn',
      relations: hybrid.relations,
      workspaceId: opts.workspaceId,
    });
    relationsExtracted += hybrid.relations.length;
    entitiesUpserted += result.entitiesUpserted;
    edgesUpserted += result.edgesUpserted;
  }

  return {
    status: 'ok',
    scanned: rows.length,
    skipped: 0,
    relationsExtracted,
    entitiesUpserted,
    edgesUpserted,
    method,
  };
}
