declare const process: { env: Record<string, string | undefined> };

export class HxxbotConfigError extends Error {
  readonly code = 'HXXBOT_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'HxxbotConfigError';
  }
}

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

/**
 * Resolve Open API base URL from `.env.local`:
 * - `HXXBOT_API_URL` — full base, e.g. https://www.hxxbot.com/api
 * - or `HXXBOT_SITE_URL` / `HXXBOT_BASE_URL` — site root, `/api` is appended
 */
export function resolveHxxbotApiBaseUrl(): string | undefined {
  const explicit = trimEnv('HXXBOT_API_URL');
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const site = trimEnv('HXXBOT_SITE_URL') ?? trimEnv('HXXBOT_BASE_URL');
  if (site) {
    return `${site.replace(/\/+$/, '')}/api`;
  }
  return undefined;
}

export interface HxxbotConfig {
  apiBaseUrl: string;
  apiKey: string;
  toolVersion: string;
}

export function getHxxbotConfig(opts?: { requireKey?: boolean }): HxxbotConfig {
  const requireKey = opts?.requireKey !== false;
  const apiBaseUrl = resolveHxxbotApiBaseUrl();
  if (!apiBaseUrl) {
    throw new HxxbotConfigError(
      'HXXBOT 未配置：请在 .env.local 中设置 HXXBOT_SITE_URL=https://www.hxxbot.com 或 HXXBOT_API_URL=https://www.hxxbot.com/api',
    );
  }

  const apiKey = trimEnv('HXXBOT_API_KEY');
  if (requireKey && !apiKey) {
    throw new HxxbotConfigError(
      'HXXBOT 密钥未配置：请在 .env.local 中设置 HXXBOT_API_KEY（用户中心 → 我的密钥）',
    );
  }

  return {
    apiBaseUrl,
    apiKey: apiKey ?? '',
    toolVersion: trimEnv('HXXBOT_TOOL_VERSION') ?? '1.0.0',
  };
}

export function isHxxbotConfigured(): boolean {
  return Boolean(resolveHxxbotApiBaseUrl() && trimEnv('HXXBOT_API_KEY'));
}

/** Safe summary for health/status endpoints — never exposes the secret. */
export function getHxxbotPublicStatus(): {
  configured: boolean;
  apiBaseUrl: string | null;
  hasApiKey: boolean;
  toolVersion: string | null;
} {
  const apiBaseUrl = resolveHxxbotApiBaseUrl() ?? null;
  const hasApiKey = Boolean(trimEnv('HXXBOT_API_KEY'));
  return {
    configured: Boolean(apiBaseUrl && hasApiKey),
    apiBaseUrl,
    hasApiKey,
    toolVersion: trimEnv('HXXBOT_TOOL_VERSION') ?? null,
  };
}

export function getToolInvokeUrl(toolCode: string): string {
  const { apiBaseUrl } = getHxxbotConfig({ requireKey: false });
  return `${apiBaseUrl}/v1/tools/${encodeURIComponent(toolCode)}/invoke`;
}
