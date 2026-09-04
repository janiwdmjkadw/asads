// Slice "Referral & Rewards": client-side persistence of a captured /fren
// slug between the public landing page and post-sign-up binding. Mirrors
// the invite-code `ACCESS_REDEEMED_STORAGE_KEY` localStorage pattern, plus
// a first-party cookie so attribution survives the sign-up redirect chain.
// Latest explicit referral link wins until a successful bind clears it. The
// server enforces permanent first-touch after bind; the client cache is only
// temporary pre-bind state.

export const PENDING_REFERRAL_KEY = 'listen.pendingReferral';
const COOKIE_NAME = 'listen_pending_ref';
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

/** Capture a slug from an explicit referral URL. Persists to localStorage + a cookie. */
export function rememberPendingReferral(slug: string): void {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) return;
  try {
    window.localStorage.setItem(PENDING_REFERRAL_KEY, normalized);
  } catch {
    // localStorage best-effort.
  }
  try {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(normalized)}; path=/; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
  } catch {
    // cookie best-effort.
  }
}

/** Read the captured slug from localStorage, falling back to the cookie. */
export function readPendingReferral(): string | null {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(PENDING_REFERRAL_KEY);
  } catch {
    value = null;
  }
  if (!value) value = readCookie(COOKIE_NAME);
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(normalized) ? normalized : null;
}

/** Clear the captured slug from both stores (after a successful bind). */
export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    // best-effort.
  }
  try {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
  } catch {
    // best-effort.
  }
}
