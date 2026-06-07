import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { buildArticlePrompts, deduplicateHeadlines } from '../worldmonitor/news/v1/_shared.js';
import { parseBriefSourceRefs, selectBriefSourceItems } from './brief-sources.js';
import { getLatestBrief, saveBrief, type BriefRow } from './brief-repository.js';
import { runQaSession } from './hxxbot-qa.js';
import { listRecentNews } from './news-repository.js';
import { normalizeLangCode } from './subscription-rules.js';

export type { BriefSourceRef } from './brief-sources.js';
export { parseBriefSourceRefs } from './brief-sources.js';

export interface GenerateBriefInput {
  variant?: string;
  /** @deprecated use contentLangs */
  lang?: string;
  /** RSS / news_items.lang filter (null/empty = all source languages) */
  contentLangs?: string[] | null;
  /** AI summary output language */
  deliveryLang?: string;
  mode?: 'brief' | 'analysis';
  geoContext?: string;
  headlineLimit?: number;
  hours?: number;
  modelId?: string;
  force?: boolean;
}

export interface GenerateBriefResult {
  brief: BriefRow;
  cached: boolean;
  headlineCount: number;
}

function scopeKey(variant: string, deliveryLang: string, contentKey: string, mode: string): string {
  return `${variant}:${deliveryLang}:${contentKey}:${mode}`;
}

function contentScopeKey(contentLangs: string[] | null | undefined, legacyLang?: string): string {
  if (contentLangs?.length) return contentLangs.map(normalizeLangCode).sort().join('+');
  if (legacyLang?.trim()) return normalizeLangCode(legacyLang);
  return 'all';
}

export async function generateAiBrief(input: GenerateBriefInput = {}): Promise<GenerateBriefResult> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置：请在管理后台「数据源配置」中设置 HXXBOT Base URL 与 API Key');
  }

  const variant = input.variant ?? 'full';
  const contentLangs = input.contentLangs?.length
    ? input.contentLangs.map(normalizeLangCode)
    : (input.lang?.trim() ? [normalizeLangCode(input.lang)] : null);
  const deliveryLang = normalizeLangCode(input.deliveryLang ?? input.lang ?? 'en');
  const mode = input.mode ?? 'brief';
  const scope = scopeKey(variant, deliveryLang, contentScopeKey(contentLangs, input.lang), mode);

  if (!input.force) {
    const existing = await getLatestBrief({ briefType: 'world', scopeKey: scope });
    if (existing && Date.now() - existing.generated_at.getTime() < 2 * 60 * 1000) {
      return { brief: existing, cached: true, headlineCount: 0 };
    }
  }

  const limit = Math.min(input.headlineLimit ?? 12, 30);
  const items = await listRecentNews({
    variant,
    langs: contentLangs ?? undefined,
    limit,
    hours: input.hours ?? 24,
  });

  const sourceRefs = selectBriefSourceItems(items, limit);
  const headlines = sourceRefs.length
    ? sourceRefs.map((s) => s.title)
    : deduplicateHeadlines(items.map((i) => i.title)).slice(0, limit);
  if (headlines.length === 0) {
    const src = contentLangs?.length ? contentLangs.join(', ') : 'any';
    throw new Error(
      `No recent headlines for brief (variant=${variant}, source langs=${src}, last ${input.hours ?? 24}h). Run platform:ingest:once.`,
    );
  }

  const { systemPrompt, userPrompt } = buildArticlePrompts(headlines, headlines, {
    mode,
    geoContext: input.geoContext ?? '',
    variant,
    lang: deliveryLang,
  });

  const qa = await runQaSession({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    model_id: input.modelId,
  });

  const title =
    mode === 'analysis'
      ? `World analysis (${variant}/${deliveryLang})`
      : `World brief (${variant}/${deliveryLang})`;

  const brief = await saveBrief({
    briefType: 'world',
    scopeKey: scope,
    title,
    body: qa.answer,
    sourceRefs,
  });

  return { brief, cached: false, headlineCount: headlines.length };
}
