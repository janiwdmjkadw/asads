import { fetchJson, type FetchJsonOptions } from './http';

const HOT_POLL_TIMEOUT_MS = 300;

export function tradingApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_TRADING_API_BASE?.trim().replace(/\/$/, '') ?? '';
  return base ? `${base}${path}` : sameOriginPath(path);
}

export function isTradingApiConfigured(): boolean {
  return true;
}

export function fetchTradingJson<T>(
  path: string,
  options?: FetchJsonOptions,
): Promise<T> {
  const url = tradingApiUrl(path);
  return fetchJson<T>(url, options);
}

export interface AuthenticatedFetchOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

export function authHeaders(authToken?: string | null, extra?: HeadersInit): HeadersInit | undefined {
  const headers = new Headers(extra);
  if (authToken) headers.set('authorization', `Bearer ${authToken}`);
  return [...headers.keys()].length > 0 ? headers : undefined;
}

export function fetchAuthenticatedApi(
  path: string,
  init: RequestInit = {},
  options: AuthenticatedFetchOptions = {},
): Promise<Response> {
  return fetch(tradingApiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: authHeaders(options.authToken, init.headers),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export function fetchHotTradePoll(path: string, options: AuthenticatedFetchOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), HOT_POLL_TIMEOUT_MS);
  return fetchAuthenticatedApi(path, { signal: controller.signal }, options).finally(() =>
    window.clearTimeout(timer),
  );
}

function sameOriginPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
