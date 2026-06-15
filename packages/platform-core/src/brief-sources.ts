import { deduplicateHeadlines } from '../../../server/worldmonitor/news/v1/_shared.js';
import { normalizeLangCode } from './subscription-rules.js';

export interface BriefSourceRef {
  news_item_id: string;
  title: string;
  link: string;
  source: string;
  category: string | null;
}

export interface NewsItemForBriefSource {
  id: string;
  title: string;
  link: string;
  source: string;
  category: string | null;
}

/** Pick de-duplicated headlines used for brief generation, keeping URLs. */
export function selectBriefSourceItems(
  items: NewsItemForBriefSource[],
  limit: number,
): BriefSourceRef[] {
  const uniqueTitles = deduplicateHeadlines(items.map((i) => i.title)).slice(0, limit);
  const refs: BriefSourceRef[] = [];
  const usedIds = new Set<string>();

  for (const title of uniqueTitles) {
    const item = items.find((i) => i.title === title && !usedIds.has(i.id));
    if (!item) continue;
    usedIds.add(item.id);
    refs.push({
      news_item_id: item.id,
      title: item.title,
      link: item.link,
      source: item.source,
      category: item.category,
    });
  }
  return refs;
}

export function parseBriefSourceRefs(raw: unknown): BriefSourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefSourceRef[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const link = typeof r.link === 'string' ? r.link.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!link || !title) continue;
    out.push({
      news_item_id: typeof r.news_item_id === 'string' ? r.news_item_id : '',
      title,
      link,
      source: typeof r.source === 'string' ? r.source : '',
      category: typeof r.category === 'string' ? r.category : null,
    });
  }
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatBriefSourcesAppendix(
  sources: BriefSourceRef[],
  deliveryLang: string,
): { text: string; html: string } {
  if (!sources.length) return { text: '', html: '' };

  const lang = normalizeLangCode(deliveryLang);
  const heading = lang === 'zh' ? '参考来源' : 'Sources';

  const text = sources
    .map((s, i) => {
      const cat = s.category ? `[${s.category}] ` : '';
      return `${i + 1}. ${cat}${s.title}\n   ${s.link} (${s.source})`;
    })
    .join('\n\n');

  const htmlRows = sources
    .map((s, i) => {
      const cat = s.category
        ? `<span style="color:#666">[${escapeHtml(s.category)}] </span>`
        : '';
      return `<li style="margin-bottom:8px">${i + 1}. ${cat}<a href="${escapeHtml(s.link)}">${escapeHtml(s.title)}</a> <small style="color:#888">— ${escapeHtml(s.source)}</small></li>`;
    })
    .join('\n');

  return {
    text: `\n\n--- ${heading} ---\n\n${text}`,
    html: `\n<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">\n<p><strong>${heading}</strong></p>\n<ul style="padding-left:20px;line-height:1.5">${htmlRows}</ul>`,
  };
}

export function formatAiBriefEmailSections(
  body: string,
  sourceRefs: BriefSourceRef[],
  deliveryLang: string,
): { text: string; html: string } {
  const lang = normalizeLangCode(deliveryLang);
  const heading = lang === 'zh' ? 'AI 简报' : 'AI Brief';
  const appendix = formatBriefSourcesAppendix(sourceRefs, deliveryLang);
  return {
    text: `\n\n--- ${heading} ---\n\n${body.trim()}${appendix.text}`,
    html: `<hr><h3>${heading}</h3><p>${escapeHtml(body.trim()).replace(/\n/g, '<br>')}</p>${appendix.html}`,
  };
}
