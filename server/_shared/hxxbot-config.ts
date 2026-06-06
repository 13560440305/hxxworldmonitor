import { isDatabaseEnabled } from './db.js';
import {
  getIntegrationProviderCached,
  invalidateIntegrationProviderCache,
  type ResolvedIntegrationProvider,
} from '../platform/integration-providers-repository.js';

declare const process: { env: Record<string, string | undefined> };

export class HxxbotConfigError extends Error {
  readonly code = 'HXXBOT_CONFIG';

  constructor(message: string) {
    super(message);
    this.name = 'HxxbotConfigError';
  }
}

let cachedProvider: ResolvedIntegrationProvider | null | undefined;

/** Load HXXBOT credentials from DB (called after migrations/seeds on startup). */
export async function refreshHxxbotConfigCache(): Promise<void> {
  if (!isDatabaseEnabled()) {
    cachedProvider = undefined;
    return;
  }
  try {
    cachedProvider = await getIntegrationProviderCached('hxxbot');
  } catch {
    cachedProvider = undefined;
  }
}

export function invalidateHxxbotConfigCache(): void {
  cachedProvider = undefined;
  invalidateIntegrationProviderCache();
}

/**
 * Resolve Open API base URL — from DB integration_providers only.
 */
export function resolveHxxbotApiBaseUrl(): string | undefined {
  if (cachedProvider?.enabled && cachedProvider.baseUrl) {
    return cachedProvider.baseUrl.replace(/\/+$/, '');
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
  if (!cachedProvider?.enabled || !cachedProvider.baseUrl) {
    throw new HxxbotConfigError(
      'HXXBOT 未配置：请在管理后台「数据源配置」中设置 Base URL 并启用',
    );
  }

  const apiBaseUrl = cachedProvider.baseUrl.replace(/\/+$/, '');
  const apiKey = cachedProvider.apiKey ?? '';
  if (requireKey && !apiKey) {
    throw new HxxbotConfigError(
      'HXXBOT 密钥未配置：请在管理后台「数据源配置」中设置 API Key',
    );
  }

  return {
    apiBaseUrl,
    apiKey,
    toolVersion: process.env.HXXBOT_TOOL_VERSION?.trim() || '1.0.0',
  };
}

export function isHxxbotConfigured(): boolean {
  if (cachedProvider?.enabled === false) return false;
  return Boolean(cachedProvider?.enabled && cachedProvider.baseUrl && cachedProvider.apiKey);
}

/** Safe summary for health/status endpoints — never exposes the secret. */
export function getHxxbotPublicStatus(): {
  configured: boolean;
  apiBaseUrl: string | null;
  hasApiKey: boolean;
  toolVersion: string | null;
  source: 'db' | null;
} {
  const apiBaseUrl = (cachedProvider?.enabled && cachedProvider.baseUrl)
    ? cachedProvider.baseUrl.replace(/\/+$/, '')
    : null;
  const hasApiKey = Boolean(cachedProvider?.enabled && cachedProvider.apiKey);
  return {
    configured: Boolean(apiBaseUrl && hasApiKey && cachedProvider?.enabled !== false),
    apiBaseUrl,
    hasApiKey,
    toolVersion: process.env.HXXBOT_TOOL_VERSION?.trim() || null,
    source: hasApiKey ? 'db' : null,
  };
}

export function getToolInvokeUrl(toolCode: string): string {
  const { apiBaseUrl } = getHxxbotConfig({ requireKey: false });
  return `${apiBaseUrl}/v1/tools/${encodeURIComponent(toolCode)}/invoke`;
}
