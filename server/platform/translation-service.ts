import {
  buildTranslationObjectKey,
  isStorageEnabled,
  parseTranslationObjectBuffer,
  downloadObject,
  uploadTranslationObject,
} from '../_shared/blob-store.js';
import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { createPlatformLogger } from '../_shared/platform-logger.js';
import { translateText } from './hxxbot-translate.js';
import {
  findContentTranslation,
  upsertContentTranslation,
} from './content-translation-repository.js';
import { langsEquivalent, normalizeLangCode } from './subscription-rules.js';

const log = createPlatformLogger('platform-translation');

/** Heuristic: RSS lang tag is often wrong; detect script vs declared lang. */
function titleLikelyInLang(title: string, lang: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  const code = normalizeLangCode(lang);
  const latin = (trimmed.match(/[A-Za-z]/g)?.length ?? 0) / trimmed.length;
  const cjk = (trimmed.match(/[\u4e00-\u9fff]/g)?.length ?? 0) / trimmed.length;
  if (code === 'zh') return cjk >= 0.25 || latin < 0.4;
  if (code === 'en') return latin >= 0.4;
  return true;
}

export interface NewsHeadlineInput {
  news_item_id: string;
  title: string;
  link: string;
  source: string;
  category: string | null;
  lang: string;
}

export interface ResolvedHeadline {
  news_item_id: string;
  title: string;
  link: string;
  source: string;
  category: string | null;
  source_lang: string;
  delivery_lang: string;
  translated: boolean;
}

interface TranslationPayload {
  entity_type: 'news_item';
  entity_id: string;
  source_lang: string;
  target_lang: string;
  category: string | null;
  title: string;
  link: string;
  source: string;
  translated_at: string;
}

async function readTitleFromOss(objectKey: string): Promise<string | null> {
  try {
    const buf = await downloadObject(objectKey);
    const data = parseTranslationObjectBuffer(buf) as Partial<TranslationPayload>;
    const title = data.title?.trim();
    return title || null;
  } catch (err) {
    log.warn('OSS translation read failed', { objectKey, error: String(err) });
    return null;
  }
}

async function translateAndPersist(
  item: NewsHeadlineInput,
  targetLang: string,
): Promise<string> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置，无法翻译订阅内容');
  }

  const sourceLang = normalizeLangCode(item.lang);
  const normalizedTarget = normalizeLangCode(targetLang);
  const translated = await translateText(item.title, normalizedTarget, 'auto');
  const title = translated.translated_text.trim() || item.title;

  const payload: TranslationPayload = {
    entity_type: 'news_item',
    entity_id: item.news_item_id,
    source_lang: sourceLang,
    target_lang: normalizedTarget,
    category: item.category,
    title,
    link: item.link,
    source: item.source,
    translated_at: new Date().toISOString(),
  };

  let objectKey: string | null = null;
  let checksum: string | null = null;
  let byteSize: number | null = null;

  if (isStorageEnabled()) {
    try {
      objectKey = buildTranslationObjectKey(
        item.category ?? 'uncategorized',
        normalizedTarget,
        'news_item',
        item.news_item_id,
      );
      const uploaded = await uploadTranslationObject(objectKey, payload);
      checksum = uploaded.checksum;
      byteSize = uploaded.byteSize;
    } catch (err) {
      log.warn('OSS translation upload failed, storing inline only', {
        newsItemId: item.news_item_id,
        error: String(err),
      });
      objectKey = null;
    }
  }

  await upsertContentTranslation({
    entityType: 'news_item',
    entityId: item.news_item_id,
    sourceLang,
    targetLang: normalizedTarget,
    category: item.category,
    titleText: title,
    objectKey,
    checksum,
    byteSize,
  });

  return title;
}

/**
 * Resolve headline for delivery: DB inline → OSS file → live translate + save.
 */
export async function resolveHeadlineForDelivery(
  item: NewsHeadlineInput,
  deliveryLang: string,
): Promise<ResolvedHeadline> {
  const targetLang = normalizeLangCode(deliveryLang);
  const sourceLang = normalizeLangCode(item.lang);

  const base: ResolvedHeadline = {
    news_item_id: item.news_item_id,
    title: item.title,
    link: item.link,
    source: item.source,
    category: item.category,
    source_lang: sourceLang,
    delivery_lang: targetLang,
    translated: false,
  };

  if (langsEquivalent(sourceLang, targetLang) && titleLikelyInLang(item.title, targetLang)) {
    return base;
  }

  const cached = await findContentTranslation('news_item', item.news_item_id, targetLang);
  if (cached?.title_text?.trim()) {
    return { ...base, title: cached.title_text.trim(), translated: true };
  }

  if (cached?.object_key) {
    const fromOss = await readTitleFromOss(cached.object_key);
    if (fromOss) {
      await upsertContentTranslation({
        entityType: 'news_item',
        entityId: item.news_item_id,
        sourceLang,
        targetLang,
        category: item.category,
        titleText: fromOss,
        objectKey: cached.object_key,
        checksum: cached.checksum,
        byteSize: cached.byte_size,
      });
      return { ...base, title: fromOss, translated: true };
    }
    log.warn('translation file missing, re-translating', {
      newsItemId: item.news_item_id,
      objectKey: cached.object_key,
    });
  }

  const title = await translateAndPersist(item, targetLang);
  return { ...base, title, translated: true };
}

export async function resolveHeadlinesForDelivery(
  items: NewsHeadlineInput[],
  deliveryLang: string,
): Promise<ResolvedHeadline[]> {
  const out: ResolvedHeadline[] = [];
  for (const item of items) {
    out.push(await resolveHeadlineForDelivery(item, deliveryLang));
  }
  return out;
}
