import { createRequire } from 'node:module';
import { env as transformersEnv } from '@xenova/transformers';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const process: { env: Record<string, string | undefined> };

const require = createRequire(import.meta.url);

let configured = false;

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Bridge HF env vars to @xenova/transformers (it does not read HF_ENDPOINT itself).
 * See: https://huggingface.co/docs/transformers.js/api/env
 */
export function applyTransformersEnv(): void {
  if (configured) return;
  configured = true;

  const endpoint =
    trimEnv('HF_ENDPOINT') ??
    trimEnv('PLATFORM_HF_ENDPOINT') ??
    trimEnv('HUGGINGFACE_HUB_ENDPOINT');

  if (endpoint) {
    transformersEnv.remoteHost = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
    console.log('[transformers-env] remoteHost =', transformersEnv.remoteHost);
  }

  const cacheDir =
    trimEnv('HF_HOME') ??
    trimEnv('PLATFORM_HF_CACHE_DIR') ??
    trimEnv('TRANSFORMERS_CACHE');

  if (cacheDir) {
    transformersEnv.cacheDir = path.resolve(cacheDir);
    console.log('[transformers-env] cacheDir =', transformersEnv.cacheDir);
  }

  const localModelPath = trimEnv('PLATFORM_HF_LOCAL_MODEL_PATH');
  if (localModelPath) {
    transformersEnv.localModelPath = path.resolve(localModelPath);
    console.log('[transformers-env] localModelPath =', transformersEnv.localModelPath);
  }

  const allowRemote = trimEnv('PLATFORM_HF_ALLOW_REMOTE');
  if (allowRemote === 'false' || allowRemote === '0') {
    transformersEnv.allowRemoteModels = false;
    console.log('[transformers-env] allowRemoteModels = false (local cache only)');
  }

  configureFetchTimeout();
}

function configureFetchTimeout(): void {
  const raw = trimEnv('PLATFORM_HF_FETCH_TIMEOUT_MS');
  if (!raw) return;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return;

  try {
    const undici = require('undici') as {
      Agent: new (opts: { connect?: { timeout?: number } }) => unknown;
      setGlobalDispatcher: (d: unknown) => void;
    };
    undici.setGlobalDispatcher(new undici.Agent({ connect: { timeout: ms } }));
    console.log('[transformers-env] fetch connect timeout =', ms, 'ms');
  } catch {
    // Optional — HF mirror usually enough; undici may be unavailable on older Node
  }
}

export function transformersEnvSummary(): Record<string, unknown> {
  return {
    remoteHost: transformersEnv.remoteHost,
    cacheDir: transformersEnv.cacheDir,
    localModelPath: transformersEnv.localModelPath,
    allowRemoteModels: transformersEnv.allowRemoteModels,
  };
}

export function huggingFaceUnreachableHint(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return [
    'Could not download the embedding model from Hugging Face.',
    'If huggingface.co is blocked or slow, set in .env.local:',
    '  HF_ENDPOINT=https://hf-mirror.com',
    '  PLATFORM_HF_FETCH_TIMEOUT_MS=120000',
    'Then retry: npm run platform:embed:once',
    `Default cache dir: ${transformersEnv.cacheDir ?? path.join(root, 'node_modules/@xenova/transformers/.cache')}`,
  ].join('\n');
}
