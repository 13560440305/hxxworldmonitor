import type { SubscriberUserRow } from './user-account.js';

export type DeliveryMode = 'individual' | 'merged';

export interface UserDeliveryPreferences {
  deliveryMode: DeliveryMode;
  /** Daily send time HH:MM in deliveryTimezone (both individual & merged). */
  deliveryTime: string;
  deliveryTimezone: string;
  deliveryLastSentDate: string | null;
}

const DEFAULT_DELIVERY_TIME = '08:00';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export function normalizeDeliveryMode(raw: string | null | undefined): DeliveryMode {
  return raw?.trim().toLowerCase() === 'merged' ? 'merged' : 'individual';
}

export function parseTimeHHMM(raw: string): { hour: number; minute: number } | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function normalizeDeliveryTime(raw: string | null | undefined): string {
  const parsed = raw?.trim() ? parseTimeHHMM(raw) : null;
  if (!parsed) return DEFAULT_DELIVERY_TIME;
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

/** @deprecated use normalizeDeliveryTime */
export const normalizeMergedDeliveryTime = normalizeDeliveryTime;

export function normalizeTimezone(raw: string | null | undefined): string {
  const tz = raw?.trim();
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function deliveryPreferencesFromUser(
  user: Pick<
    SubscriberUserRow,
    | 'delivery_mode'
    | 'merged_delivery_time'
    | 'merged_delivery_timezone'
    | 'merged_delivery_last_sent_date'
  >,
): UserDeliveryPreferences {
  const deliveryMode = normalizeDeliveryMode(user.delivery_mode);
  return {
    deliveryMode,
    deliveryTime: normalizeDeliveryTime(user.merged_delivery_time),
    deliveryTimezone: normalizeTimezone(user.merged_delivery_timezone),
    deliveryLastSentDate: user.merged_delivery_last_sent_date
      ? formatPgDate(user.merged_delivery_last_sent_date)
      : null,
  };
}

function formatPgDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function localDateString(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function localHourMinute(now: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

/** True when scheduled deliver should run on this worker tick (individual or merged). */
export function shouldSendScheduledNow(
  prefs: UserDeliveryPreferences,
  opts?: { now?: Date; workerIntervalMs?: number },
): boolean {
  const now = opts?.now ?? new Date();
  const tz = prefs.deliveryTimezone;
  const today = localDateString(now, tz);
  if (prefs.deliveryLastSentDate === today) return false;

  const scheduled = parseTimeHHMM(prefs.deliveryTime ?? DEFAULT_DELIVERY_TIME);
  if (!scheduled) return true;

  const current = localHourMinute(now, tz);
  const scheduledMinutes = scheduled.hour * 60 + scheduled.minute;
  const currentMinutes = current.hour * 60 + current.minute;
  const windowMinutes = Math.max(60, Math.ceil((opts?.workerIntervalMs ?? 3_600_000) / 60_000));

  return currentMinutes >= scheduledMinutes && currentMinutes < scheduledMinutes + windowMinutes;
}

/** @deprecated use shouldSendScheduledNow */
export const shouldSendMergedNow = shouldSendScheduledNow;

export function deliveryModeLabel(mode: DeliveryMode, lang = 'zh'): string {
  if (lang === 'zh') return mode === 'merged' ? '合并发送' : '单独发送';
  return mode === 'merged' ? 'Merged digest' : 'Individual';
}
