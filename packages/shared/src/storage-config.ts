import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const process: { env: Record<string, string | undefined> };

export type StorageType = 'local' | 'oss' | 'r2';

export interface LocalStorageConfig {
  base_path: string;
  base_url?: string;
}

export interface ResolvedS3Backend {
  kind: 'oss' | 'r2';
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  baseUrl?: string;
}

interface StorageConfigFile {
  type: StorageType;
  local?: LocalStorageConfig;
}

let cached: StorageConfigFile | null | undefined;

function env(key: string): string {
  return process.env[key]?.trim() ?? '';
}

function getProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function resolveStorageType(): StorageType | null {
  const explicit = env('STORAGE_TYPE').toLowerCase();
  if (explicit === 'local' || explicit === 'oss' || explicit === 'r2') return explicit;

  // Legacy: OSS_* without STORAGE_TYPE → oss
  if (env('OSS_ENDPOINT') || env('STORAGE_OSS_ENDPOINT')) return 'oss';
  return null;
}

function loadFromEnv(): StorageConfigFile | null {
  const type = resolveStorageType();
  if (!type) return null;

  if (type === 'local') {
    const basePath = env('STORAGE_LOCAL_PATH') || env('STORAGE_LOCAL_BASE_PATH') || './uploads';
    const baseUrl = env('STORAGE_LOCAL_BASE_URL') || undefined;
    return {
      type: 'local',
      local: { base_path: basePath, base_url: baseUrl },
    };
  }

  return { type };
}

/** Load storage config from `.env.local` / process.env. */
export function getStorageConfig(): StorageConfigFile | null {
  if (cached !== undefined) return cached;
  cached = loadFromEnv();
  return cached;
}

export function resetStorageConfigCache(): void {
  cached = undefined;
}

export function getStorageType(): StorageType | null {
  return getStorageConfig()?.type ?? null;
}

export function getLocalStorageConfig(): LocalStorageConfig | null {
  const cfg = getStorageConfig();
  if (!cfg || cfg.type !== 'local' || !cfg.local?.base_path) return null;
  const basePath = cfg.local.base_path.trim();
  if (!basePath) return null;
  const resolved = path.isAbsolute(basePath)
    ? basePath
    : path.resolve(getProjectRoot(), basePath);
  return { base_path: resolved, base_url: cfg.local.base_url?.trim() || undefined };
}

export function getResolvedS3Backend(): ResolvedS3Backend | null {
  const cfg = getStorageConfig();
  if (!cfg) return null;

  if (cfg.type === 'oss') {
    const endpoint = normalizeEndpoint(
      env('STORAGE_OSS_ENDPOINT') || env('OSS_ENDPOINT'),
    );
    const accessKeyId = env('STORAGE_OSS_ACCESS_KEY_ID') || env('OSS_ACCESS_KEY');
    const secretAccessKey = env('STORAGE_OSS_ACCESS_KEY_SECRET') || env('OSS_SECRET_KEY');
    const bucket = env('STORAGE_OSS_BUCKET') || env('OSS_BUCKET') || 'wm-cold';
    const region = env('STORAGE_OSS_REGION') || env('OSS_REGION') || 'us-east-1';
    const forcePathStyle =
      env('STORAGE_OSS_FORCE_PATH_STYLE') !== ''
        ? env('STORAGE_OSS_FORCE_PATH_STYLE') !== 'false'
        : env('OSS_FORCE_PATH_STYLE') !== 'false';
    const baseUrl = env('STORAGE_OSS_BASE_URL') || undefined;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
    return {
      kind: 'oss',
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      region,
      forcePathStyle,
      baseUrl: baseUrl || undefined,
    };
  }

  if (cfg.type === 'r2') {
    const endpoint = normalizeEndpoint(env('STORAGE_R2_ENDPOINT'));
    const accessKeyId = env('STORAGE_R2_ACCESS_KEY_ID');
    const secretAccessKey = env('STORAGE_R2_SECRET_ACCESS_KEY');
    const bucket = env('STORAGE_R2_BUCKET');
    const region = env('STORAGE_R2_REGION') || 'auto';
    const baseUrl = env('STORAGE_R2_BASE_URL') || undefined;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
    return {
      kind: 'r2',
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      region,
      forcePathStyle: true,
      baseUrl: baseUrl || undefined,
    };
  }

  return null;
}

export function isStorageConfigured(): boolean {
  const cfg = getStorageConfig();
  if (!cfg) return false;
  if (cfg.type === 'local') return Boolean(getLocalStorageConfig());
  return Boolean(getResolvedS3Backend());
}

export function getStoragePublicStatus(): {
  configured: boolean;
  type: StorageType | null;
  localBasePath?: string;
  bucket?: string;
  endpoint?: string;
} {
  const cfg = getStorageConfig();
  if (!cfg) {
    return { configured: false, type: null };
  }
  if (cfg.type === 'local') {
    const local = getLocalStorageConfig();
    return {
      configured: Boolean(local),
      type: 'local',
      localBasePath: local?.base_path,
    };
  }
  const s3 = getResolvedS3Backend();
  return {
    configured: Boolean(s3),
    type: cfg.type,
    bucket: s3?.bucket,
    endpoint: s3?.endpoint,
  };
}
