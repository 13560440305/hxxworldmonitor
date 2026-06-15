import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { buildColdObjectKey, isStorageEnabled, uploadColdObject } from '@hxxworldmonitor/shared/blob-store.js';
import { gzipSync } from 'node:zlib';

declare const process: { env: Record<string, string | undefined> };

const HOT_RETENTION_DAYS = Number(process.env.PLATFORM_HOT_RETENTION_DAYS ?? 180);
const BATCH_SIZE = Number(process.env.PLATFORM_COLD_TIER_BATCH ?? 100);

export interface ColdTierResult {
  archived: number;
  skipped: number;
  errors: number;
}

/** Move old news body metadata to cold storage (Phase 0: archive title+link JSON blob). */
export async function runColdTierPass(): Promise<ColdTierResult> {
  if (!isStorageEnabled()) {
    return { archived: 0, skipped: 0, errors: 0 };
  }

  const workspaceId = getDefaultWorkspaceId();
  let archived = 0;
  let skipped = 0;
  let errors = 0;

  const res = await query<{
    id: string;
    title: string;
    link: string;
    published_at: Date;
    category: string | null;
  }>(
    `SELECT id, title, link, published_at, category
     FROM news_items
     WHERE workspace_id = $1
       AND cold_ref IS NULL
       AND published_at < NOW() - make_interval(days => $2)
     ORDER BY published_at ASC
     LIMIT $3`,
    [workspaceId, HOT_RETENTION_DAYS, BATCH_SIZE],
  );

  for (const row of res.rows) {
    try {
      const payload = JSON.stringify({
        id: row.id,
        title: row.title,
        link: row.link,
        published_at: row.published_at.toISOString(),
        category: row.category,
      });
      const compressed = gzipSync(Buffer.from(payload, 'utf8'));
      const objectKey = buildColdObjectKey('news_items', row.id, 'json.gz');

      const upload = await uploadColdObject(objectKey, compressed, 'application/gzip');

      await query(
        `INSERT INTO cold_object_index (workspace_id, object_key, entity_type, entity_id, checksum, byte_size)
         VALUES ($1, $2, 'news_items', $3, $4, $5)
         ON CONFLICT (workspace_id, object_key) DO NOTHING`,
        [workspaceId, upload.objectKey, row.id, upload.checksum, upload.byteSize],
      );

      await query(
        `UPDATE news_items SET cold_ref = $1 WHERE id = $2`,
        [upload.objectKey, row.id],
      );

      archived += 1;
    } catch (e) {
      console.warn('[cold-tier] archive failed for', row.id, e);
      errors += 1;
    }
  }

  skipped = res.rows.length - archived - errors;
  return { archived, skipped, errors };
}
