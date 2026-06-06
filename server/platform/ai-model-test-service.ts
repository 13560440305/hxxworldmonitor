import { CHROME_UA } from '../_shared/constants.js';
import { buildAiProviderCredentials } from '../worldmonitor/news/v1/_shared.js';
import { getProviderDefinition, isAiProviderSlug } from './integration-provider-catalog.js';
import { getIntegrationProvider } from './integration-providers-repository.js';

export interface AiModelTestDraft {
  baseUrl?: string;
  modelName?: string;
  /** When omitted, uses saved DB / env key */
  apiKey?: string;
}

export interface AiModelTestResult {
  ok: boolean;
  latencyMs: number;
  model?: string;
  reply?: string;
  error?: string;
  httpStatus?: number;
}

const TEST_TIMEOUT_MS = 180_000; // 3 minutes

export async function testAiModelConnection(
  slug: string,
  draft: AiModelTestDraft = {},
): Promise<AiModelTestResult> {
  if (!isAiProviderSlug(slug)) {
    return { ok: false, latencyMs: 0, error: 'Not an AI model provider' };
  }

  const def = getProviderDefinition(slug);
  if (!def) {
    return { ok: false, latencyMs: 0, error: 'Unknown provider' };
  }

  const saved = await getIntegrationProvider(slug);
  const baseUrl = draft.baseUrl?.trim() || saved?.baseUrl?.trim() || '';
  const modelName = draft.modelName?.trim() || saved?.modelName?.trim() || '';
  const apiKey = draft.apiKey?.trim()
    ? draft.apiKey.trim()
    : (saved?.apiKey?.trim() ?? '');

  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: '请填写 Base URL' };
  }
  if (!modelName) {
    return { ok: false, latencyMs: 0, error: '请填写模型名' };
  }
  if (!def.apiKeyOptional && !apiKey) {
    return { ok: false, latencyMs: 0, error: '请填写 API Key（或在管理后台保存后留空以使用已存密钥）' };
  }

  const credentials = buildAiProviderCredentials(slug, baseUrl, apiKey, modelName);
  if (!credentials) {
    return { ok: false, latencyMs: 0, error: '无法构建请求参数' };
  }

  const started = Date.now();
  try {
    const response = await fetch(credentials.apiUrl, {
      method: 'POST',
      headers: { ...credentials.headers, 'User-Agent': CHROME_UA },
      body: JSON.stringify({
        model: credentials.model,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly one word: OK',
          },
        ],
        temperature: 0,
        max_tokens: 16,
        ...credentials.extraBody,
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - started;
    const rawText = await response.text();

    if (!response.ok) {
      let detail = rawText.slice(0, 400);
      try {
        const parsed = JSON.parse(rawText) as { error?: { message?: string } };
        detail = parsed.error?.message ?? detail;
      } catch { /* use raw */ }
      return {
        ok: false,
        latencyMs,
        httpStatus: response.status,
        error: detail || `HTTP ${response.status}`,
      };
    }

    let reply = '';
    try {
      const data = JSON.parse(rawText) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      reply = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 120);
    } catch {
      return { ok: false, latencyMs, error: '响应不是有效的 JSON' };
    }

    if (!reply) {
      return { ok: false, latencyMs, error: '模型返回空内容' };
    }

    return {
      ok: true,
      latencyMs,
      model: credentials.model,
      reply,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const timeout = message.includes('timeout') || message.includes('aborted');
    return {
      ok: false,
      latencyMs,
      error: timeout ? '连接超时（3 分钟）' : message,
    };
  }
}
