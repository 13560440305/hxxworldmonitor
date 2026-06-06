declare const process: { env: Record<string, string | undefined> };

// ========================================================================
// Constants
// ========================================================================

export const CACHE_TTL_SECONDS = 86400; // 24 hours
export const CACHE_VERSION = 'v5';

// ========================================================================
// Hash utility (unified FNV-1a 52-bit -- H-7 fix)
// ========================================================================

import { hashString } from '../../../_shared/hash';
export { hashString };

// ========================================================================
// Cache key builder (ported from _summarize-handler.js)
// ========================================================================

export function getCacheKey(
  headlines: string[],
  mode: string,
  geoContext: string = '',
  variant: string = 'full',
  lang: string = 'en',
): string {
  const sorted = headlines.slice(0, 5).sort().join('|');
  const geoHash = geoContext ? ':g' + hashString(geoContext).slice(0, 6) : '';
  const hash = hashString(`${mode}:${sorted}`);
  const normalizedVariant = typeof variant === 'string' && variant ? variant.toLowerCase() : 'full';
  const normalizedLang = typeof lang === 'string' && lang ? lang.toLowerCase() : 'en';

  if (mode === 'translate') {
    const targetLang = normalizedVariant || normalizedLang;
    return `summary:${CACHE_VERSION}:${mode}:${targetLang}:${hash}${geoHash}`;
  }

  return `summary:${CACHE_VERSION}:${mode}:${normalizedVariant}:${normalizedLang}:${hash}${geoHash}`;
}

// ========================================================================
// Headline deduplication (used by SummarizeArticle)
// ========================================================================

// @ts-ignore -- plain JS module, no .d.mts needed for this pure function
export { deduplicateHeadlines } from './dedup.mjs';

// ========================================================================
// SummarizeArticle: Full prompt builder (ported from _summarize-handler.js)
// ========================================================================

export function buildArticlePrompts(
  headlines: string[],
  uniqueHeadlines: string[],
  opts: { mode: string; geoContext: string; variant: string; lang: string },
): { systemPrompt: string; userPrompt: string } {
  const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');
  const intelSection = opts.geoContext ? `\n\n${opts.geoContext}` : '';
  const isTechVariant = opts.variant === 'tech';
  const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}.${isTechVariant ? '' : ' Provide geopolitical context appropriate for the current date.'}`;
  const langInstruction = opts.lang && opts.lang !== 'en' ? `\nIMPORTANT: Output the summary in ${opts.lang.toUpperCase()} language.` : '';

  let systemPrompt: string;
  let userPrompt: string;

  if (opts.mode === 'brief') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Summarize the single most important tech/startup headline in 2 concise sentences MAX (under 60 words total).
Rules:
- Each numbered headline below is a SEPARATE, UNRELATED story
- Pick the ONE most significant headline and summarize ONLY that story
- NEVER combine or merge facts, names, or details from different headlines
- Focus ONLY on technology, startups, AI, funding, product launches, or developer news
- IGNORE political news, trade policy, tariffs, government actions unless directly about tech regulation
- Lead with the company/product/technology name
- No bullet points, no meta-commentary, no elaboration beyond the core facts${langInstruction}`;
    } else {
      systemPrompt = `${dateContext}

Summarize the single most important headline in 2 concise sentences MAX (under 60 words total).
Rules:
- Each numbered headline below is a SEPARATE, UNRELATED story
- Pick the ONE most significant headline and summarize ONLY that story
- NEVER combine or merge people, places, or facts from different headlines into one sentence
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject of the chosen headline
- If intelligence context is provided, use it only if it relates to your chosen headline
- No bullet points, no meta-commentary, no elaboration beyond the core facts${langInstruction}`;
    }
    userPrompt = `Each headline below is a separate story. Pick the most important ONE and summarize only that story:\n${headlineText}${intelSection}`;
  } else if (opts.mode === 'analysis') {
    if (isTechVariant) {
      systemPrompt = `${dateContext}

Analyze the most significant tech/startup development in 2 concise sentences MAX (under 60 words total).
Rules:
- Each numbered headline below is a SEPARATE, UNRELATED story
- Pick the ONE most significant story and analyze ONLY that
- NEVER combine facts from different headlines
- Focus ONLY on technology implications: funding trends, AI developments, market shifts, product strategy
- IGNORE political implications, trade wars, government unless directly about tech policy
- Lead with the insight, no filler or elaboration`;
    } else {
      systemPrompt = `${dateContext}

Analyze the most significant development in 2 concise sentences MAX (under 60 words total). Be direct and specific.
Rules:
- Each numbered headline below is a SEPARATE, UNRELATED story
- Pick the ONE most significant story and analyze ONLY that
- NEVER combine or merge people, places, or facts from different headlines
- Lead with the insight - what's significant and why
- NEVER start with "Breaking news", "Tonight", "The key/dominant narrative is"
- Start with substance, no filler or elaboration
- If intelligence context is provided, use it only if it relates to your chosen headline`;
    }
    userPrompt = isTechVariant
      ? `Each headline is a separate story. What's the key tech trend?\n${headlineText}${intelSection}`
      : `Each headline is a separate story. What's the key pattern or risk?\n${headlineText}${intelSection}`;
  } else if (opts.mode === 'translate') {
    const targetLang = opts.variant;
    systemPrompt = `You are a professional news translator. Translate the following news headlines/summaries into ${targetLang}.
Rules:
- Maintain the original tone and journalistic style.
- Do NOT add any conversational filler (e.g., "Here is the translation").
- Output ONLY the translated text.
- If the text is already in ${targetLang}, return it as is.`;
    userPrompt = `Translate to ${targetLang}:\n${headlines[0]}`;
  } else {
    systemPrompt = isTechVariant
      ? `${dateContext}\n\nPick the most important tech headline and summarize it in 2 concise sentences (under 60 words). Each headline is a separate story - NEVER merge facts from different headlines. Focus on startups, AI, funding, products. Ignore politics unless directly about tech regulation.${langInstruction}`
      : `${dateContext}\n\nPick the most important headline and summarize it in 2 concise sentences (under 60 words). Each headline is a separate, unrelated story - NEVER merge people or facts from different headlines. Lead with substance. NEVER start with "Breaking news" or "Tonight".${langInstruction}`;
    userPrompt = `Each headline is a separate story. Key takeaway from the most important one:\n${headlineText}${intelSection}`;
  }

  return { systemPrompt, userPrompt };
}

