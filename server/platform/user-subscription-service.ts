import { getDefaultWorkspaceId } from '../_shared/db.js';
import { listPresets } from './preset-repository.js';
import {
  countUserActiveSubscriptions,
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  getSubscriptionByUserAndPreset,
  listSubscriptions,
} from './subscription-repository.js';
import { describeRulesLang } from './subscription-rules.js';
import {
  getWorkspaceSubscriptionPolicy,
  type WorkspaceSubscriptionPolicy,
} from './workspace-settings-repository.js';

export class SelfServiceSubscriptionError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'SelfServiceSubscriptionError';
  }
}

function assertSelfServiceEnabled(policy: WorkspaceSubscriptionPolicy): void {
  if (!policy.selfServiceSubscriptionsEnabled) {
    throw new SelfServiceSubscriptionError('self_service_disabled');
  }
}

export async function getUserSubscriptionCatalog(userId: string, workspaceId?: string) {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const policy = await getWorkspaceSubscriptionPolicy(ws);
  const presets = await listPresets({ workspaceId: ws, enabledOnly: true });
  const subs = await listSubscriptions({ userId, workspaceId: ws, enabledOnly: true });
  const presetSubMap = new Map(
    subs.filter((s) => s.preset_id).map((s) => [s.preset_id!, s]),
  );
  const activeCount = await countUserActiveSubscriptions(userId, ws);

  return {
    selfServiceEnabled: policy.selfServiceSubscriptionsEnabled,
    maxSubscriptionsPerUser: policy.maxSubscriptionsPerUser,
    activeSubscriptionCount: activeCount,
    canSubscribe: policy.selfServiceSubscriptionsEnabled
      && (policy.maxSubscriptionsPerUser === 0 || activeCount < policy.maxSubscriptionsPerUser),
    presets: presets.map((p) => {
      const sub = presetSubMap.get(p.id);
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        rules_summary: describeRulesLang(p.rules_json),
        subscribed: Boolean(sub),
        subscription_id: sub?.id ?? null,
      };
    }),
  };
}

export async function subscribeUserToPreset(
  userId: string,
  presetId: string,
  workspaceId?: string,
) {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const policy = await getWorkspaceSubscriptionPolicy(ws);
  assertSelfServiceEnabled(policy);

  const activeCount = await countUserActiveSubscriptions(userId, ws);
  if (policy.maxSubscriptionsPerUser > 0 && activeCount >= policy.maxSubscriptionsPerUser) {
    throw new SelfServiceSubscriptionError('subscription_limit_reached');
  }

  const existing = await getSubscriptionByUserAndPreset(userId, presetId, ws);
  if (existing?.enabled) {
    throw new SelfServiceSubscriptionError('already_subscribed');
  }

  const presets = await listPresets({ workspaceId: ws, enabledOnly: true });
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) {
    throw new SelfServiceSubscriptionError('preset_not_found');
  }

  const sub = await createSubscription({
    userId,
    presetId: preset.id,
    name: preset.title,
    workspaceId: ws,
    enabled: true,
  });

  return {
    id: sub.id,
    name: sub.name,
    preset_title: preset.title,
    enabled: sub.enabled,
    rules_summary: describeRulesLang(sub.rules_json),
    created_at: sub.created_at instanceof Date ? sub.created_at.toISOString() : String(sub.created_at),
  };
}

export async function unsubscribeUserSubscription(
  userId: string,
  subscriptionId: string,
  workspaceId?: string,
) {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const policy = await getWorkspaceSubscriptionPolicy(ws);
  assertSelfServiceEnabled(policy);

  const sub = await getSubscriptionById(subscriptionId);
  if (!sub || sub.user_id !== userId || sub.workspace_id !== ws) {
    throw new SelfServiceSubscriptionError('subscription_not_found');
  }

  const ok = await deleteSubscription(subscriptionId);
  if (!ok) {
    throw new SelfServiceSubscriptionError('subscription_not_found');
  }
  return { ok: true as const };
}
