import { getIntegrationProvider } from './integration-providers-repository.js';
import { normalizeHxxbotApiBaseUrl } from '@hxxworldmonitor/shared/hxxbot-config.js';

export interface HxxbotTestDraft {
  baseUrl?: string;
  apiKey?: string;
}

export interface HxxbotTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  httpStatus?: number;
}

const TEST_TIMEOUT_MS = 60_000;

export async function testHxxbotConnection(
  draft: HxxbotTestDraft = {},
): Promise<HxxbotTestResult> {
  const saved = await getIntegrationProvider('hxxbot');
  const baseUrl = normalizeHxxbotApiBaseUrl(draft.baseUrl?.trim() || saved?.baseUrl || '');
  const apiKey = draft.apiKey?.trim() || saved?.apiKey?.trim() || '';

  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: '请填写 Base URL（示例：https://www.hxxbot.com/api）' };
  }
  if (!apiKey) {
    return { ok: false, latencyMs: 0, error: '请填写 API Key（或在保存后留空以使用已存密钥）' };
  }

  const url = `${baseUrl}/v1/tools/builtin.translate_languages/invoke`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: { locale: 'zh-CN' },
        tool_version: '1.0.0',
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - started;
    const rawText = await response.text();

    if (!response.ok) {
      let detail = rawText.slice(0, 400);
      try {
        const parsed = JSON.parse(rawText) as { error?: string; message?: string };
        detail = parsed.error ?? parsed.message ?? detail;
      } catch { /* use raw */ }
      return {
        ok: false,
        latencyMs,
        httpStatus: response.status,
        error: detail || `HTTP ${response.status}`,
      };
    }

    return { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const timeout = message.includes('timeout') || message.includes('aborted');
    return {
      ok: false,
      latencyMs,
      error: timeout ? '连接超时（60 秒）' : message,
    };
  }
}
