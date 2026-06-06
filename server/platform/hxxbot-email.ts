import { HXXBOT_TOOLS, invokeHxxbotTool } from '../_shared/hxxbot-client.js';

const DELIVERY_MODES = new Set(['bulk_first', 'resend', 'smtp']);
const DEFAULT_DELIVERY = 'bulk_first';

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
  attachment_count?: number;
}

function normalizeDelivery(raw?: string): EmailDeliveryMode {
  const d = String(raw ?? '').trim().toLowerCase();
  if (!d || d === 'default' || d === 'auto') return DEFAULT_DELIVERY;
  if (d === 'bulk' || d === 'api' || d === 'resend_api') return 'resend';
  if (DELIVERY_MODES.has(d)) return d as EmailDeliveryMode;
  throw new Error('Invalid delivery mode; use bulk_first, resend, or smtp');
}

function parseRecipients(toRaw: string): string[] {
  return String(toRaw)
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
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
}

function buildToolInput(form: SendEmailInput, to: string): Record<string, unknown> {
  const toolInput: Record<string, unknown> = {
    to,
    subject: String(form.subject).trim(),
    delivery: normalizeDelivery(form.delivery),
  };
  const text = String(form.text ?? '').trim();
  const html = String(form.html_body ?? '').trim();
  if (text) toolInput.text = text;
  if (html) toolInput.html_body = html;
  if (form.from) toolInput.from = String(form.from).trim();
  if (form.from_name) toolInput.from_name = String(form.from_name).trim();
  if (form.sender) toolInput.sender = String(form.sender).trim();
  if (form.attachments?.length) toolInput.attachments = form.attachments;
  return toolInput;
}

export async function sendEmail(input: SendEmailInput): Promise<{
  results: Array<{ to: string; output: SendEmailOutput }>;
  sentCount: number;
}> {
  validateEmailInput(input);
  const recipients = parseRecipients(input.to);
  const results: Array<{ to: string; output: SendEmailOutput }> = [];

  for (const to of recipients) {
    const raw = await invokeHxxbotTool(HXXBOT_TOOLS.EMAIL_SEND, buildToolInput(input, to));
    results.push({
      to,
      output: {
        ok: raw.ok !== false,
        to: String(raw.to ?? to),
        from: raw.from != null ? String(raw.from) : undefined,
        from_name: raw.from_name != null ? String(raw.from_name) : undefined,
        content_type: raw.content_type != null ? String(raw.content_type) : undefined,
        delivery: raw.delivery != null ? String(raw.delivery) : undefined,
        fallback_used: raw.fallback_used === true,
        attachment_count:
          typeof raw.attachment_count === 'number' ? raw.attachment_count : undefined,
      },
    });
  }

  return { results, sentCount: results.length };
}
