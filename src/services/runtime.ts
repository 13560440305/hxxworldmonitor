const WS_API_URL = import.meta.env.VITE_WS_API_URL || '';

const DEFAULT_REMOTE_HOSTS: Record<string, string> = {
  tech: WS_API_URL,
  full: WS_API_URL,
  world: WS_API_URL,
  happy: WS_API_URL,
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  return '';
}

export function getRemoteApiBaseUrl(): string {
  if (WS_API_URL) {
    return normalizeBaseUrl(WS_API_URL);
  }

  const variant = import.meta.env.VITE_VARIANT || 'full';
  const fromHosts = DEFAULT_REMOTE_HOSTS[variant] ?? DEFAULT_REMOTE_HOSTS.full ?? '';
  if (fromHosts) return fromHosts;

  return '';
}

export function toRuntimeUrl(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }

  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    return path;
  }

  return `${baseUrl}${path}`;
}

const WEB_REDIRECT_PATHS = [
  /^\/api\/[^/]+\/v1\//,
  /^\/api\/rss-proxy(?:\?|$)/,
  /^\/api\/polymarket(?:\?|$)/,
  /^\/api\/ais-snapshot(?:\?|$)/,
];
const ALLOWED_REDIRECT_HOSTS = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*worldmonitor\.app(:\d+)?$/;

function isAllowedRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_REDIRECT_HOSTS.test(parsed.origin) || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function installWebApiRedirect(): void {
  if (typeof window === 'undefined') return;
  if (!WS_API_URL) return;
  if (!isAllowedRedirectTarget(WS_API_URL)) {
    console.warn('[runtime] VITE_WS_API_URL blocked — not in hostname allowlist:', WS_API_URL);
    return;
  }
  if ((window as unknown as Record<string, unknown>).__wmWebRedirectPatched) return;

  const nativeFetch = window.fetch.bind(window);
  const API_BASE = WS_API_URL;
  const shouldRedirectPath = (pathWithQuery: string): boolean => WEB_REDIRECT_PATHS.some((pattern) => pattern.test(pathWithQuery));
  const shouldFallbackToOrigin = (status: number): boolean => status === 404 || status === 405 || status === 501;
  const fetchWithRedirectFallback = async (
    redirectedInput: RequestInfo | URL,
    originalInput: RequestInfo | URL,
    originalInit?: RequestInit,
  ): Promise<Response> => {
    try {
      const redirectedResponse = await nativeFetch(redirectedInput, originalInit);
      if (!shouldFallbackToOrigin(redirectedResponse.status)) return redirectedResponse;
      return nativeFetch(originalInput, originalInit);
    } catch {
      return nativeFetch(originalInput, originalInit);
    }
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === 'string' && shouldRedirectPath(input)) {
      return fetchWithRedirectFallback(`${API_BASE}${input}`, input, init);
    }
    if (input instanceof URL && input.origin === window.location.origin && shouldRedirectPath(`${input.pathname}${input.search}`)) {
      return fetchWithRedirectFallback(new URL(`${API_BASE}${input.pathname}${input.search}`), input, init);
    }
    if (input instanceof Request) {
      const u = new URL(input.url);
      if (u.origin === window.location.origin && shouldRedirectPath(`${u.pathname}${u.search}`)) {
        return fetchWithRedirectFallback(
          new Request(`${API_BASE}${u.pathname}${u.search}`, input),
          input.clone(),
          init,
        );
      }
    }
    return nativeFetch(input, init);
  };

  (window as unknown as Record<string, unknown>).__wmWebRedirectPatched = true;
}
