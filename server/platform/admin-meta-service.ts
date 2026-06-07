import { getDefaultWorkspaceId, isDatabaseEnabled, query } from '../_shared/db.js';
import { getHxxbotPublicStatus, refreshHxxbotConfigCache } from '../_shared/hxxbot-config.js';
import { checkRedisHealth, isRedisEnabled } from '../_shared/redis-client.js';
import { isLegacyAdminTokenConfigured, isSessionSigningConfigured } from '../_shared/admin-auth.js';
import { hasAdminUser } from './auth-repository.js';
import { getPlatformLogDir } from '../_shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };
import { countSubscriptions } from './subscription-repository.js';
import { listPresets } from './preset-repository.js';
import { countNewsItems } from './news-repository.js';
import { MODE_OPTIONS, VARIANT_OPTIONS, DELIVERY_LANG_OPTIONS, LANG_DISPLAY_NAMES } from './subscription-rules.js';

export async function getAdminStats(): Promise<Record<string, unknown>> {
  const ws = getDefaultWorkspaceId();
  if (isDatabaseEnabled()) {
    try {
      await refreshHxxbotConfigCache();
    } catch { /* stats still useful without HXXBOT */ }
  }
  const [usersRes, subs, newsCount, presets] = await Promise.all([
    query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM users WHERE workspace_id = $1 AND role = \'user\' AND account_status != \'deleted\'',
      [ws],
    ),
    countSubscriptions(ws),
    countNewsItems(ws),
    listPresets(),
  ]);

  return {
    users: Number(usersRes.rows[0]?.count ?? 0),
    subscriptions: subs,
    presets: presets.length,
    presetsEnabled: presets.filter((p) => p.enabled).length,
    newsItems: newsCount,
    redis: isRedisEnabled() ? await checkRedisHealth() : { enabled: false },
    hxxbot: getHxxbotPublicStatus(),
    adminAuth: isSessionSigningConfigured() || isLegacyAdminTokenConfigured(),
    hasAdminAccount: await hasAdminUser(),
    logging: {
      logDir: getPlatformLogDir(),
      level: process.env.PLATFORM_LOG_LEVEL ?? 'info',
      toFile: process.env.PLATFORM_LOG_TO_FILE !== 'false',
    },
  };
}

export async function getAdminMeta(): Promise<Record<string, unknown>> {
  const ws = getDefaultWorkspaceId();
  const [categoriesRes, langsRes] = await Promise.all([
    query<{ category: string; cnt: string }>(
      `SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*)::text AS cnt
       FROM news_items WHERE workspace_id = $1
       GROUP BY category ORDER BY COUNT(*) DESC LIMIT 40`,
      [ws],
    ),
    query<{ lang: string }>(
      `SELECT DISTINCT lang FROM news_items WHERE workspace_id = $1 ORDER BY lang`,
      [ws],
    ),
  ]);

  return {
    variants: VARIANT_OPTIONS,
    modes: MODE_OPTIONS,
    categories: categoriesRes.rows.map((r) => ({
      id: r.category,
      count: Number(r.cnt),
    })),
    langs: langsRes.rows.map((r) => r.lang),
    deliveryLangs: [...DELIVERY_LANG_OPTIONS],
    langLabels: LANG_DISPLAY_NAMES,
  };
}

/** Public catalog — enabled presets only, no admin auth */
export async function getPublicCatalog(): Promise<{ presets: Awaited<ReturnType<typeof listPresets>> }> {
  const presets = await listPresets({ enabledOnly: true, publicCatalog: true });
  return { presets };
}
