import { createHash } from 'node:crypto';
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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
