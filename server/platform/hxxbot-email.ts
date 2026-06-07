import {
  getHxxbotConfig,
  getToolInvokeUrl,
  normalizeHxxbotApiBaseUrl,
} from '../_shared/hxxbot-config.js';
import { HxxbotError } from '../_shared/hxxbot-client.js';

/** Align with hxxnote/desktop modules/email-send-client.js */
export const EMAIL_SEND_TOOL_CODE = 'builtin.email_send';
export const EMAIL_SEND_TOOL_VERSION = '1.0.0';
const DEFAULT_DELIVERY = 'bulk_first';
const DELIVERY_MODES = new Set(['bulk_first', 'resend', 'smtp']);
const LOG_TAG = '[EmailSend]';

export type EmailDeliveryMode = 'bulk_first' | 'resend' | 'smtp';

export interface EmailAttachmentInput {
  filename: string;
  content_base64: string;
  content_type?: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text?: string;
  html_body?: string;
  from?: string;
  from_name?: string;
  sender?: string;
  delivery?: EmailDeliveryMode | string;
  attachments?: EmailAttachmentInput[];
}

export interface SendEmailOutput {
  ok: boolean;
  to?: string;
  from?: string;
  from_name?: string;
  content_type?: string;
  delivery?: string;
  fallback_used?: boolean;
  from_overridden?: boolean;
  attachment_count?: number;
  message?: string;
}

export function getEmailSendToolInvokeUrl(): string {
  return getToolInvokeUrl(EMAIL_SEND_TOOL_CODE);
}

export function normalizeDelivery(raw?: string): EmailDeliveryMode {
  const d = String(raw ?? '').trim().toLowerCase();
  if (!d || d === 'default' || d === 'auto') return DEFAULT_DELIVERY;
  if (d === 'bulk' || d === 'api' || d === 'resend_api') return 'resend';
  if (DELIVERY_MODES.has(d)) return d as EmailDeliveryMode;
  throw new Error('Invalid delivery mode; use bulk_first, resend, or smtp');
}

export function parseRecipients(toRaw: string): string[] {
  return String(toRaw)
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
}

/** Same as hxxnote parseSenderField — supports `Name <email@x.com>`. */
export function parseSenderField(fromRaw?: string, fromNameRaw?: string): { from: string; fromName: string } {
  let from = String(fromRaw ?? '').trim();
  let fromName = String(fromNameRaw ?? '').trim();
  if (!from) return { from: '', fromName };

  const angle = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (angle) {
    const namePart = angle[1].trim().replace(/^["']|["']$/g, '');
    from = angle[2].trim();
    if (!fromName && namePart) fromName = namePart;
  }
  if (from && !isValidEmail(from)) {
    throw new Error(`Invalid sender email: ${from}`);
  }
  return { from, fromName };
}

export function validateEmailInput(input: SendEmailInput): void {
  const recipients = parseRecipients(input.to);
  if (!recipients.length) throw new Error('Recipient email is required');
  for (const addr of recipients) {
    if (!isValidEmail(addr)) throw new Error(`Invalid recipient email: ${addr}`);
  }
  if (!String(input.subject ?? '').trim()) throw new Error('Subject is required');
  if (!String(input.text ?? '').trim() && !String(input.html_body ?? '').trim()) {
    throw new Error('Email body (text or html_body) is required');
  }
  if (input.delivery) normalizeDelivery(input.delivery);
  parseSenderField(input.from, input.from_name);
}

export function buildToolInputForRecipient(form: SendEmailInput, to: string): Record<string, unknown> {
  const subject = String(form.subject).trim();
  const text = String(form.text ?? '').trim();
  const html = String(form.html_body ?? '').trim();
  const toolInput: Record<string, unknown> = {
    to,
    subject,
    delivery: normalizeDelivery(form.delivery),
  };
  if (text) toolInput.text = text;
  if (html) toolInput.html_body = html;
  const { from, fromName } = parseSenderField(form.from, form.from_name);
  if (from) toolInput.from = from;
  if (fromName) toolInput.from_name = fromName;
  if (form.sender) toolInput.sender = String(form.sender).trim();
  if (form.attachments?.length) toolInput.attachments = form.attachments;
  return toolInput;
}

export function formatSendSuccessMessage(output: Record<string, unknown>, to?: string): string {
  if (!output || output.ok === false) return '邮件已发送';
  const parts = ['邮件已发送'];
  if (to) parts.push(`至 ${to}`);
  if (output.delivery) parts.push(`通道：${String(output.delivery)}`);
  if (output.from) {
    const fromLabel = output.from_name
      ? `${String(output.from_name)} <${String(output.from)}>`
      : String(output.from);
    parts.push(`发件：${fromLabel}`);
  }
  if (output.fallback_used === true) parts.push('（已 SMTP 补偿）');
  if (output.from_overridden === true) parts.push('（发件人已改用服务端默认邮箱）');
  if (typeof output.attachment_count === 'number' && output.attachment_count > 0) {
    parts.push(`附件 ${output.attachment_count} 个`);
  }
  return parts.join(' · ');
}

function mapEmailOutput(raw: Record<string, unknown>, to: string): SendEmailOutput {
  return {
    ok: raw.ok !== false,
    to: String(raw.to ?? to),
    from: raw.from != null ? String(raw.from) : undefined,
    from_name: raw.from_name != null ? String(raw.from_name) : undefined,
    content_type: raw.content_type != null ? String(raw.content_type) : undefined,
    delivery: raw.delivery != null ? String(raw.delivery) : undefined,
    fallback_used: raw.fallback_used === true,
    from_overridden: raw.from_overridden === true,
    attachment_count:
      typeof raw.attachment_count === 'number' ? raw.attachment_count : undefined,
  };
}

function unwrapToolOutput(data: Record<string, unknown>): Record<string, unknown> {
  let output: unknown = data.output;
  if (output == null) return data;
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output) as unknown;
    } catch {
      return { raw: output };
    }
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    return output as Record<string, unknown>;
  }
  return { raw: output };
}

