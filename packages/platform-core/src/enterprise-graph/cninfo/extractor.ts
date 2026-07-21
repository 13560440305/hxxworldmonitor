import type { DownloadResult } from './downloader.js';
import type { FirecrawlScrapeResult } from './firecrawl.js';
import type { ResolvedEngine } from '../../engines-repository.js';
import { firecrawlScrapeUrl } from './firecrawl.js';

declare const process: {
  stdout: { write: (...args: unknown[]) => unknown };
  stderr: { write: (...args: unknown[]) => unknown };
};
declare const console: {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export interface ExtractResult {
  plainText: string;
  markdown?: string;
  method: 'pdf_text' | 'firecrawl' | 'direct_http';
  charCount: number;
}

export async function extractDisclosureText(opts: {
  download: DownloadResult;
  detailUrl?: string;
  engine?: ResolvedEngine | null;
  signal?: AbortSignal;
}): Promise<ExtractResult> {
  if (opts.download.mimeType === 'text/markdown') {
    const plain = opts.download.buffer.toString('utf8');
    return {
      plainText: plain,
      markdown: plain,
      method: 'firecrawl',
      charCount: plain.length,
    };
  }

  const pdfText = await tryPdfParse(opts.download.buffer);
  if (pdfText && pdfText.trim().length > 50) {
    return {
      plainText: pdfText,
      method: 'pdf_text',
      charCount: pdfText.length,
    };
  }

  if (opts.detailUrl && opts.engine?.apiKey) {
    const scraped = await firecrawlScrapeUrl(opts.engine, opts.detailUrl, opts.signal);
    const fromScrape = textFromFirecrawl(scraped);
    if (fromScrape.length > 50) {
      return {
        plainText: fromScrape,
        markdown: scraped.markdown,
        method: 'firecrawl',
        charCount: fromScrape.length,
      };
    }
  }

  if (pdfText && pdfText.trim().length > 0) {
    return {
      plainText: pdfText,
      method: 'pdf_text',
      charCount: pdfText.length,
    };
  }

  throw new Error('Unable to extract text from disclosure document');
}

/** Benign pdf.js font/table noise when parsing CNINFO disclosure PDFs. */
function isPdfJsParseNoise(message: string): boolean {
  return (
    /Warning:\s*TT:/i.test(message)
    || /Warning:\s*FormatError:/i.test(message)
    || /^TT:/i.test(message)
    || /FormatError:/i.test(message)
    || /Required ["']loca["'] table/i.test(message)
    || /undefined function:\s*\d+/i.test(message)
    || /getPathGenerator/i.test(message)
  );
}

function silencePdfJsConsole<T>(fn: () => Promise<T>): Promise<T> {
  const prevLog = console.log;
  const prevWarn = console.warn;
  const prevError = console.error;
  const filter = (...args: unknown[]): boolean => {
    const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
    return !isPdfJsParseNoise(msg);
  };
  // pdf.js emits font noise via console.log('Warning: …'), not warn/error.
  console.log = (...args: unknown[]) => {
    if (filter(...args)) prevLog.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    if (filter(...args)) prevWarn.apply(console, args);
  };
  console.error = (...args: unknown[]) => {
    if (filter(...args)) prevError.apply(console, args);
  };

  const patchStream = (stream: { write: (...args: unknown[]) => unknown }) => {
    const prevWrite = stream.write.bind(stream);
    stream.write = (chunk: unknown, ...rest: unknown[]) => {
      const text =
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : chunk instanceof Uint8Array
              ? Buffer.from(chunk).toString('utf8')
              : String(chunk);
      if (isPdfJsParseNoise(text)) return true;
      return prevWrite(chunk, ...rest);
    };
    return prevWrite;
  };

  const prevStdoutWrite = patchStream(process.stdout);
  const prevStderrWrite = patchStream(process.stderr);

  return fn().finally(() => {
    console.log = prevLog;
    console.warn = prevWarn;
    console.error = prevError;
    process.stdout.write = prevStdoutWrite;
    process.stderr.write = prevStderrWrite;
  });
}

async function tryPdfParse(buffer: Buffer): Promise<string | null> {
  try {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = mod.default ?? mod;
    return await silencePdfJsConsole(async () => {
      const result = await pdfParse(buffer);
      return typeof result.text === 'string' ? result.text : null;
    });
  } catch {
    return null;
  }
}

function textFromFirecrawl(scraped: FirecrawlScrapeResult): string {
  if (scraped.markdown && scraped.markdown.trim()) return scraped.markdown.trim();
  if (scraped.html) return stripHtml(scraped.html);
  if (scraped.rawHtml) return stripHtml(scraped.rawHtml);
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
