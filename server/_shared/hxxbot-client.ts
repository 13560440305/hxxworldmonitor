import {
  getHxxbotConfig,
  getToolInvokeUrl,
  isHxxbotConfigured,
} from './hxxbot-config.js';

export {
  getHxxbotConfig,
  getHxxbotPublicStatus,
  isHxxbotConfigured,
  resolveHxxbotApiBaseUrl,
  HxxbotConfigError,
} from './hxxbot-config.js';

export const HXXBOT_TOOLS = {
  EMAIL_SEND: 'builtin.email_send',
  QA_SESSION: 'builtin.qa_session',
  TRANSLATE: 'builtin.translate',
  TRANSLATE_LANGUAGES: 'builtin.translate_languages',
} as const;

export type HxxbotToolCode = (typeof HXXBOT_TOOLS)[keyof typeof HXXBOT_TOOLS];

export class HxxbotError extends Error {
  readonly httpStatus?: number;
  readonly code?: string;

  constructor(message: string, opts?: { httpStatus?: number; code?: string }) {
    super(message);
    this.name = 'HxxbotError';
    this.httpStatus = opts?.httpStatus;
    this.code = opts?.code;
  }
}

/** @deprecated use isHxxbotConfigured() */
export function isHxxbotEnabled(): boolean {
  return isHxxbotConfigured();
}

function parseOutput(data: Record<string, unknown>): Record<string, unknown> {
  let output = data.output;
  if (output == null && data.success !== false) {
    return data;
  }
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output) as unknown;
    } catch {
      return { raw: output };
    }
  }
  if (data.success === false) {
    throw new HxxbotError(
      String(data.error ?? data.message ?? 'Tool invoke failed'),
      { code: 'TOOL_REJECTED' },
    );
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return { raw: output };
}

/**
 * POST {apiBaseUrl}/v1/tools/:code/invoke — credentials from .env.local
 */
export async function invokeHxxbotTool(
  toolCode: HxxbotToolCode | string,
  input: Record<string, unknown> = {},
  opts?: { toolVersion?: string; apiKey?: string },
): Promise<Record<string, unknown>> {
  const config = getHxxbotConfig();
  const secret = opts?.apiKey ?? config.apiKey;
  const url = getToolInvokeUrl(toolCode);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': secret,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: input ?? {},
      tool_version: opts?.toolVersion ?? config.toolVersion,
    }),
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const raw = typeof data.raw === 'string' ? data.raw.trim() : '';
    const msg =
      String(data.error ?? data.message ?? '') ||
      (raw && raw.length < 200 ? raw : '') ||
      `Request failed (${response.status})`;
    throw new HxxbotError(
      response.status === 404 ? `${msg}. Endpoint: ${url}` : msg,
      { httpStatus: response.status, code: response.status === 402 ? 'INSUFFICIENT_CREDITS' : undefined },
    );
  }

  return parseOutput(data);
}

export function isHxxbotConfigError(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'HXXBOT_CONFIG';
}