/**
 * POST {apiBase}/v1/tools/builtin.email_send/invoke
 * Mirrors hxxnote/desktop modules/email-send-client.js invokeSkillTool().
 */
export async function invokeEmailSendTool(
  toolInput: Record<string, unknown>,
  opts?: { apiKey?: string; toolVersion?: string },
): Promise<{ output: SendEmailOutput; message: string; raw: Record<string, unknown> }> {
  const config = getHxxbotConfig();
  const secret = opts?.apiKey ?? config.apiKey;
  const url = getEmailSendToolInvokeUrl();
  const toolVersion = opts?.toolVersion ?? config.toolVersion ?? EMAIL_SEND_TOOL_VERSION;
  const to = String(toolInput.to ?? '');

  console.log(LOG_TAG, 'invoke.start', { url: normalizeHxxbotApiBaseUrl(config.apiBaseUrl), to, delivery: toolInput.delivery });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-Key': secret,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: toolInput,
      tool_version: toolVersion,
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
      `Email send failed (${response.status})`;
    console.error(LOG_TAG, 'invoke.failed', { httpStatus: response.status, to, error: msg });
    throw new HxxbotError(
      response.status === 404 ? `${msg}. Endpoint: ${url}` : msg,
      { httpStatus: response.status, code: response.status === 402 ? 'INSUFFICIENT_CREDITS' : undefined },
    );
  }

  if (data.success === false) {
    const msg = String(data.error ?? data.message ?? 'Email send rejected');
    console.error(LOG_TAG, 'invoke.rejected', { to, error: msg });
    throw new HxxbotError(msg, { code: 'TOOL_REJECTED' });
  }

  const parsed = unwrapToolOutput(data);
  if (parsed.ok === false) {
    const msg = String(parsed.error ?? parsed.message ?? 'Email send rejected');
    console.error(LOG_TAG, 'invoke.rejected', { to, error: msg });
    throw new HxxbotError(msg, { code: 'TOOL_REJECTED' });
  }

  const output = mapEmailOutput(parsed, to);
  output.message = formatSendSuccessMessage(parsed, to);
  console.log(LOG_TAG, 'invoke.ok', { to, delivery: output.delivery });
  return { output, message: output.message, raw: data };
}

export async function sendEmail(input: SendEmailInput): Promise<{
  results: Array<{ to: string; output: SendEmailOutput }>;
  sentCount: number;
  message?: string;
}> {
  validateEmailInput(input);
  const recipients = parseRecipients(input.to);
  const results: Array<{ to: string; output: SendEmailOutput }> = [];
  let lastMessage = '';

  for (const to of recipients) {
    const toolInput = buildToolInputForRecipient(input, to);
    const { output, message } = await invokeEmailSendTool(toolInput);
    lastMessage = message;
    results.push({ to, output });
  }

  return { results, sentCount: results.length, message: lastMessage };
}
