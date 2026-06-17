import { createHash } from 'node:crypto';
import { buildAdjunctDownloadUrl } from './client.js';
import type { ResolvedEngine } from '../../engines-repository.js';
import { firecrawlScrapeUrl } from './firecrawl.js';

export interface DownloadResult {
  buffer: Buffer;
  sourceUrl: string;
  checksum: string;
  byteSize: number;
  mimeType: string;
  method: 'direct_http' | 'firecrawl';
}

const PDF_HEADERS: Record<string, string> = {
  Accept: 'application/pdf,*/*',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Referer: 'https://www.cninfo.com.cn/',
};

export async function downloadAdjunctPdf(opts: {
  adjunctUrl: string;
  engine?: ResolvedEngine | null;
  signal?: AbortSignal;
}): Promise<DownloadResult> {
  const sourceUrl = buildAdjunctDownloadUrl(opts.adjunctUrl);

  try {
    const buffer = await directDownload(sourceUrl, opts.signal);
    return finalizeBuffer(buffer, sourceUrl, 'direct_http');
  } catch (directErr) {
    if (!opts.engine?.apiKey) throw directErr;
    const scraped = await firecrawlScrapeUrl(opts.engine, sourceUrl, opts.signal);
    const markdown = scraped.markdown ?? '';
    if (markdown.trim().length > 0) {
      const buffer = Buffer.from(markdown, 'utf8');
      return finalizeBuffer(buffer, sourceUrl, 'firecrawl', 'text/markdown');
    }
    throw directErr instanceof Error ? directErr : new Error(String(directErr));
  }
}

async function directDownload(url: string, signal?: AbortSignal): Promise<Buffer> {
  const resp = await fetch(url, { headers: PDF_HEADERS, signal });
  if (!resp.ok) {
    throw new Error(`Direct download failed: HTTP ${resp.status} for ${url}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.byteLength < 64) {
    throw new Error(`Download too small (${buffer.byteLength} bytes)`);
  }
  return buffer;
}

function finalizeBuffer(
  buffer: Buffer,
  sourceUrl: string,
  method: 'direct_http' | 'firecrawl',
  mimeType = 'application/pdf',
): DownloadResult {
  const checksum = createHash('sha256').update(buffer).digest('hex');
  return {
    buffer,
    sourceUrl,
    checksum,
    byteSize: buffer.byteLength,
    mimeType,
    method,
  };
}
