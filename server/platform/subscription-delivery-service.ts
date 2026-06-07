import { isHxxbotConfigured } from '../_shared/hxxbot-config.js';
import { formatAiBriefEmailSections } from './brief-sources.js';
import { generateAiBrief, parseBriefSourceRefs } from './brief-service.js';
import { sendBriefEmail, sendEmailNotification } from './notification-service.js';
import {
  listPendingMatches,
  markMatchesNotified,
  runSubscriptionMatchPass,
} from './subscription-matcher.js';
import {
  getSubscriptionById,
  listSubscriptions,
  type SubscriptionRules,
  type SubscriptionWithUser,
} from './subscription-repository.js';
import {
  describeRulesLang,
  normalizeLangCode,
  resolveSubscriptionLangs,
} from './subscription-rules.js';
import { resolveHeadlinesForDelivery } from './translation-service.js';
import { getUserById } from './user-repository.js';
import { isSubscriberLoginAllowed } from './user-account.js';

export interface DeliveryResult {
  subscriptionId: string;
  subscriptionName: string;
  userEmail: string;
  mode: string;
  itemCount: number;
  deliveryId?: string;
  skipped?: string;
  error?: string;
  translatedCount?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHeadlinesHtml(
  items: Array<{ title: string; link: string; source: string; category: string | null }>,
): string {
  if (!items.length) return '<p>暂无匹配新闻。</p>';
  const rows = items
    .map((item) => {
      const cat = item.category ? `<span style="color:#666">[${escapeHtml(item.category)}]</span> ` : '';
      return `<li style="margin-bottom:8px">${cat}<a href="${escapeHtml(item.link)}">${escapeHtml(item.title)}</a> <small style="color:#888">— ${escapeHtml(item.source)}</small></li>`;
    })
    .join('\n');
  return `<ul style="padding-left:20px;line-height:1.5">${rows}</ul>`;
}

function buildHeadlinesText(
  items: Array<{ title: string; link: string; source: string; category: string | null }>,
): string {
  return items
    .map((item, i) => {
      const cat = item.category ? `[${item.category}] ` : '';
      return `${i + 1}. ${cat}${item.title}\n   ${item.link} (${item.source})`;
    })
    .join('\n\n');
}

function briefEmailGreeting(displayName: string | null | undefined, lang: string): string {
  const code = normalizeLangCode(lang);
  if (code === 'zh') {
    return displayName ? `您好，${displayName}，` : '您好，';
  }
  return displayName ? `Hello, ${displayName},` : 'Hello,';
}

async function deliverDailyBrief(sub: SubscriptionWithUser): Promise<DeliveryResult> {
  const rules = sub.rules_json;
  const variant = rules.variant ?? 'full';
  const { deliveryLang, contentLangs } = resolveSubscriptionLangs(rules, sub.user_preferred_lang);

  const generated = await generateAiBrief({
    variant,
    contentLangs,
    deliveryLang,
    mode: 'brief',
  });
  const subject =
    deliveryLang === 'zh'
      ? `World Monitor — ${sub.name} · AI 简报`
      : `World Monitor — ${sub.name} · AI Brief`;
  const bodyParts = [
    briefEmailGreeting(sub.user_display_name, deliveryLang),
    '',
    generated.brief.body,
    '',
    '— World Monitor',
  ];
  const briefBody = bodyParts.join('\n');
  const sourceRefs = parseBriefSourceRefs(generated.brief.source_refs_json);

  const sent = await sendBriefEmail({
    to: sub.user_email,
    subject,
    briefBody,
    html: true,
    userId: sub.user_id,
    briefId: generated.brief.id,
    sourceRefs,
    deliveryLang,
  });

  return {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    userEmail: sub.user_email,
    mode: 'daily_brief',
    itemCount: 0,
    deliveryId: sent.deliveryId,
  };
}

async function deliverKeywordDigest(sub: SubscriptionWithUser): Promise<DeliveryResult> {
  await runSubscriptionMatchPass(sub);
  const pending = await listPendingMatches(sub.id);

  if (!pending.length && !sub.rules_json.includeAiBrief) {
    return {
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      userEmail: sub.user_email,
      mode: 'keyword',
      itemCount: 0,
      skipped: 'no new matches',
    };
  }

  const deliveryLang = resolveSubscriptionLangs(sub.rules_json, sub.user_preferred_lang).deliveryLang;
  const resolved = await resolveHeadlinesForDelivery(
    pending.map((p) => ({
      news_item_id: p.news_item_id,
      title: p.title,
      link: p.link,
      source: p.source,
      category: p.category,
      lang: p.lang,
    })),
    deliveryLang,
  );
  const translatedCount = resolved.filter((r) => r.translated).length;

  let aiSectionText = '';
  let aiSectionHtml = '';
  if (sub.rules_json.includeAiBrief && isHxxbotConfigured()) {
    try {
      const { deliveryLang: briefDeliveryLang, contentLangs } = resolveSubscriptionLangs(
        sub.rules_json,
        sub.user_preferred_lang,
      );
      const brief = await generateAiBrief({
        variant: sub.rules_json.variant,
        contentLangs,
        deliveryLang: briefDeliveryLang,
      });
      const sourceRefs = parseBriefSourceRefs(brief.brief.source_refs_json);
      const aiSections = formatAiBriefEmailSections(
        brief.brief.body,
        sourceRefs,
        briefDeliveryLang,
      );
      aiSectionText = aiSections.text;
      aiSectionHtml = aiSections.html;
    } catch {
      /* optional */
    }
  }

  const subject = `World Monitor — ${sub.name}（${pending.length} 条更新 · ${deliveryLang}）`;
  const textBody = [
    `订阅「${sub.name}」匹配到 ${pending.length} 条新闻（${describeRulesLang(sub.rules_json)}）：`,
    '',
    buildHeadlinesText(resolved),
    aiSectionText,
    '',
    '— World Monitor',
  ].join('\n');

  const htmlBody = [
    `<p>订阅「<strong>${escapeHtml(sub.name)}</strong>」匹配到 ${pending.length} 条新闻`
    + `（订阅语言：<strong>${escapeHtml(deliveryLang)}</strong>）：</p>`,
    buildHeadlinesHtml(resolved),
    aiSectionHtml,
    '<p style="color:#888;margin-top:24px">— World Monitor</p>',
  ].join('\n');

  const sent = await sendEmailNotification({
    to: sub.user_email,
    subject,
    text: textBody,
    html_body: `<div style="font-family:sans-serif;line-height:1.5">${htmlBody}</div>`,
    userId: sub.user_id,
  });

  await markMatchesNotified(pending.map((p) => p.match_id));

  return {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    userEmail: sub.user_email,
    mode: 'keyword',
    itemCount: pending.length,
    translatedCount,
    deliveryId: sent.deliveryId,
  };
}

export async function deliverSubscription(subscriptionId: string): Promise<DeliveryResult> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置，无法发送邮件');
  }

  const sub = await getSubscriptionById(subscriptionId);
  if (!sub || !sub.enabled) {
    throw new Error('Subscription not found or disabled');
  }

  const user = await getUserById(sub.user_id);
  if (!user) throw new Error('Subscription user not found');
  if (!isSubscriberLoginAllowed(user)) {
    throw new Error('Subscription user is disabled or deleted');
  }

  const withUser: SubscriptionWithUser = {
    ...sub,
    user_email: user.email,
    user_display_name: user.display_name,
    user_preferred_lang: user.preferred_lang,
  };

  if (sub.rules_json.mode === 'daily_brief') {
    return deliverDailyBrief(withUser);
  }
  return deliverKeywordDigest(withUser);
}

