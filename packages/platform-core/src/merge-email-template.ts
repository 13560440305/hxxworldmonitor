import type { BriefSourceRef } from './brief-sources.js';
import { normalizeLangCode } from './subscription-rules.js';

/** Replaceable merge templates — register additional ids here later. */
export type MergeTemplateId = 'by-category-v1';

export const DEFAULT_MERGE_TEMPLATE_ID: MergeTemplateId = 'by-category-v1';

export interface SubscriptionDigestSlice {
  subscriptionId: string;
  subscriptionName: string;
  mode: 'keyword' | 'daily_brief';
  digestBody: string;
  sourceRefs: BriefSourceRef[];
  matchIds: string[];
}

export interface MergeTemplateContext {
  deliveryLang: string;
  userDisplayName: string | null;
  slices: SubscriptionDigestSlice[];
  generateCategoryBrief: (headlines: string[], categoryKey: string) => Promise<string>;
}

export interface MergeTemplateResult {
  templateId: MergeTemplateId;
  subject: string;
  briefBody: string;
  sourceRefs: BriefSourceRef[];
}

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  zh: {
    uncategorized: '综合',
    intel: '情报',
    crisis: '危机',
    middleeast: '中东',
    europe: '欧洲',
    us: '美国',
    politics: '政治',
    tech: '科技',
    ai: '人工智能',
    markets: '市场',
    finance: '金融',
    security: '安全',
    daily_brief: 'AI 简报',
  },
  en: {
    uncategorized: 'General',
    intel: 'Intelligence',
    crisis: 'Crisis',
    middleeast: 'Middle East',
    europe: 'Europe',
    us: 'United States',
    politics: 'Politics',
    tech: 'Technology',
    ai: 'AI',
    markets: 'Markets',
    finance: 'Finance',
    security: 'Security',
    daily_brief: 'AI Brief',
  },
};

function categoryLabel(categoryKey: string, deliveryLang: string): string {
  const lang = normalizeLangCode(deliveryLang) === 'zh' ? 'zh' : 'en';
  const map = CATEGORY_LABELS[lang] ?? CATEGORY_LABELS.en!;
  return map[categoryKey] ?? categoryKey;
}

function groupRefsByCategory(slices: SubscriptionDigestSlice[]): Map<string, BriefSourceRef[]> {
  const groups = new Map<string, BriefSourceRef[]>();

  for (const slice of slices) {
    if (slice.mode === 'daily_brief') {
      const key = 'daily_brief';
      const list = groups.get(key) ?? [];
      if (slice.sourceRefs.length) {
        list.push(...slice.sourceRefs);
      } else if (slice.digestBody.trim()) {
        list.push({
          news_item_id: '',
          title: slice.subscriptionName,
          link: '#',
          source: slice.subscriptionName,
          category: key,
        });
      }
      groups.set(key, list);
      continue;
    }

    if (!slice.sourceRefs.length) continue;
    for (const ref of slice.sourceRefs) {
      const key = ref.category?.trim() || 'uncategorized';
      const list = groups.get(key) ?? [];
      list.push(ref);
      groups.set(key, list);
    }
  }

  return groups;
}

function sortCategoryKeys(keys: string[]): string[] {
  const priority = ['crisis', 'middleeast', 'intel', 'europe', 'us', 'politics', 'security', 'daily_brief', 'tech', 'ai', 'markets', 'finance'];
  return [...keys].sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
}

/**
 * Default merge template: group matched sources by news category, AI brief per category.
 * Swap `DEFAULT_MERGE_TEMPLATE_ID` or add templates to customize layout later.
 */
export async function renderMergedDigestEmail(
  ctx: MergeTemplateContext,
  templateId: MergeTemplateId = DEFAULT_MERGE_TEMPLATE_ID,
): Promise<MergeTemplateResult> {
  if (templateId !== 'by-category-v1') {
    throw new Error(`Unknown merge template: ${templateId}`);
  }

  const lang = normalizeLangCode(ctx.deliveryLang);
  const groups = groupRefsByCategory(ctx.slices);
  const allRefs: BriefSourceRef[] = [];
  const bodyParts: string[] = [];

  const intro = lang === 'zh'
    ? `以下为您订阅的 ${ctx.slices.length} 个数据源合并简报（按类目整理）：`
    : `Combined digest from ${ctx.slices.length} subscriptions (by category):`;
  bodyParts.push(intro, '');

  for (const categoryKey of sortCategoryKeys([...groups.keys()])) {
    const refs = groups.get(categoryKey) ?? [];
    if (!refs.length) continue;

    const heading = lang === 'zh'
      ? `【${categoryLabel(categoryKey, lang)}】`
      : `[${categoryLabel(categoryKey, lang)}]`;
    bodyParts.push(heading);

    const headlines = refs.map((r) => r.title).filter(Boolean);
    if (headlines.length) {
      try {
        const brief = await ctx.generateCategoryBrief(headlines, categoryKey);
        if (brief.trim()) bodyParts.push('', brief.trim());
      } catch {
        const fallback = ctx.slices
          .flatMap((s) => (s.sourceRefs.some((r) => (r.category ?? 'uncategorized') === categoryKey) ? [s.digestBody] : []))
          .find((b) => b.trim());
        if (fallback?.trim()) bodyParts.push('', fallback.trim());
      }
    }

    bodyParts.push('');
    allRefs.push(...refs);
  }

  const totalItems = allRefs.filter((r) => r.link && r.link !== '#').length;
  const subject = lang === 'zh'
    ? `World Monitor — 合并简报（${totalItems || ctx.slices.length} 条）`
    : `World Monitor — Merged digest (${totalItems || ctx.slices.length} items)`;

  return {
    templateId,
    subject,
    briefBody: bodyParts.join('\n').trim(),
    sourceRefs: allRefs.filter((r) => r.link && r.link !== '#'),
  };
}
