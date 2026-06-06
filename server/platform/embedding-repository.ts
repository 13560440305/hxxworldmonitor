import { getDefaultWorkspaceId, query } from '../_shared/db';
import { embeddingModelId, vectorToPgLiteral } from './embedding-service';
import type { NewsItemRow } from './news-repository';

declare const process: { env: Record<string, string | undefined> };

export interface SemanticSearchHit extends NewsItemRow {
  similarity: number;
}

export async function listNewsWithoutEmbeddings(
  workspaceId: string,
  limit: number,
): Promise<Array<{ id: string; title: string }>> {
  const res = await query<{ id: string; title: string }>(
    `SELECT n.id, n.title
     FROM news_items n
     LEFT JOIN news_embeddings e ON e.news_item_id = n.id
     WHERE n.workspace_id = $1 AND e.news_item_id IS NULL
     ORDER BY n.published_at DESC
     LIMIT $2`,
    [workspaceId, limit],
  );
  return res.rows;
}

export async function upsertNewsEmbedding(
  workspaceId: string,
  newsItemId: string,
  embedding: number[],
): Promise<void> {
  const literal = vectorToPgLiteral(embedding);
  await query(
    `INSERT INTO news_embeddings (news_item_id, workspace_id, embedding, model)
     VALUES ($1, $2, $3::vector, $4)
     ON CONFLICT (news_item_id) DO UPDATE SET
       embedding = EXCLUDED.embedding,
       model = EXCLUDED.model,
       created_at = NOW()`,
    [newsItemId, workspaceId, literal, embeddingModelId()],
  );
}

export async function countEmbeddings(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM news_embeddings WHERE workspace_id = $1',
    [ws],
  );
  return Number(res.rows[0]?.n ?? 0);
}

export async function semanticSearchNews(opts: {
  workspaceId?: string;
  queryEmbedding: number[];
  variant?: string;
  lang?: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<SemanticSearchHit[]> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const limit = Math.min(opts.limit ?? 20, 100);
  const minSim = opts.minSimilarity ?? 0.25;
  const literal = vectorToPgLiteral(opts.queryEmbedding);

  const res = await query<SemanticSearchHit & { similarity: string }>(
    `SELECT n.id, n.source, n.title, n.link, n.published_at, n.variant, n.lang,
            n.category, n.threat_level, n.is_alert, n.confidence,
            (1 - (e.embedding <=> $2::vector)) AS similarity
     FROM news_embeddings e
     JOIN news_items n ON n.id = e.news_item_id
     WHERE e.workspace_id = $1
       AND (1 - (e.embedding <=> $2::vector)) >= $3
       AND ($4::text IS NULL OR n.variant = $4)
       AND ($5::text IS NULL OR n.lang = $5)
     ORDER BY e.embedding <=> $2::vector
     LIMIT $6`,
    [workspaceId, literal, minSim, opts.variant ?? null, opts.lang ?? null, limit],
  );
  return res.rows.map((r) => ({
    ...r,
    similarity: Number(r.similarity),
  }));
}
