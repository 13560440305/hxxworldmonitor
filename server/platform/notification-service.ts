import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { sendEmail, type SendEmailInput } from './hxxbot-email.js';

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
    throw new Error('HXXBOT 未配置：请在 .env.local 设置 HXXBOT_SITE_URL 与 HXXBOT_API_KEY');
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
}): Promise<{ deliveryId: string; sentCount: number }> {
  const text = opts.briefBody.trim();
  const payload: SendEmailInput = {
    to: opts.to,
    subject: opts.subject,
    from: opts.from,
    from_name: opts.from_name,
  };

  if (opts.html !== false) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>\n');
    payload.html_body = `<div style="font-family:sans-serif;line-height:1.5">${escaped}</div>`;
    payload.text = text;
  } else {
    payload.text = text;
  }

  const result = await sendEmailNotification({
    ...payload,
    userId: opts.userId,
    payloadRef: opts.briefId,
  });

  return { deliveryId: result.deliveryId, sentCount: result.sentCount };
}
