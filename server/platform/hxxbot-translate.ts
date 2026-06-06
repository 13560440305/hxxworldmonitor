import { HXXBOT_TOOLS, invokeHxxbotTool } from '../_shared/hxxbot-client.js';

export interface TranslateLanguage {
  code: string;
  name: string;
}

export interface TranslateLanguagesOutput {
  provider?: string;
  count?: number;
  languages: TranslateLanguage[];
}

export interface TranslateTextOutput {
  translated_text: string;
  original_text: string;
  from_language: string;
  to_language: string;
}

const DEFAULT_LANGUAGES: Record<string, string> = {
  auto: 'Auto-detect',
  zh: '中文',
  en: 'English',
  jp: '日语',
  kor: '韩语',
  fra: '法语',
  de: '德语',
  spa: '西班牙语',
};

function languagesOutputToList(output: Record<string, unknown>): TranslateLanguage[] {
  const list = output.languages;
  if (!Array.isArray(list)) return [];
  const out: TranslateLanguage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const code = String(row.code ?? row.Code ?? '').trim();
    if (!code) continue;
    const name = String(row.name ?? row.Name ?? code).trim();
    out.push({ code, name: name || code });
  }
  return out;
}

export async function getTranslateLanguages(locale = 'zh-CN'): Promise<TranslateLanguagesOutput> {
  try {
    const output = await invokeHxxbotTool(HXXBOT_TOOLS.TRANSLATE_LANGUAGES, {
      locale,
      lang: locale,
    });
    const languages = languagesOutputToList(output);
    if (languages.length === 0) throw new Error('Empty language list');
    return {
      provider: output.provider != null ? String(output.provider) : undefined,
      count: typeof output.count === 'number' ? output.count : languages.length,
      languages,
    };
  } catch (err) {
    console.warn('[hxxbot-translate] getTranslateLanguages fallback:', err);
    const languages = Object.entries(DEFAULT_LANGUAGES).map(([code, name]) => ({ code, name }));
    return { provider: 'fallback', count: languages.length, languages };
  }
}

export async function translateText(
  text: string,
  to: string,
  from = 'auto',
): Promise<TranslateTextOutput> {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) throw new Error('text is required');
  if (!String(to ?? '').trim()) throw new Error('to language is required');

  const output = await invokeHxxbotTool(HXXBOT_TOOLS.TRANSLATE, {
    text: trimmed,
    from: from || 'auto',
    to,
  });

  return {
    translated_text: String(output.translated_text ?? output.TranslatedText ?? ''),
    original_text: String(output.original_text ?? output.OriginalText ?? trimmed),
    from_language: String(output.from_language ?? output.FromLanguage ?? (from || 'auto')),
    to_language: String(output.to_language ?? output.ToLanguage ?? to),
  };
}
