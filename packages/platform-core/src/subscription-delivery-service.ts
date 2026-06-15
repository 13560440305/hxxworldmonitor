import { isHxxbotConfigured } from '@hxxworldmonitor/shared/hxxbot-config.js';
import {
  deliveryPreferencesFromUser,
  shouldSendScheduledNow,
} from './delivery-preferences.js';
import {
  generateAiBrief,
  generateBriefFromHeadlines,
  parseBriefSourceRefs,
} from './brief-service.js';
import {
  renderMergedDigestEmail,
  type SubscriptionDigestSlice,
} from './merge-email-template.js';
import { sendBriefEmail } from './notification-service.js';
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
  resolveDeliveryLang,
  resolveSubscriptionLangs,
} from './subscription-rules.js';
import { resolveHeadlinesForDelivery } from './translation-service.js';
import { getUserById, markMergedDeliverySent } from './user-repository.js';
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
  merged?: boolean;
  subscriptionCount?: number;
}

export type { SubscriptionDigestSlice };

function briefEmailGreeting(displayName: string | null | undefined, lang: string): string {
  const code = normalizeLangCode(lang);
  if (code === 'zh') {
    return displayName ? `您好，${displayName}，` : '您好，';
  }
  return displayName ? `Hello, ${displayName},` : 'Hello,';
}

function localDateInTimezone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function collectDailyBriefSlice(sub: SubscriptionWithUser): Promise<SubscriptionDigestSlice | null> {
  const rules = sub.rules_json;
  const variant = rules.variant ?? 'full';
  const { deliveryLang } = resolveSubscriptionLangs(rules, sub.user_preferred_lang);
  const generated = await generateAiBrief({ variant, deliveryLang, mode: 'brief' });
  const sourceRefs = parseBriefSourceRefs(generated.brief.source_refs_json);
  return {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    mode: 'daily_brief',
    digestBody: generated.brief.body.trim(),
    sourceRefs,
    matchIds: [],
  };
}

