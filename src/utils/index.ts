export function formatTime(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  const lang = getCurrentLanguage();

  // Safe fallback if Intl is not available (though it is in all modern browsers)
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });

    if (diff < 60) return rtf.format(-Math.round(diff), 'second');
    if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
    return rtf.format(-Math.round(diff / 86400), 'day');
  } catch (e) {
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

/** Header map clock — local time, locale-aware format. */
export function formatHeaderClock(date: Date = new Date()): string {
  const lang = getCurrentLanguage();

  try {
    if (lang === 'en') {
      const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
      const tz = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${weekdays[date.getDay()]}, ${pad(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tz}`.trim();
    }

    return new Intl.DateTimeFormat(getLocale(), {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** @deprecated Use {@link formatHeaderClock} */
export const formatHeaderUtcClock = formatHeaderClock;

export function formatPrice(price: number): string {
  if (price >= 1000) {
    return `$${price.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  return `$${price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

export function getChangeClass(change: number): string {
  return change >= 0 ? 'up' : 'down';
}

export function getHeatmapClass(change: number): string {
  const abs = Math.abs(change);
  const direction = change >= 0 ? 'up' : 'down';

  if (abs >= 2) return `${direction}-3`;
  if (abs >= 1) return `${direction}-2`;
  return `${direction}-1`;
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  // Time-based throttling for non-visual work where a fixed minimum interval is desired.
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

export function rafSchedule<T extends (...args: unknown[]) => void>(fn: T): (...args: Parameters<T>) => void {
  // Frame-synchronized scheduling for visual updates; batches repeated calls into one render frame.
  let scheduled = false;
  let lastArgs: Parameters<T> | null = null;
  return (...args: Parameters<T>) => {
    lastArgs = args;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (lastArgs) {
          fn(...lastArgs);
          lastArgs = null;
        }
      });
    }
  };
}

export function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as T;
      // Merge with defaults for object types to handle new properties
      if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
        return { ...defaultValue, ...parsed };
      }
      return parsed;
    }
  } catch (e) {
    console.warn(`Failed to load ${key} from storage:`, e);
  }
  return defaultValue;
}

let _storageQuotaExceeded = false;

export function isStorageQuotaExceeded(): boolean {
  return _storageQuotaExceeded;
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
}

export function markStorageQuotaExceeded(): void {
  if (!_storageQuotaExceeded) {
    _storageQuotaExceeded = true;
    console.warn('[Storage] Quota exceeded — disabling further writes');
  }
}

export function saveToStorage<T>(key: string, value: T): void {
  if (_storageQuotaExceeded) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (isQuotaError(e)) {
      markStorageQuotaExceeded();
    } else {
      console.warn(`Failed to save ${key} to storage:`, e);
    }
  }
}

export function generateId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Breakpoint (px): below this width the app uses the simplified mobile layout. Must match CSS @media (max-width: …). */
export const MOBILE_BREAKPOINT_PX = 768;

/** True when viewport is below mobile breakpoint. Touch-capable notebooks keep desktop layout. */
export function isMobileDevice(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export { proxyUrl, fetchWithProxy } from './proxy';
export { exportToJSON, exportToCSV, ExportPanel } from './export';
export { buildMapUrl, parseMapUrlState } from './urlState';
export type { ParsedMapUrlState } from './urlState';
export { CircuitBreaker, createCircuitBreaker, getCircuitBreakerStatus, getCircuitBreakerCooldownInfo } from './circuit-breaker';
export type { CircuitBreakerOptions } from './circuit-breaker';
export * from './analysis-constants';
export { getCSSColor, invalidateColorCache } from './theme-colors';
export { getStoredTheme, getCurrentTheme, setTheme, applyStoredTheme } from './theme-manager';
export type { Theme } from './theme-manager';

import { getCurrentLanguage, getLocale } from '../services/i18n';
