import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { isHxxbotConfigured } from '@hxxworldmonitor/shared/hxxbot-config.js';
import type { BriefSourceRef } from './brief-sources.js';
import { sendEmail, type SendEmailInput } from './hxxbot-email.js';
import { normalizeLangCode } from './subscription-rules.js';
import { formatBriefSourcesAppendix } from './brief-sources.js';

export interface NotificationDeliveryRow {
  id: string;
  status: string;
  sent_at: Date | null;
  error: string | null;
}

async function createDelivery(opts: {
  workspaceId?: string;
  userId?: string;
  channel?: string;
  payloadRef?: string;
}): Promise<string> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const res = await query<{ id: string }>(
    `INSERT INTO notification_deliveries (workspace_id, user_id, channel, payload_ref, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [workspaceId, opts.userId ?? null, opts.channel ?? 'email', opts.payloadRef ?? null],
  );
  return res.rows[0]!.id;
}

async function finalizeDelivery(
  id: string,
  status: 'sent' | 'failed',
  error?: string,
): Promise<void> {
  await query(
    `UPDATE notification_deliveries
     SET status = $2, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END, error = $3
     WHERE id = $1`,
    [id, status, error ?? null],
  );
}

export async function sendEmailNotification(
  input: SendEmailInput & { userId?: string; payloadRef?: string },
): Promise<{
  deliveryId: string;
  sentCount: number;
  results: Awaited<ReturnType<typeof sendEmail>>['results'];
}> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置：请在管理后台「数据源配置」中设置 HXXBOT Base URL 与 API Key');
  }

  const deliveryId = await createDelivery({
    userId: input.userId,
    payloadRef: input.payloadRef,
    channel: 'email',
  });

  try {
    const { results, sentCount } = await sendEmail(input);
    await finalizeDelivery(deliveryId, 'sent');
    return { deliveryId, sentCount, results };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finalizeDelivery(deliveryId, 'failed', message);
    throw err;
  }
}

export async function sendBriefEmail(opts: {
  to: string;
  subject: string;
  briefBody: string;
  html?: boolean;
  from?: string;
  from_name?: string;
  userId?: string;
  briefId?: string;
  sourceRefs?: BriefSourceRef[];
  deliveryLang?: string;
}): Promise<{ deliveryId: string; sentCount: number }> {
  const baseText = opts.briefBody.trim();
  const deliveryLang = normalizeLangCode(opts.deliveryLang ?? 'en');
  let fullText = baseText;
  let sourcesHtml = '';

  if (opts.sourceRefs?.length) {
    const appendix = formatBriefSourcesAppendix(opts.sourceRefs, deliveryLang);
    fullText = baseText + appendix.text;
    sourcesHtml = appendix.html;
  }

  const payload: SendEmailInput = {
    to: opts.to,
    subject: opts.subject,
    from: opts.from,
    from_name: opts.from_name,
  };

  if (opts.html !== false) {
    const escaped = baseText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>\n');
    payload.html_body = `<div style="font-family:sans-serif;line-height:1.5">${escaped}${sourcesHtml}</div>`;
    payload.text = fullText;
  } else {
    payload.text = fullText;
  }

  const result = await sendEmailNotification({
    ...payload,
    userId: opts.userId,
    payloadRef: opts.briefId,
  });

  return { deliveryId: result.deliveryId, sentCount: result.sentCount };
}
