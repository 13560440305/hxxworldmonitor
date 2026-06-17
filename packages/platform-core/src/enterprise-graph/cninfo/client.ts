import { CNINFO_DISCLOSURE_PATHS } from '../../ingest-plugins/cninfo-disclosure.js';
import { inferCnExchange } from '../geo.js';

export const CNINFO_SOURCE = 'cninfo';
export const CNINFO_STATIC_HOST = 'https://static.cninfo.com.cn';

export interface CninfoAnnouncement {
  announcementId: string;
  secCode: string;
  secName: string;
  orgId: string;
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl?: string;
  adjunctSize?: number;
  adjunctType?: string;
  columnId?: string;
  pageColumn?: string;
}

export interface CninfoSearchResponse {
  announcements: CninfoAnnouncement[];
  totalAnnouncement: number;
  totalRecordNum: number;
  hasMore: boolean;
  totalpages: number;
}

function formatSeDate(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(start)}~${fmt(end)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildHeaders(baseUrl: string): Record<string, string> {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: normalizeBaseUrl(baseUrl),
    Referer: `${normalizeBaseUrl(baseUrl)}/`,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };
}

function parseAnnouncement(raw: Record<string, unknown>): CninfoAnnouncement | null {
  const announcementId = String(raw.announcementId ?? raw.announcementid ?? '').trim();
  const secCode = String(raw.secCode ?? raw.seccode ?? '').trim();
  const secName = String(raw.secName ?? raw.secname ?? '').trim();
  const orgId = String(raw.orgId ?? raw.orgid ?? '').trim();
  const title = String(raw.announcementTitle ?? raw.announcementtitle ?? '').trim();
  const annTime = Number(raw.announcementTime ?? raw.announcementtime ?? 0);
  if (!announcementId || !secCode || !orgId) return null;
  return {
    announcementId,
    secCode,
    secName: secName || secCode,
    orgId,
    announcementTitle: title || announcementId,
    announcementTime: Number.isFinite(annTime) ? annTime : 0,
    adjunctUrl: raw.adjunctUrl ? String(raw.adjunctUrl) : raw.adjuncturl ? String(raw.adjuncturl) : undefined,
    adjunctSize: raw.adjunctSize ? Number(raw.adjunctSize) : undefined,
    adjunctType: raw.adjunctType ? String(raw.adjunctType) : undefined,
    columnId: raw.columnId ? String(raw.columnId) : undefined,
    pageColumn: raw.pageColumn ? String(raw.pageColumn) : undefined,
  };
}

function cninfoColumnForSymbol(symbol?: string): string {
  if (!symbol) return 'szse';
  const exchange = inferCnExchange(symbol.replace(/\D/g, '').padStart(6, '0'));
  if (exchange === 'SSE') return 'sse';
  if (exchange === 'BSE') return 'bj';
  return 'szse';
}

export async function searchCninfoAnnouncements(opts: {
  baseUrl: string;
  seDateStart: Date;
  seDateEnd: Date;
  pageNum?: number;
  pageSize?: number;
  stock?: string;
  signal?: AbortSignal;
}): Promise<CninfoSearchResponse> {
  const base = normalizeBaseUrl(opts.baseUrl);
  const path = CNINFO_DISCLOSURE_PATHS.announcementSearch;
  const url = `${base}${path}`;

  const stockCode = opts.stock ? opts.stock.replace(/\D/g, '').padStart(6, '0') : '';
  // CNINFO `stock` param is unreliable; `searchkey` filters by secCode correctly.
  const body = new URLSearchParams({
    pageNum: String(opts.pageNum ?? 1),
    pageSize: String(opts.pageSize ?? 30),
    column: cninfoColumnForSymbol(stockCode || undefined),
    tabName: 'fulltext',
    plate: '',
    stock: '',
    searchkey: stockCode,
    secid: '',
    category: '',
    trade: '',
    seDate: formatSeDate(opts.seDateStart, opts.seDateEnd),
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(base),
    body,
    signal: opts.signal,
  });

  if (!resp.ok) {
    throw new Error(`CNINFO search failed: HTTP ${resp.status}`);
  }

  const json = (await resp.json()) as Record<string, unknown>;
  const rawList = (json.announcements ?? json.records ?? []) as Record<string, unknown>[];
  const announcements = rawList
    .map((row) => parseAnnouncement(row))
    .filter((row): row is CninfoAnnouncement => row !== null);

  const totalAnnouncement = Number(json.totalAnnouncement ?? json.totalannouncement ?? announcements.length);
  const totalpages = Number(json.totalpages ?? json.totalPages ?? 1);
  const hasMore = Number(opts.pageNum ?? 1) < totalpages;

  return {
    announcements,
    totalAnnouncement,
    totalRecordNum: Number(json.totalRecordNum ?? totalAnnouncement),
    hasMore,
    totalpages,
  };
}

export async function listCninfoAnnouncementsInRange(opts: {
  baseUrl: string;
  seDateStart: Date;
  seDateEnd: Date;
  pageSize?: number;
  symbols?: string[];
  signal?: AbortSignal;
  onPage?: (page: CninfoAnnouncement[]) => void;
}): Promise<CninfoAnnouncement[]> {
  const pageSize = opts.pageSize ?? 30;
  const symbols = opts.symbols?.map((s) => s.replace(/\D/g, '').padStart(6, '0')).filter(Boolean);

  if (symbols && symbols.length > 0) {
    const all: CninfoAnnouncement[] = [];
    for (const stock of symbols) {
      let pageNum = 1;
      let hasMore = true;
      while (hasMore) {
        const page = await searchCninfoAnnouncements({
          baseUrl: opts.baseUrl,
          seDateStart: opts.seDateStart,
          seDateEnd: opts.seDateEnd,
          pageNum,
          pageSize,
          stock,
          signal: opts.signal,
        });
        all.push(...page.announcements);
        opts.onPage?.(page.announcements);
        hasMore = page.hasMore;
        pageNum += 1;
        if (pageNum > 200) break;
      }
    }
    return all;
  }

  const all: CninfoAnnouncement[] = [];
  let pageNum = 1;
  let hasMore = true;
  while (hasMore) {
    const page = await searchCninfoAnnouncements({
      baseUrl: opts.baseUrl,
      seDateStart: opts.seDateStart,
      seDateEnd: opts.seDateEnd,
      pageNum,
      pageSize,
      signal: opts.signal,
    });
    all.push(...page.announcements);
    opts.onPage?.(page.announcements);
    hasMore = page.hasMore;
    pageNum += 1;
    if (pageNum > 500) break;
  }
  return all;
}

export function buildAdjunctDownloadUrl(adjunctUrl: string): string {
  const path = adjunctUrl.replace(/^\/+/, '');
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${CNINFO_STATIC_HOST}/${path}`;
}

export function announcementPublishedAt(ann: CninfoAnnouncement): Date {
  if (ann.announcementTime > 0) return new Date(ann.announcementTime);
  return new Date();
}
