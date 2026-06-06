import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { buildArticlePrompts, deduplicateHeadlines } from '../worldmonitor/news/v1/_shared.js';
import { getLatestBrief, saveBrief, type BriefRow } from './brief-repository.js';
import { runQaSession } from './hxxbot-qa.js';
import { listRecentNews } from './news-repository.js';

export interface GenerateBriefInput {
  variant?: string;
  lang?: string;
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

function scopeKey(variant: string, lang: string, mode: string): string {
  return `${variant}:${lang}:${mode}`;
}

export async function generateAiBrief(input: GenerateBriefInput = {}): Promise<GenerateBriefResult> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置：请在 .env.local 设置 HXXBOT_SITE_URL 与 HXXBOT_API_KEY');
  }

  const variant = input.variant ?? 'full';
  const lang = input.lang ?? 'en';
  const mode = input.mode ?? 'brief';
  const scope = scopeKey(variant, lang, mode);

  if (!input.force) {
    const existing = await getLatestBrief({ briefType: 'world', scopeKey: scope });
    if (existing && Date.now() - existing.generated_at.getTime() < 2 * 60 * 1000) {
      return { brief: existing, cached: true, headlineCount: 0 };
    }
  }

  const limit = Math.min(input.headlineLimit ?? 12, 30);
  const items = await listRecentNews({
    variant,
    lang,
    limit,
    hours: input.hours ?? 24,
  });

  const headlines = deduplicateHeadlines(items.map((i) => i.title)).slice(0, limit);
  if (headlines.length === 0) {
    throw new Error('No recent headlines available for brief generation');
  }

  const { systemPrompt, userPrompt } = buildArticlePrompts(headlines, headlines, {
    mode,
    geoContext: input.geoContext ?? '',
    variant,
    lang,
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
      ? `World analysis (${variant}/${lang})`
      : `World brief (${variant}/${lang})`;

  const brief = await saveBrief({
    briefType: 'world',
    scopeKey: scope,
    title,
    body: qa.answer,
  });

  return { brief, cached: false, headlineCount: headlines.length };
}
