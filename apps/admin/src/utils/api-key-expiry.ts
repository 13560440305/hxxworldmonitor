/** Shared helpers for API Key expiry (permanent vs datetime-local). */

export function toDatetimeLocalValue(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultApiKeyExpiryLocal(daysAhead = 90): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return toDatetimeLocalValue(d);
}

export interface ApiKeyExpiryReadErrors {
  required: string;
  invalid: string;
}

export function readApiKeyExpiryOptions(
  root: ParentNode,
  radioName: string,
  inputId: string,
  errors: ApiKeyExpiryReadErrors,
): { permanent: boolean; expiresAt: string | null } {
  const mode = (root.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement | null)?.value;
  if (mode === 'until') {
    const raw = (root.querySelector(`#${inputId}`) as HTMLInputElement | null)?.value?.trim();
    if (!raw) throw new Error(errors.required);
    const until = new Date(raw);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      throw new Error(errors.invalid);
    }
    return { permanent: false, expiresAt: until.toISOString() };
  }
  return { permanent: true, expiresAt: null };
}

export function bindApiKeyExpiryToggle(
  root: ParentNode,
  radioName: string,
  inputId: string,
  wrapId?: string,
): void {
  const untilInput = root.querySelector(`#${inputId}`) as HTMLInputElement | null;
  const wrap = wrapId ? root.querySelector(`#${wrapId}`) as HTMLElement | null : null;
  if (!untilInput) return;
  const sync = (): void => {
    const mode = (root.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement | null)?.value;
    const showUntil = mode === 'until';
    if (wrap) wrap.hidden = !showUntil;
    untilInput.disabled = !showUntil;
  };
  root.querySelectorAll(`input[name="${radioName}"]`).forEach((el) => {
    el.addEventListener('change', sync);
  });
  sync();
}
