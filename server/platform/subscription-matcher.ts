import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import type { NewsItemRow } from './news-repository.js';
import type { SubscriptionRules, SubscriptionRow } from './subscription-repository.js';
import { resolveContentLangs } from './subscription-rules.js';

export interface MatchedNewsItem extends NewsItemRow {
  match_id?: string;
}

function titleMatchesKeywords(title: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const lower = title.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function itemMatchesRules(item: NewsItemRow, rules: SubscriptionRules): boolean {
  if (rules.variant && item.variant !== rules.variant) return false;
  const contentLangs = resolveContentLangs(rules);
  if (contentLangs?.length && !contentLangs.includes(item.lang)) return false;
  if (rules.categories?.length) {
    const cat = item.category ?? 'uncategorized';
    if (!rules.categories.includes(cat)) return false;
  }
  if (!titleMatchesKeywords(item.title, rules.keywords ?? [])) return false;
  return true;
}

export async function findMatchingNews(
  subscription: SubscriptionRow,
  opts?: { hours?: number; limit?: number },
): Promise<NewsItemRow[]> {
  const rules = subscription.rules_json;
  if (rules.mode === 'daily_brief') return [];

  const hours = opts?.hours ?? rules.hours ?? 24;
  const limit = Math.min(opts?.limit ?? rules.maxItems ?? 50, 100);
  const workspaceId = subscription.workspace_id ?? getDefaultWorkspaceId();
  const contentLangs = resolveContentLangs(rules);

  const params: unknown[] = [workspaceId, subscription.id, hours];
  let sql = `
    SELECT n.id, n.source, n.title, n.link, n.published_at, n.variant, n.lang,
           n.category, n.threat_level, n.is_alert, n.confidence
    FROM news_items n
    WHERE n.workspace_id = $1
      AND n.published_at >= NOW() - make_interval(hours => $3)
      AND NOT EXISTS (
        SELECT 1 FROM subscription_matches sm
        WHERE sm.subscription_id = $2 AND sm.news_item_id = n.id
      )
  `;

  if (rules.variant) {
    params.push(rules.variant);
    sql += ` AND n.variant = $${params.length}`;
  }
  if (contentLangs?.length) {
    params.push(contentLangs);
    sql += ` AND n.lang = ANY($${params.length}::text[])`;
  }
  if (rules.categories?.length) {
    params.push(rules.categories);
    sql += ` AND n.category = ANY($${params.length}::text[])`;
  }

  params.push(limit * 3);
  sql += ` ORDER BY n.published_at DESC LIMIT $${params.length}`;

  const res = await query<NewsItemRow>(sql, params);
  const keywords = rules.keywords ?? [];
  const filtered = res.rows.filter((item) => {
    if (keywords.length && !titleMatchesKeywords(item.title, keywords)) return false;
    return itemMatchesRules(item, rules);
  });
  return filtered.slice(0, limit);
}

export async function recordMatches(
  subscriptionId: string,
  newsIds: string[],
): Promise<number> {
  if (!newsIds.length) return 0;
  let inserted = 0;
  for (const newsItemId of newsIds) {
    const res = await query(
      `INSERT INTO subscription_matches (subscription_id, news_item_id)
       VALUES ($1, $2)
       ON CONFLICT (subscription_id, news_item_id) DO NOTHING`,
      [subscriptionId, newsItemId],
    );
    if (res.rowCount) inserted += 1;
  }
  return inserted;
}

export async function listPendingMatches(subscriptionId: string): Promise<
  Array<{
    match_id: string;
    news_item_id: string;
    title: string;
    link: string;
    source: string;
    lang: string;
    published_at: Date;
    category: string | null;
  }>
> {
  const res = await query<{
    match_id: string;
    news_item_id: string;
    title: string;
    link: string;
    source: string;
    lang: string;
    published_at: Date;
    category: string | null;
  }>(
    `SELECT sm.id AS match_id, n.id AS news_item_id, n.title, n.link, n.source, n.lang,
            n.published_at, n.category
     FROM subscription_matches sm
     JOIN news_items n ON n.id = sm.news_item_id
     WHERE sm.subscription_id = $1 AND sm.notified = FALSE
     ORDER BY n.published_at DESC`,
    [subscriptionId],
  );
  return res.rows;
}

export async function markMatchesNotified(matchIds: string[]): Promise<void> {
  if (!matchIds.length) return;
  await query(
    `UPDATE subscription_matches SET notified = TRUE WHERE id = ANY($1::uuid[])`,
    [matchIds],
  );
}

export async function runSubscriptionMatchPass(
  subscription: SubscriptionRow,
): Promise<{ matched: number; newsIds: string[] }> {
  const items = await findMatchingNews(subscription);
  const newsIds = items.map((i) => i.id);
  const matched = await recordMatches(subscription.id, newsIds);
  return { matched, newsIds };
}
