import { CronExpressionParser } from 'cron-parser';

/** Compute next run instant for a job definition schedule. */
export function computeNextRunAt(opts: {
  scheduleKind: 'interval' | 'cron';
  cronExpr?: string | null;
  intervalSeconds?: number | null;
  timezone?: string;
  from?: Date;
}): Date {
  const from = opts.from ?? new Date();

  if (opts.scheduleKind === 'interval') {
    const sec = opts.intervalSeconds ?? 3600;
    return new Date(from.getTime() + sec * 1000);
  }

  const expr = opts.cronExpr?.trim();
  if (!expr) {
    return new Date(from.getTime() + 3600 * 1000);
  }

  const tz = opts.timezone?.trim() || 'UTC';
  const interval = CronExpressionParser.parse(expr, {
    currentDate: from,
    tz,
  });
  return interval.next().toDate();
}