async function collectKeywordDigestSlice(sub: SubscriptionWithUser): Promise<SubscriptionDigestSlice | null> {
  await runSubscriptionMatchPass(sub);
  const pending = await listPendingMatches(sub.id);

  if (!pending.length && !sub.rules_json.includeAiBrief) {
    return null;
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

  let sourceRefs = resolved.map((r) => ({
    news_item_id: r.news_item_id,
    title: r.title,
    link: r.link,
    source: r.source,
    category: r.category,
  }));

  let digestBody = '';
  if (pending.length > 0) {
    const digest = await generateBriefFromHeadlines({
      headlines: resolved.map((r) => r.title),
      sourceRefs,
      deliveryLang,
      variant: sub.rules_json.variant,
    });
    digestBody = digest.body;
  }

  if (sub.rules_json.includeAiBrief) {
    try {
      const globalBrief = await generateAiBrief({
        variant: sub.rules_json.variant,
        deliveryLang,
      });
      const heading = deliveryLang === 'zh' ? '【延伸阅读 · 全球简报】' : 'Global brief';
      digestBody = [digestBody, `${heading}\n\n${globalBrief.brief.body.trim()}`].filter(Boolean).join('\n\n');
      if (!sourceRefs.length) {
        sourceRefs.push(...parseBriefSourceRefs(globalBrief.brief.source_refs_json));
      }
    } catch {
      /* optional */
    }
  }

  if (!digestBody.trim() && !sourceRefs.length) return null;

  return {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    mode: 'keyword',
    digestBody: digestBody.trim(),
    sourceRefs,
    matchIds: pending.map((p) => p.match_id),
  };
}

async function collectSubscriptionDigestSlice(sub: SubscriptionWithUser): Promise<SubscriptionDigestSlice | null> {
  if (sub.rules_json.mode === 'daily_brief') {
    return collectDailyBriefSlice(sub);
  }
  return collectKeywordDigestSlice(sub);
}

async function deliverDailyBrief(sub: SubscriptionWithUser): Promise<DeliveryResult> {
  const rules = sub.rules_json;
  const variant = rules.variant ?? 'full';
  const { deliveryLang } = resolveSubscriptionLangs(rules, sub.user_preferred_lang);

  const generated = await generateAiBrief({
    variant,
    deliveryLang,
    mode: 'brief',
  });
  const subject =
    deliveryLang === 'zh'
      ? `World Monitor — ${sub.name} · AI 简报`
      : `World Monitor — ${sub.name} · AI Brief`;
  const briefBody = [
    briefEmailGreeting(sub.user_display_name, deliveryLang),
    '',
    generated.brief.body,
    '',
    '— World Monitor',
  ].join('\n');
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
  const slice = await collectKeywordDigestSlice(sub);
  if (!slice) {
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
  const pendingCount = slice.matchIds.length;
  const subject =
    deliveryLang === 'zh'
      ? `World Monitor — ${sub.name} · ${pendingCount} 条匹配`
      : `World Monitor — ${sub.name} · ${pendingCount} matches`;
  const intro =
    deliveryLang === 'zh'
      ? `${briefEmailGreeting(sub.user_display_name, deliveryLang)}\n\n订阅「${sub.name}」匹配到 ${pendingCount} 条新闻（${describeRulesLang(sub.rules_json, sub.user_preferred_lang)}）：`
      : `${briefEmailGreeting(sub.user_display_name, deliveryLang)}\n\nSubscription "${sub.name}" matched ${pendingCount} items (${describeRulesLang(sub.rules_json, sub.user_preferred_lang)}):`;
  const briefBody = [intro, '', slice.digestBody, '', '— World Monitor'].join('\n');

  const sent = await sendBriefEmail({
    to: sub.user_email,
    subject,
    briefBody,
    html: true,
    userId: sub.user_id,
    sourceRefs: slice.sourceRefs,
    deliveryLang,
  });

  if (slice.matchIds.length) {
    await markMatchesNotified(slice.matchIds);
  }

  return {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    userEmail: sub.user_email,
    mode: 'keyword',
    itemCount: pendingCount,
    deliveryId: sent.deliveryId,
  };
}

export async function deliverMergedSubscriptionsForUser(
  userId: string,
  opts?: { force?: boolean; workerIntervalMs?: number },
): Promise<DeliveryResult> {
  if (!isHxxbotConfigured()) {
    throw new Error('HXXBOT 未配置，无法发送邮件');
  }

  const user = await getUserById(userId);
  if (!user) throw new Error('User not found');
  if (!isSubscriberLoginAllowed(user)) {
    throw new Error('Subscription user is disabled or deleted');
  }

  const prefs = deliveryPreferencesFromUser(user);
  if (prefs.deliveryMode !== 'merged') {
    throw new Error('User delivery mode is not merged');
  }
  if (!opts?.force && !shouldSendScheduledNow(prefs, { workerIntervalMs: opts?.workerIntervalMs })) {
    return {
      subscriptionId: userId,
      subscriptionName: 'merged',
      userEmail: user.email,
      mode: 'merged',
      itemCount: 0,
      skipped: 'outside delivery window',
    };
  }

  const subs = await listSubscriptions({ userId, enabledOnly: true });
  if (!subs.length) {
    return {
      subscriptionId: userId,
      subscriptionName: 'merged',
      userEmail: user.email,
      mode: 'merged',
      itemCount: 0,
      skipped: 'no enabled subscriptions',
    };
  }

  const slices: SubscriptionDigestSlice[] = [];
  for (const sub of subs) {
    const slice = await collectSubscriptionDigestSlice(sub);
    if (slice) slices.push(slice);
  }

  if (!slices.length) {
    return {
      subscriptionId: userId,
      subscriptionName: 'merged',
      userEmail: user.email,
      mode: 'merged',
      itemCount: 0,
      skipped: 'no content to deliver',
    };
  }

  const deliveryLang = resolveDeliveryLang({}, user.preferred_lang);
  const merged = await renderMergedDigestEmail({
    deliveryLang,
    userDisplayName: user.display_name,
    slices,
    generateCategoryBrief: (headlines) =>
      generateBriefFromHeadlines({
        headlines,
        sourceRefs: [],
        deliveryLang,
      }).then((r) => r.body),
  });

  const briefBody = [
    briefEmailGreeting(user.display_name, deliveryLang),
    '',
    merged.briefBody,
    '',
    '— World Monitor',
  ].join('\n');

  const sent = await sendBriefEmail({
    to: user.email,
    subject: merged.subject,
    briefBody,
    html: true,
    userId: user.id,
    sourceRefs: merged.sourceRefs,
    deliveryLang,
  });

  const allMatchIds = slices.flatMap((s) => s.matchIds);
  if (allMatchIds.length) await markMatchesNotified(allMatchIds);

  await markMergedDeliverySent(userId, localDateInTimezone(new Date(), prefs.deliveryTimezone));

  return {
    subscriptionId: userId,
    subscriptionName: 'merged',
    userEmail: user.email,
    mode: 'merged',
    itemCount: merged.sourceRefs.length,
    deliveryId: sent.deliveryId,
    merged: true,
    subscriptionCount: slices.length,
  };
}

export async function deliverSubscription(
  subscriptionId: string,
  opts?: { force?: boolean },
): Promise<DeliveryResult> {
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

  const prefs = deliveryPreferencesFromUser(user);
  if (prefs.deliveryMode === 'merged') {
    return deliverMergedSubscriptionsForUser(sub.user_id, { force: opts?.force ?? true });
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

export async function deliverAllEnabledSubscriptions(opts?: {
  /** Manual/admin runs bypass the daily schedule window. */
  forceDeliver?: boolean;
  workerIntervalMs?: number;
}): Promise<{
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
  const byUser = new Map<string, SubscriptionWithUser[]>();

  for (const sub of subs) {
    const list = byUser.get(sub.user_id) ?? [];
    list.push(sub);
    byUser.set(sub.user_id, list);
  }

  const force = opts?.forceDeliver ?? false;

  for (const [userId, userSubs] of byUser) {
    try {
      const user = await getUserById(userId);
      if (!user || !isSubscriberLoginAllowed(user)) continue;

      const prefs = deliveryPreferencesFromUser(user);

      if (prefs.deliveryMode === 'merged') {
        results.push(await deliverMergedSubscriptionsForUser(userId, {
          force,
          workerIntervalMs: opts?.workerIntervalMs,
        }));
        continue;
      }

      if (!force && !shouldSendScheduledNow(prefs, { workerIntervalMs: opts?.workerIntervalMs })) {
        results.push({
          subscriptionId: userId,
          subscriptionName: `${user.email} (individual)`,
          userEmail: user.email,
          mode: 'individual',
          itemCount: 0,
          skipped: 'outside delivery window',
        });
        continue;
      }

      for (const sub of userSubs) {
        if (sub.rules_json.mode === 'daily_brief') {
          results.push(await deliverDailyBrief(sub));
        } else {
          results.push(await deliverKeywordDigest(sub));
        }
      }

      await markMergedDeliverySent(userId, localDateInTimezone(new Date(), prefs.deliveryTimezone));
    } catch (err) {
      errors.push({
        subscriptionId: userId,
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
