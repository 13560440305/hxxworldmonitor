import { getDefaultWorkspaceId } from '@hxxworldmonitor/shared/db';
import { embedTexts } from './embedding-service';
import {
  countEmbeddings,
  listNewsWithoutEmbeddings,
  semanticSearchNews,
  upsertNewsEmbedding,
  type SemanticSearchHit,
} from './embedding-repository';
import {
  countEntityMentions,
  createTrackingThread,
  getMonitorProfile,
  linkEntityMention,
  type MonitorProfileRow,
  upsertEntity,
} from './monitor-repository';

declare const process: { env: Record<string, string | undefined> };

export interface MonitorReport {
  monitor: MonitorProfileRow;
  generatedAt: string;
  queryText: string;
  embeddingCount: number;
  hits: SemanticSearchHit[];
  byCategory: Record<string, SemanticSearchHit[]>;
  trackingThreadId?: string;
}

function monitorQueryText(monitor: MonitorProfileRow): string {
  const cfg = monitor.config_json ?? {};
  const terms = Array.isArray(cfg.watchTerms) ? cfg.watchTerms as string[] : [];
  const keywords = Array.isArray(cfg.keywords) ? cfg.keywords as string[] : [];
  const combined = [...terms, ...keywords, monitor.name].filter(Boolean);
  return combined.join(' ').trim() || monitor.name;
}

function monitorFilters(monitor: MonitorProfileRow): { variant?: string; lang?: string } {
  const cfg = monitor.config_json ?? {};
  return {
    variant: typeof cfg.variant === 'string' ? cfg.variant : undefined,
    lang: typeof cfg.lang === 'string' ? cfg.lang : undefined,
  };
}

export async function runEmbeddingBatch(opts?: {
  workspaceId?: string;
  batchSize?: number;
}): Promise<{ embedded: number; remaining: number }> {
  const workspaceId = opts?.workspaceId ?? getDefaultWorkspaceId();
  const batchSize = Math.min(opts?.batchSize ?? Number(process.env.PLATFORM_EMBED_BATCH ?? 32), 100);

  const pending = await listNewsWithoutEmbeddings(workspaceId, batchSize);
  if (pending.length === 0) {
    return { embedded: 0, remaining: 0 };
  }

  const vectors = await embedTexts(pending.map((p) => p.title));
  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]!;
    const vec = vectors[i];
    if (!vec) continue;
    await upsertNewsEmbedding(workspaceId, row.id, vec);
  }

  const remainingRows = await listNewsWithoutEmbeddings(workspaceId, 1);
  return { embedded: pending.length, remaining: remainingRows.length > 0 ? 1 : 0 };
}

export async function buildMonitorReport(monitorId: string): Promise<MonitorReport | null> {
  const monitor = await getMonitorProfile(monitorId);
  if (!monitor || !monitor.enabled) return null;

  const queryText = monitorQueryText(monitor);
  const filters = monitorFilters(monitor);
  const [queryVec] = await embedTexts([queryText]);
  if (!queryVec) {
    throw new Error('Failed to embed monitor query');
  }

  let hits = await semanticSearchNews({
    queryEmbedding: queryVec,
    variant: filters.variant,
    lang: filters.lang,
    limit: Number(process.env.PLATFORM_RESEARCH_TOP_K ?? 30),
    minSimilarity: Number(process.env.PLATFORM_RESEARCH_MIN_SIM ?? 0.3),
  });

  const exclude = Array.isArray(monitor.config_json.excludeTerms)
    ? (monitor.config_json.excludeTerms as string[]).map((t) => t.toLowerCase())
    : [];
  if (exclude.length > 0) {
    hits = hits.filter((h) => !exclude.some((term) => h.title.toLowerCase().includes(term)));
  }

  const entity = await upsertEntity({
    entityType: monitor.monitor_type,
    name: monitor.name,
    metadataJson: { monitorId: monitor.id },
  });

  for (const hit of hits.slice(0, 50)) {
    await linkEntityMention(entity.id, hit.id);
  }

  const byCategory: Record<string, SemanticSearchHit[]> = {};
  for (const hit of hits) {
    const cat = hit.category ?? 'uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(hit);
  }

  const thread = await createTrackingThread({
    title: `${monitor.name} report ${new Date().toISOString().slice(0, 10)}`,
    metadataJson: {
      monitorId: monitor.id,
      hitCount: hits.length,
      queryText,
    },
  });

  const embeddingCount = await countEmbeddings(monitor.workspace_id);

  return {
    monitor,
    generatedAt: new Date().toISOString(),
    queryText,
    embeddingCount,
    hits,
    byCategory,
    trackingThreadId: thread.id,
  };
}

export async function compareEntities(input: {
  entityA: string;
  entityB: string;
  entityType?: string;
  days?: number;
}): Promise<{
  entityA: { name: string; mentionCount: number };
  entityB: { name: string; mentionCount: number };
  days: number;
}> {
  const entityType = input.entityType ?? 'competitor';
  const days = input.days ?? 30;

  const a = await upsertEntity({ entityType, name: input.entityA });
  const b = await upsertEntity({ entityType, name: input.entityB });

  const [countA, countB] = await Promise.all([
    countEntityMentions(a.id, days),
    countEntityMentions(b.id, days),
  ]);

  return {
    entityA: { name: a.name, mentionCount: countA },
    entityB: { name: b.name, mentionCount: countB },
    days,
  };
}

export async function semanticSearchByText(opts: {
  query: string;
  variant?: string;
  lang?: string;
  limit?: number;
}): Promise<SemanticSearchHit[]> {
  const [vec] = await embedTexts([opts.query]);
  if (!vec) return [];
  return semanticSearchNews({
    queryEmbedding: vec,
    variant: opts.variant,
    lang: opts.lang,
    limit: opts.limit,
  });
}
