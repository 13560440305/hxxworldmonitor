import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  getLocalStorageConfig,
  getResolvedS3Backend,
  getStoragePublicStatus,
  getStorageType,
  isStorageConfigured,
  type ResolvedS3Backend,
} from './storage-config.js';

export interface ColdUploadResult {
  objectKey: string;
  byteSize: number;
  checksum: string;
}

let s3Client: S3Client | null = null;
let s3ClientKey = '';

function getS3Client(backend: ResolvedS3Backend): S3Client {
  const key = `${backend.kind}|${backend.endpoint}|${backend.bucket}|${backend.accessKeyId}`;
  if (!s3Client || s3ClientKey !== key) {
    s3Client = new S3Client({
      endpoint: backend.endpoint,
      region: backend.region,
      credentials: {
        accessKeyId: backend.accessKeyId,
        secretAccessKey: backend.secretAccessKey,
      },
      forcePathStyle: backend.forcePathStyle,
    });
    s3ClientKey = key;
  }
  return s3Client;
}

async function readS3Body(body: unknown, objectKey: string): Promise<Buffer> {
  if (!body) throw new Error(`Empty object body: ${objectKey}`);
  if (typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  throw new Error(`Unsupported object body type for ${objectKey}`);
}

function localFilePath(objectKey: string): string {
  const local = getLocalStorageConfig();
  if (!local) throw new Error('Local storage is not configured');
  const normalizedKey = objectKey.replace(/^\/+/, '');
  const filePath = path.resolve(local.base_path, normalizedKey);
  const base = path.resolve(local.base_path);
  if (!filePath.startsWith(base + path.sep) && filePath !== base) {
    throw new Error(`Invalid object key: ${objectKey}`);
  }
  return filePath;
}

async function uploadLocalObject(
  objectKey: string,
  payload: Buffer,
): Promise<ColdUploadResult> {
  const filePath = localFilePath(objectKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, payload);
  const checksum = createHash('sha256').update(payload).digest('hex');
  return { objectKey, byteSize: payload.byteLength, checksum };
}

async function downloadLocalObject(objectKey: string): Promise<Buffer> {
  const filePath = localFilePath(objectKey);
  return readFile(filePath);
}

async function uploadS3Object(
  backend: ResolvedS3Backend,
  objectKey: string,
  payload: Buffer,
  contentType: string,
  contentEncoding?: string,
): Promise<ColdUploadResult> {
  const checksum = createHash('sha256').update(payload).digest('hex');
  await getS3Client(backend).send(
    new PutObjectCommand({
      Bucket: backend.bucket,
      Key: objectKey,
      Body: payload,
      ContentType: contentType,
      ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
    }),
  );
  return { objectKey, byteSize: payload.byteLength, checksum };
}

async function downloadS3Object(backend: ResolvedS3Backend, objectKey: string): Promise<Buffer> {
  const resp = await getS3Client(backend).send(
    new GetObjectCommand({ Bucket: backend.bucket, Key: objectKey }),
  );
  return readS3Body(resp.Body, objectKey);
}

/** @deprecated Use {@link isStorageConfigured}. */
export function isOssEnabled(): boolean {
  return isStorageConfigured();
}

export function isStorageEnabled(): boolean {
  return isStorageConfigured();
}

export { getStoragePublicStatus, getStorageType };

export async function uploadColdObject(
  objectKey: string,
  body: Buffer | string,
  contentType = 'application/json',
): Promise<ColdUploadResult> {
  if (!isStorageConfigured()) {
    throw new Error('Storage is not configured (set STORAGE_TYPE in .env.local)');
  }

  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const local = getLocalStorageConfig();
  if (local) return uploadLocalObject(objectKey, payload);

  const backend = getResolvedS3Backend();
  if (!backend) {
    throw new Error('S3-compatible storage is not configured');
  }
  return uploadS3Object(backend, objectKey, payload, contentType);
}

/** @deprecated Use {@link checkStorageHealth}. */
export async function checkOssHealth(): Promise<{ ok: boolean; error?: string }> {
  return checkStorageHealth();
}

export async function checkStorageHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!isStorageConfigured()) {
    return { ok: false, error: 'Storage not configured' };
  }

  const local = getLocalStorageConfig();
  if (local) {
    try {
      await mkdir(local.base_path, { recursive: true });
      await access(local.base_path);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  const backend = getResolvedS3Backend();
  if (!backend) {
    return { ok: false, error: 'S3 backend not configured' };
  }
  try {
    await getS3Client(backend).send(new HeadBucketCommand({ Bucket: backend.bucket }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function buildColdObjectKey(entityType: string, entityId: string, suffix = 'json.gz'): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `cold/${y}/${m}/${entityType}/${entityId}.${suffix}`;
}

/** Classified translation archive: translations/{category}/{targetLang}/{entityType}/{id}.json.gz */
export function buildTranslationObjectKey(
  category: string,
  targetLang: string,
  entityType: string,
  entityId: string,
): string {
  const safeCat = (category || 'uncategorized').replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
  const safeLang = targetLang.replace(/[^a-z0-9_-]/gi, '_').slice(0, 16);
  return `translations/${safeCat}/${safeLang}/${entityType}/${entityId}.json.gz`;
}

export async function downloadObject(objectKey: string): Promise<Buffer> {
  if (!isStorageConfigured()) {
    throw new Error('Storage is not configured');
  }

  const local = getLocalStorageConfig();
  if (local) return downloadLocalObject(objectKey);

  const backend = getResolvedS3Backend();
  if (!backend) throw new Error('S3-compatible storage is not configured');
  return downloadS3Object(backend, objectKey);
}

export async function uploadTranslationObject(
  objectKey: string,
  payload: Record<string, unknown>,
): Promise<ColdUploadResult> {
  if (!isStorageConfigured()) {
    throw new Error('Storage is not configured');
  }

  const json = JSON.stringify(payload);
  const gz = gzipSync(Buffer.from(json, 'utf8'));

  const local = getLocalStorageConfig();
  if (local) return uploadLocalObject(objectKey, gz);

  const backend = getResolvedS3Backend();
  if (!backend) throw new Error('S3-compatible storage is not configured');
  return uploadS3Object(backend, objectKey, gz, 'application/json', 'gzip');
}

export function parseTranslationObjectBuffer(buf: Buffer): Record<string, unknown> {
  let raw = buf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    raw = gunzipSync(buf);
  }
  return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
}