// ========================================================================
// SummarizeArticle: Provider credential resolution (OpenAI-compatible)
// ========================================================================

export interface ProviderCredentials {
  apiUrl: string;
  model: string;
  headers: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

const AI_PROVIDER_SLUGS = new Set(['ollama', 'groq', 'openrouter']);

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function buildCredentialsFromIntegration(
  provider: string,
  baseUrl: string,
  apiKey: string,
  modelName: string,
): ProviderCredentials | null {
  if (!baseUrl || !modelName) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const credentials: ProviderCredentials = {
    apiUrl: buildChatCompletionsUrl(baseUrl),
    model: modelName,
    headers,
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://worldmonitor.app';
    headers['X-Title'] = 'WorldMonitor';
  }

  if (provider === 'ollama') {
    credentials.extraBody = { think: false, max_tokens: 300 };
  }

  return credentials;
}

/** Build OpenAI-compatible credentials from explicit base URL / key / model (admin test + DB resolver). */
export function buildAiProviderCredentials(
  provider: string,
  baseUrl: string,
  apiKey: string,
  modelName: string,
): ProviderCredentials | null {
  return buildCredentialsFromIntegration(provider, baseUrl, apiKey, modelName);
}

/** Resolve OpenAI-compatible LLM credentials from DB (admin「AI 模型」). */
export async function getProviderCredentials(provider: string): Promise<ProviderCredentials | null> {
  if (!AI_PROVIDER_SLUGS.has(provider)) return null;

  const { getIntegrationProviderCached } = await import('../../../platform/integration-providers-repository.js');
  const { getProviderDefinition } = await import('../../../platform/integration-provider-catalog.js');
  const def = getProviderDefinition(provider);
  const resolved = await getIntegrationProviderCached(provider);
  if (!resolved?.enabled || !resolved.baseUrl || !resolved.modelName) return null;
  const needsKey = !def?.apiKeyOptional;
  if (needsKey && !resolved.apiKey) return null;
  return buildCredentialsFromIntegration(
    provider,
    resolved.baseUrl,
    resolved.apiKey,
    resolved.modelName,
  );
}
