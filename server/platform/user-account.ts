export type SubscriberAccountStatus = 'active' | 'disabled' | 'deleted';

export interface SubscriberUserRow {
  id: string;
  workspace_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  preferred_lang: string;
  delivery_mode: string;
  merged_delivery_time: string | null;
  merged_delivery_timezone: string;
  merged_delivery_last_sent_date: Date | null;
  created_at: Date;
  account_status: SubscriberAccountStatus;
  disabled_until: Date | null;
  deleted_at: Date | null;
}

export type PlatformUserRow = Pick<
  SubscriberUserRow,
  'id' | 'workspace_id' | 'email' | 'display_name' | 'role' | 'preferred_lang' | 'created_at'
>;

export const SUBSCRIBER_STATUS_LABELS: Record<SubscriberAccountStatus, string> = {
  active: '正常',
  disabled: '禁用',
  deleted: '已删除',
};

export function effectiveSubscriberStatus(
  row: Pick<SubscriberUserRow, 'account_status' | 'disabled_until'>,
): SubscriberAccountStatus {
  if (row.account_status === 'deleted') return 'deleted';
  if (row.account_status === 'disabled') {
    if (row.disabled_until && row.disabled_until.getTime() <= Date.now()) return 'active';
    return 'disabled';
  }
  return 'active';
}

export function isSubscriberLoginAllowed(
  row: Pick<SubscriberUserRow, 'account_status' | 'disabled_until' | 'deleted_at'>,
): boolean {
  if (row.deleted_at) return false;
  return effectiveSubscriberStatus(row) === 'active';
}

export function formatDisableSummary(
  row: Pick<SubscriberUserRow, 'account_status' | 'disabled_until'>,
): string {
  if (row.account_status !== 'disabled') return '';
  if (!row.disabled_until) return '永久禁用';
  const until = row.disabled_until.toLocaleString('zh-CN');
  if (effectiveSubscriberStatus(row) === 'active') return `禁用已过期（至 ${until}）`;
  return `禁用至 ${until}`;
}

export function toAdminUserJson(row: SubscriberUserRow): Record<string, unknown> {
  const effective = effectiveSubscriberStatus(row);
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    preferred_lang: row.preferred_lang,
    delivery_mode: row.delivery_mode,
    merged_delivery_time: row.merged_delivery_time,
    merged_delivery_timezone: row.merged_delivery_timezone,
    merged_delivery_last_sent_date: row.merged_delivery_last_sent_date
      ? (row.merged_delivery_last_sent_date instanceof Date
        ? row.merged_delivery_last_sent_date.toISOString().slice(0, 10)
        : String(row.merged_delivery_last_sent_date).slice(0, 10))
      : null,
    created_at: row.created_at,
    account_status: row.account_status,
    effective_status: effective,
    disabled_until: row.disabled_until?.toISOString() ?? null,
    disable_permanent: row.account_status === 'disabled' && !row.disabled_until,
    deleted_at: row.deleted_at?.toISOString() ?? null,
    disable_summary: formatDisableSummary(row),
  };
}
