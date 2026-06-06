import { getDefaultWorkspaceId, query } from '../_shared/db.js';

export type TranslationEntityType = 'news_item' | 'brief' | 'digest';

export interface ContentTranslationRow {
  id: string;
  workspace_id: string;
  entity_type: TranslationEntityType;
  entity_id: string;
  source_lang: string;
  target_lang: string;
  category: string | null;
  title_text: string | null;
  body_text: string | null;
  object_key: string | null;
  checksum: string | null;
  byte_size: number | null;
  provider: string;
  created_at: Date;
  updated_at: Date;
}

export async function findContentTranslation(
  entityType: TranslationEntityType,
  entityId: string,
  targetLang: string,
  workspaceId?: string,
): Promise<ContentTranslationRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<ContentTranslationRow>(
    `SELECT id, workspace_id, entity_type, entity_id, source_lang, target_lang,
            category, title_text, body_text, object_key, checksum, byte_size,
            provider, created_at, updated_at
     FROM content_translations
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_id = $3 AND target_lang = $4`,
    [ws, entityType, entityId, targetLang],
  );
  return res.rows[0] ?? null;
}

export async function upsertContentTranslation(opts: {
  entityType: TranslationEntityType;
  entityId: string;
  sourceLang: string;
  targetLang: string;
  category?: string | null;
  titleText?: string | null;
  bodyText?: string | null;
  objectKey?: string | null;
  checksum?: string | null;
  byteSize?: number | null;
  workspaceId?: string;
}): Promise<ContentTranslationRow> {
  const ws = opts.workspaceId ?? getDefaultWorkspaceId();
  const res = await query<ContentTranslationRow>(
    `INSERT INTO content_translations (
       workspace_id, entity_type, entity_id, source_lang, target_lang, category,
       title_text, body_text, object_key, checksum, byte_size
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (workspace_id, entity_type, entity_id, target_lang) DO UPDATE SET
       source_lang = EXCLUDED.source_lang,
       category = COALESCE(EXCLUDED.category, content_translations.category),
       title_text = COALESCE(EXCLUDED.title_text, content_translations.title_text),
       body_text = COALESCE(EXCLUDED.body_text, content_translations.body_text),
       object_key = COALESCE(EXCLUDED.object_key, content_translations.object_key),
       checksum = COALESCE(EXCLUDED.checksum, content_translations.checksum),
       byte_size = COALESCE(EXCLUDED.byte_size, content_translations.byte_size),
       updated_at = NOW()
     RETURNING id, workspace_id, entity_type, entity_id, source_lang, target_lang,
               category, title_text, body_text, object_key, checksum, byte_size,
               provider, created_at, updated_at`,
    [
      ws,
      opts.entityType,
      opts.entityId,
      opts.sourceLang,
      opts.targetLang,
      opts.category ?? null,
      opts.titleText ?? null,
      opts.bodyText ?? null,
      opts.objectKey ?? null,
      opts.checksum ?? null,
      opts.byteSize ?? null,
    ],
  );
  return res.rows[0]!;
}
