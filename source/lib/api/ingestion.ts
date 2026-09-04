import { fetchJson, type FetchJsonOptions } from './http';

export function ingestionApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_INGESTION_API_BASE?.trim().replace(/\/$/, '') ?? '';
  return base ? `${base}${path}` : sameOriginPath(path);
}

export function ingestionTokenImageUrl(mint: string): string | null {
  const trimmed = mint.trim();
  if (trimmed.length === 0) return null;
  return ingestionApiUrl(`/api/token/${encodeURIComponent(trimmed)}/image`);
}

export function isIngestionApiConfigured(): boolean {
  return true;
}

export function fetchIngestionJson<T>(
  path: string,
  options?: FetchJsonOptions,
): Promise<T> {
  const url = ingestionApiUrl(path);
  return fetchJson<T>(url, options);
}

function sameOriginPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
