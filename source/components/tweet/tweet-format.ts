import { compactNumber } from '@/lib/format';

/**
 * `compactNumber` with a lowercase magnitude suffix — `1.2K → "1.2k"`,
 * `6.2M → "6.2m"`. Card-local so the rest of the app keeps uppercase.
 */
export function compactLower(value: number): string {
  return compactNumber(value).toLowerCase();
}

const MINUTE_MS = 60_000;
const AGE_FRESH_MS = 5 * MINUTE_MS; // < 5m  → green (fresh)
const AGE_AGING_MS = 60 * MINUTE_MS; // < 1h  → amber (aging); ≥ 1h → red

/**
 * Freshness tint for a tweet's age, using the theme's data colors:
 * green (`--up`) when fresh, amber (`--hold`) when aging, red (`--down`)
 * when stale. Takes elapsed ms (now − createdAt).
 */
export function ageColorVar(elapsedMs: number): string {
  if (elapsedMs < AGE_FRESH_MS) return 'var(--up)';
  if (elapsedMs < AGE_AGING_MS) return 'var(--hold)';
  return 'var(--down)';
}

/** "Joined Aug 2019" month/year for the author header. */
export function formatJoined(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(
      new Date(ms),
    );
  } catch {
    return '';
  }
}

/** "11:03 AM, Jun 1, 2026" — matches X's expanded-tweet timestamp. */
export function formatDateTime(ms: number): string {
  try {
    const d = new Date(ms);
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    const date = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
    return `${time}, ${date}`;
  } catch {
    return '';
  }
}
