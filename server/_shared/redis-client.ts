import { createClient, type RedisClientType } from 'redis';

declare const process: { env: Record<string, string | undefined> };

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType | null> | null = null;
let connectFailed = false;
let lastErrorLogAt = 0;

/** node-redis v4+ defaults to RESP3 (HELLO). Redis < 6 only supports RESP2. */
function resolveRespVersion(): 2 | 3 {
  const raw = (process.env.REDIS_RESP ?? process.env.REDIS_RESP_VERSION ?? '2').trim();
  return raw === '3' ? 3 : 2;
}

function buildClientOptions(url: string) {
  return {
    url,
    RESP: resolveRespVersion(),
  };
}

function logRedisError(message: string): void {
  const now = Date.now();
  if (now - lastErrorLogAt < 5000) return;
  lastErrorLogAt = now;
  console.error('[redis-client]', message);
}

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export async function getRedisClient(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (connectFailed) return null;

  if (client?.isOpen) return client;

  if (!connectPromise) {
    const resp = resolveRespVersion();
    connectPromise = (async () => {
      const c = createClient(buildClientOptions(url));
      c.on('error', (err) => {
        logRedisError(err.message);
      });
      await c.connect();
      client = c as RedisClientType;
      if (resp === 2) {
        console.log('[redis-client] connected (RESP2 — compatible with Redis 5.x / older servers)');
      } else {
        console.log('[redis-client] connected (RESP3)');
      }
      return client;
    })().catch((err) => {
      connectPromise = null;
      connectFailed = true;
      const msg = String(err?.message ?? err);
      if (msg.includes('HELLO')) {
        console.error(
          '[redis-client] connect failed: server does not support RESP3/HELLO (Redis < 6?).',
          'Set REDIS_RESP=2 in .env.local (default) or upgrade Redis to 6+.',
        );
      } else {
        console.error('[redis-client] connect failed:', msg);
      }
      return null;
    });
  }

  return connectPromise;
}

export async function closeRedisClient(): Promise<void> {
  if (client?.isOpen) {
    await client.quit();
  }
  client = null;
  connectPromise = null;
  connectFailed = false;
}

export const PLATFORM_STREAM_EMBED = 'platform:events:embedding';

export async function publishEmbeddingJob(payload: {
  workspaceId?: string;
  batchSize?: number;
}): Promise<boolean> {
  const redis = await getRedisClient();
  if (!redis) return false;
  try {
    await redis.xAdd(PLATFORM_STREAM_EMBED, '*', {
      payload: JSON.stringify(payload),
      ts: Date.now().toString(),
    });
    return true;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('XADD') || msg.includes('unknown command')) {
      logRedisError(
        'Stream 不可用（需 Redis 5+ 才支持 XADD 队列）；embedding 写入 PG 不受影响，可忽略或升级 Redis',
      );
    } else {
      logRedisError(`publish failed: ${msg}`);
    }
    return false;
  }
}

export async function readEmbeddingJobs(
  consumer: string,
  count = 1,
): Promise<Array<{ id: string; payload: { workspaceId?: string; batchSize?: number } }>> {
  const redis = await getRedisClient();
  if (!redis) return [];

  const group = 'platform-embed-workers';
  const stream = PLATFORM_STREAM_EMBED;
  try {
    await redis.xGroupCreate(stream, group, '0', { MKSTREAM: true });
  } catch (err) {
    const msg = String(err);
    if (!msg.includes('BUSYGROUP')) throw err;
  }

  const rows = await redis.xReadGroup(group, consumer, [{ key: stream, id: '>' }], {
    COUNT: count,
    BLOCK: 1000,
  });
  if (!rows) return [];

  const out: Array<{ id: string; payload: { workspaceId?: string; batchSize?: number } }> = [];
  for (const streamRow of rows) {
    for (const msg of streamRow.messages) {
      const raw = msg.message.payload;
      const payload = typeof raw === 'string' ? JSON.parse(raw) as { workspaceId?: string; batchSize?: number } : {};
      out.push({ id: msg.id, payload });
      await redis.xAck(stream, group, msg.id);
    }
  }
  return out;
}

export async function checkRedisHealth(): Promise<{ ok: boolean; resp: number; error?: string }> {
  if (!isRedisEnabled()) {
    return { ok: false, resp: resolveRespVersion(), error: 'REDIS_URL not set' };
  }
  try {
    const redis = await getRedisClient();
    if (!redis) {
      return { ok: false, resp: resolveRespVersion(), error: 'connect failed' };
    }
    const pong = await redis.ping();
    return { ok: pong === 'PONG', resp: resolveRespVersion() };
  } catch (err) {
    return { ok: false, resp: resolveRespVersion(), error: String(err) };
  }
}
