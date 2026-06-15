import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const process: {
  env: Record<string, string | undefined>;
  pid: number;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface PlatformLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, err?: unknown, meta?: Record<string, unknown>): void;
}

export interface LogFileInfo {
  service: string;
  date: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

import { findMonorepoRoot } from './load-env.ts';

function projectRoot(): string {
  return findMonorepoRoot();
}

export function getPlatformLogDir(): string {
  const configured = process.env.PLATFORM_LOG_DIR?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(projectRoot(), configured);
  }
  return path.join(projectRoot(), 'logs');
}

function parseLogLevel(): LogLevel {
  const raw = process.env.PLATFORM_LOG_LEVEL?.trim().toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

function logToFileEnabled(): boolean {
  const raw = process.env.PLATFORM_LOG_TO_FILE?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function logToConsoleEnabled(): boolean {
  const raw = process.env.PLATFORM_LOG_TO_CONSOLE?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function logFilePath(service: string, date = todayDate()): string {
  return path.join(getPlatformLogDir(), service, `${date}.log`);
}

function ensureLogDir(service: string): void {
  const dir = path.join(getPlatformLogDir(), service);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function serializeMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [meta-unserializable]';
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack?.split('\n').slice(1).join(' | ') ?? '';
    return stack ? `${err.message} :: ${stack}` : err.message;
  }
  return String(err);
}

function writeLine(
  service: string,
  level: LogLevel,
  line: string,
  minLevel: LogLevel,
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  const formatted = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${service}] ${line}`;

  if (logToConsoleEnabled()) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(formatted);
  }

  if (!logToFileEnabled()) return;

  try {
    ensureLogDir(service);
    appendFileSync(logFilePath(service), `${formatted}\n`, 'utf8');
  } catch (err) {
    if (logToConsoleEnabled()) {
      console.error(`[platform-logger] failed to write log file for ${service}:`, err);
    }
  }
}

export function createPlatformLogger(service: string): PlatformLogger {
  const minLevel = parseLogLevel();

  return {
    debug(message, meta) {
      writeLine(service, 'debug', `${message}${serializeMeta(meta)}`, minLevel);
    },
    info(message, meta) {
      writeLine(service, 'info', `${message}${serializeMeta(meta)}`, minLevel);
    },
    warn(message, meta) {
      writeLine(service, 'warn', `${message}${serializeMeta(meta)}`, minLevel);
    },
    error(message, err, meta) {
      const parts = [message];
      if (err !== undefined) parts.push(formatError(err));
      writeLine(service, 'error', `${parts.join(' — ')}${serializeMeta(meta)}`, minLevel);
    },
  };
}

export function installProcessLogHandlers(log: PlatformLogger): void {
  process.on('uncaughtException', (err: unknown) => {
    log.error('uncaughtException', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    log.error('unhandledRejection', reason);
  });
}

/** Known platform services that write logs under logs/{service}/ */
export const PLATFORM_LOG_SERVICES = [
  'platform-api',
  'platform-ingest',
  'platform-ingest-fast',
  'platform-embed',
  'platform-subscription',
  'platform-scheduler',
  'platform-executor',
  'platform-db-migrate',
  'platform-db-init',
] as const;

export type PlatformLogService = (typeof PLATFORM_LOG_SERVICES)[number];

export function listPlatformLogFiles(service?: string): LogFileInfo[] {
  const root = getPlatformLogDir();
  if (!existsSync(root)) return [];

  const services = service ? [service] : readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const files: LogFileInfo[] = [];
  for (const svc of services) {
    const dir = path.join(root, svc);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.log')) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      files.push({
        service: svc,
        date: name.replace(/\.log$/, ''),
        path: full,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    }
  }

  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function tailPlatformLogFile(
  service: string,
  lines = 200,
  date?: string,
): { service: string; date: string; lines: string[]; truncated: boolean } {
  const safeService = service.replace(/[^a-z0-9-]/gi, '');
  const targetDate = date?.trim() || todayDate();
  const file = logFilePath(safeService, targetDate);
  if (!existsSync(file)) {
    return { service: safeService, date: targetDate, lines: [], truncated: false };
  }

  const content = readFileSync(file, 'utf8');
  const allLines = content.split(/\r?\n/).filter(Boolean);
  const max = Math.min(Math.max(lines, 1), 2000);
  const truncated = allLines.length > max;
  return {
    service: safeService,
    date: targetDate,
    lines: allLines.slice(-max),
    truncated,
  };
}
