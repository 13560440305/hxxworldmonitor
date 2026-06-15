export interface SubscriptionRules {
  categories?: string[];
  keywords?: string[];
  variant?: string;
  /** @deprecated Prefer contentLangs + deliveryLang */
  lang?: string;
  /** @deprecated Ignored for matching; kept for legacy rules_json only */
  contentLangs?: string[];
  /** Language for email / translated content delivered to subscriber */
  deliveryLang?: string;
  includeAiBrief?: boolean;
  maxItems?: number;
  mode?: 'daily_brief' | 'keyword';
  hours?: number;
}

const LANG_ALIASES: Record<string, string> = {
  ja: 'jp',
  jp: 'jp',
  ko: 'kor',
  kr: 'kor',
  kor: 'kor',
  fr: 'fra',
  fra: 'fra',
  es: 'spa',
  spa: 'spa',
  de: 'de',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  en: 'en',
};

export function normalizeLangCode(lang: string | undefined | null): string {
  if (!lang?.trim()) return 'en';
  const key = lang.trim().toLowerCase();
  return LANG_ALIASES[key] ?? key;
}

export function langsEquivalent(a: string | undefined, b: string | undefined): boolean {
  return normalizeLangCode(a) === normalizeLangCode(b);
}

/** Language used in subscription emails / AI output (user account preference wins). */
export function resolveDeliveryLang(rules: SubscriptionRules, userPreferredLang?: string): string {
  if (userPreferredLang?.trim()) {
    return normalizeLangCode(userPreferredLang);
  }
  return normalizeLangCode(rules.deliveryLang ?? rules.lang ?? 'en');
}

/** @deprecated No longer used to filter news_items; matching is language-agnostic. */
export function resolveContentLangs(_rules: SubscriptionRules): string[] | null {
  return null;
}

export interface ResolvedSubscriptionLangs {
  deliveryLang: string;
  /** @deprecated always null — matching no longer filters by source language */
  contentLangs: string[] | null;
  /** @deprecated use per-item translation at delivery time */
  needsTranslation: boolean;
}

/** Resolve delivery language for emails / AI briefs. Source language is not filtered at match time. */
export function resolveSubscriptionLangs(
  rules: SubscriptionRules,
  userPreferredLang?: string,
): ResolvedSubscriptionLangs {
  const deliveryLang = resolveDeliveryLang(rules, userPreferredLang);
  return { deliveryLang, contentLangs: null, needsTranslation: false };
}

export function normalizeRulesFromRaw(raw: unknown): SubscriptionRules {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const rules: SubscriptionRules = {};
  if (Array.isArray(r.categories)) {
    rules.categories = r.categories.map((c) => String(c).trim()).filter(Boolean);
  }
  if (Array.isArray(r.keywords)) {
    rules.keywords = r.keywords.map((k) => String(k).trim()).filter(Boolean);
  }
  if (typeof r.variant === 'string' && r.variant.trim()) rules.variant = r.variant.trim();
  if (typeof r.lang === 'string' && r.lang.trim()) rules.lang = normalizeLangCode(r.lang);
  if (Array.isArray(r.contentLangs)) {
    rules.contentLangs = r.contentLangs.map((l) => normalizeLangCode(String(l))).filter(Boolean);
  } else if (typeof r.contentLangs === 'string' && r.contentLangs.trim()) {
    rules.contentLangs = r.contentLangs.split(/[,，]/).map((s) => normalizeLangCode(s.trim())).filter(Boolean);
  }
  if (typeof r.deliveryLang === 'string' && r.deliveryLang.trim()) {
    rules.deliveryLang = normalizeLangCode(r.deliveryLang);
  }
  if (r.includeAiBrief === true) rules.includeAiBrief = true;
  if (typeof r.maxItems === 'number' && r.maxItems > 0) rules.maxItems = Math.min(r.maxItems, 50);
  if (r.mode === 'daily_brief' || r.mode === 'keyword') rules.mode = r.mode;
  if (typeof r.hours === 'number' && r.hours > 0) rules.hours = Math.min(r.hours, 168);
  return rules;
}

export const RULE_FIELD_LABELS: Record<string, string> = {
  mode: '模式',
  categories: '分类',
  keywords: '关键词',
  variant: '站点变体',
  lang: '语言(兼容)',
  contentLangs: '数据源语言',
  deliveryLang: '订阅语言',
  hours: '回溯小时',
  maxItems: '最大条数',
  includeAiBrief: '附带 AI 简报',
};

export const VARIANT_OPTIONS = ['full', 'tech', 'finance', 'happy'] as const;
export const DELIVERY_LANG_OPTIONS = ['zh', 'en', 'jp', 'kor', 'fra', 'de', 'spa'] as const;

/** Human-readable names for admin UI and email footers (Baidu-style codes + common RSS langs). */
export const LANG_DISPLAY_NAMES: Record<string, string> = {
  zh: '中文',
  en: 'English',
  jp: '日本語',
  ja: '日本語',
  kor: '한국어',
  ko: '한국어',
  kr: '한국어',
  fra: 'Français',
  fr: 'Français',
  de: 'Deutsch',
  spa: 'Español',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  pt: 'Português',
  it: 'Italiano',
  nl: 'Nederlands',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  sv: 'Svenska',
  cs: 'Čeština',
  el: 'Ελληνικά',
};

export function resolveLangDisplayName(code: string | undefined | null): string | null {
  if (!code?.trim()) return null;
  const key = code.trim().toLowerCase();
  if (LANG_DISPLAY_NAMES[key]) return LANG_DISPLAY_NAMES[key];
  const normalized = normalizeLangCode(code);
  return LANG_DISPLAY_NAMES[normalized] ?? null;
}

/** e.g. "中文 (zh)" for select options and chips */
export function formatLangSelectLabel(code: string): string {
  const name = resolveLangDisplayName(code);
  return name ? `${name} (${code})` : code;
}
export const MODE_OPTIONS = [
  { value: 'daily_brief', label: '每日 AI 简报' },
  { value: 'keyword', label: '关键词/分类匹配' },
] as const;

export function describeRulesLang(rules: SubscriptionRules, userPreferredLang?: string): string {
  const { deliveryLang } = resolveSubscriptionLangs(rules, userPreferredLang);
  return deliveryLang;
}
