import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

declare const process: { env: Record<string, string | undefined> };

export interface ColdUploadResult {
  objectKey: string;
  byteSize: number;
  checksum: string;
}

function getOssConfig() {
  return {
    endpoint: process.env.OSS_ENDPOINT?.replace(/\/$/, '') ?? '',
    accessKey: process.env.OSS_ACCESS_KEY ?? '',
    secretKey: process.env.OSS_SECRET_KEY ?? '',
    bucket: process.env.OSS_BUCKET ?? 'wm-cold',
    region: process.env.OSS_REGION ?? 'us-east-1',
    forcePathStyle: process.env.OSS_FORCE_PATH_STYLE !== 'false',
  };
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  const cfg = getOssConfig();
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKey,
        secretAccessKey: cfg.secretKey,
      },
      forcePathStyle: cfg.forcePathStyle,
    });
  }
  return s3Client;
}

export function isOssEnabled(): boolean {
  const cfg = getOssConfig();
  return Boolean(cfg.endpoint && cfg.accessKey && cfg.secretKey && cfg.bucket);
}

export async function uploadColdObject(
  objectKey: string,
  body: Buffer | string,
  contentType = 'application/json',
): Promise<ColdUploadResult> {
  const cfg = getOssConfig();
  if (!isOssEnabled()) {
    throw new Error('OSS is not configured (OSS_ENDPOINT, OSS_ACCESS_KEY, OSS_SECRET_KEY, OSS_BUCKET)');
  }

  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const checksum = createHash('sha256').update(payload).digest('hex');

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: payload,
      ContentType: contentType,
    }),
  );

  return { objectKey, byteSize: payload.byteLength, checksum };
}

export async function checkOssHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!isOssEnabled()) {
    return { ok: false, error: 'OSS not configured' };
  }
  const cfg = getOssConfig();
  try {
    await getS3Client().send(new HeadBucketCommand({ Bucket: cfg.bucket }));
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
  const cfg = getOssConfig();
  if (!isOssEnabled()) {
    throw new Error('OSS is not configured');
  }
  const resp = await getS3Client().send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }),
  );
  const chunks: Buffer[] = [];
  const body = resp.Body;
  if (!body) throw new Error(`Empty OSS object: ${objectKey}`);
  if (typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
  } else if (body instanceof Uint8Array) {
    chunks.push(Buffer.from(body));
  } else {
    throw new Error(`Unsupported OSS body type for ${objectKey}`);
  }
  return Buffer.concat(chunks);
}

export async function uploadTranslationObject(
  objectKey: string,
  payload: Record<string, unknown>,
): Promise<ColdUploadResult> {
  if (!isOssEnabled()) {
    throw new Error('OSS is not configured');
  }
  const json = JSON.stringify(payload);
  const gz = gzipSync(Buffer.from(json, 'utf8'));
  const checksum = createHash('sha256').update(gz).digest('hex');
  const cfg = getOssConfig();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: gz,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
    }),
  );
  return { objectKey, byteSize: gz.byteLength, checksum };
}

export function parseTranslationObjectBuffer(buf: Buffer): Record<string, unknown> {
  let raw = buf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    raw = gunzipSync(buf);
  }
  return JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
}