export async function deliverAllEnabledSubscriptions(): Promise<{
  processed: number;
  results: DeliveryResult[];
  errors: Array<{ subscriptionId: string; error: string }>;
}> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置，无法发送邮件');
  }

  const subs = await listSubscriptions({ enabledOnly: true });
  const results: DeliveryResult[] = [];
  const errors: Array<{ subscriptionId: string; error: string }> = [];

  for (const sub of subs) {
    try {
      if (sub.rules_json.mode === 'daily_brief') {
        results.push(await deliverDailyBrief(sub));
      } else {
        results.push(await deliverKeywordDigest(sub));
      }
    } catch (err) {
      errors.push({
        subscriptionId: sub.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed: subs.length, results, errors };
}

export async function runMatchPassAll(): Promise<{ subscriptions: number; totalMatched: number }> {
  const subs = await listSubscriptions({ enabledOnly: true });
  let totalMatched = 0;
  for (const sub of subs) {
    if (sub.rules_json.mode === 'daily_brief') continue;
    const { matched } = await runSubscriptionMatchPass(sub);
    totalMatched += matched;
  }
  return { subscriptions: subs.length, totalMatched };
}

export function describeSubscriptionRules(rules: SubscriptionRules): string {
  const parts: string[] = [];
  if (rules.mode === 'daily_brief') parts.push('daily AI brief');
  if (rules.categories?.length) parts.push(`categories: ${rules.categories.join(',')}`);
  if (rules.keywords?.length) parts.push(`keywords: ${rules.keywords.join(',')}`);
  if (rules.variant) parts.push(`variant=${rules.variant}`);
  parts.push(describeRulesLang(rules));
  return parts.join(' · ') || 'all headlines';
}
