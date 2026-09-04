import { useParams, usePathname } from 'next/navigation';

function validMint(raw: string | string[] | undefined): string | null {
  if (Array.isArray(raw)) return null;
  if (raw == null || raw.length === 0) return null;
  if (raw.length < 32 || raw.length > 64) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) return null;
  return raw;
}

export function useUrlMint(): string | null {
  const params = useParams<{ mint?: string }>();
  // Pathname fallback: the persistent trade pane renders OUTSIDE the
  // /trade/[mint] route segment, where useParams is empty. In-route
  // rendering keeps the params source (identical result either way).
  const pathname = usePathname();
  const fromParams = validMint(params.mint);
  if (fromParams) return fromParams;
  const match = /^\/trade\/([^/]+)$/.exec(pathname ?? '');
  return validMint(match?.[1] ? decodeURIComponent(match[1]) : undefined);
}
