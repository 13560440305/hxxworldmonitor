import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { buildArticlePrompts, deduplicateHeadlines } from '../worldmonitor/news/v1/_shared.js';
import type { BriefSourceRef } from './brief-sources.js';
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

export async function generateAiBrief(input: GenerateBriefInput = {}): Promise<GenerateBriefResult> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置：请在管理后台「数据源配置」中设置 HXXBOT Base URL 与 API Key');
  }

  const variant = input.variant ?? 'full';
  const deliveryLang = normalizeLangCode(input.deliveryLang ?? input.lang ?? 'en');
  const mode = input.mode ?? 'brief';
  const scope = scopeKey(variant, deliveryLang, 'all', mode);

  if (!input.force) {
    const existing = await getLatestBrief({ briefType: 'world', scopeKey: scope });
    if (existing && Date.now() - existing.generated_at.getTime() < 2 * 60 * 1000) {
      return { brief: existing, cached: true, headlineCount: 0 };
    }
  }

  const limit = Math.min(input.headlineLimit ?? 12, 30);
  const items = await listRecentNews({
    variant,
    limit,
    hours: input.hours ?? 24,
  });

  const sourceRefs = selectBriefSourceItems(items, limit);
  const headlines = sourceRefs.length
    ? sourceRefs.map((s) => s.title)
    : deduplicateHeadlines(items.map((i) => i.title)).slice(0, limit);
  if (headlines.length === 0) {
    throw new Error(
      `No recent headlines for brief (variant=${variant}, last ${input.hours ?? 24}h). Run platform:ingest:once.`,
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

/** AI digest from an explicit headline set (e.g. keyword subscription matches). */
export async function generateBriefFromHeadlines(input: {
  headlines: string[];
  sourceRefs: BriefSourceRef[];
  deliveryLang?: string;
  variant?: string;
  mode?: 'brief' | 'analysis';
  modelId?: string;
}): Promise<{ body: string; sourceRefs: BriefSourceRef[] }> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置：请在管理后台「数据源配置」中设置 HXXBOT Base URL 与 API Key');
  }

  const headlines = deduplicateHeadlines(input.headlines.map((h) => h.trim()).filter(Boolean));
  if (!headlines.length) {
    throw new Error('No headlines provided for digest brief');
  }

  const variant = input.variant ?? 'full';
  const deliveryLang = normalizeLangCode(input.deliveryLang ?? 'en');
  const mode = input.mode ?? 'brief';

  const { systemPrompt, userPrompt } = buildArticlePrompts(headlines, headlines, {
    mode,
    geoContext: '',
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

  return {
    body: qa.answer.trim(),
    sourceRefs: input.sourceRefs,
  };
}
