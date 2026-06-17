import { runEmbeddingBatch } from '../research-service.js';
import type { IngestPlugin } from './types.js';

export const embeddingBatchPlugin: IngestPlugin = {
  key: 'embedding-batch',
  displayName: '新闻向量嵌入批处理',
  tier: 'batch',
  async run(ctx) {
    const batchSize = ctx.payload.batchSize != null ? Number(ctx.payload.batchSize) : undefined;
    const result = await runEmbeddingBatch({ batchSize });
    return { status: 'ok', ...result };
  },
};
