'use client';

// Coin-card display prefs (Tweaks → "Coin cards"). "Quickbuy always"
// replaces the idle score number with the quickbuy ⚡+amount permanently
// (normally a hover-only swap). Implemented as a root data attribute +
// two CSS rules (discover.css) so toggling costs zero card re-renders —
// the same class swap the hover state already performs, just pinned.

const QUICKBUY_ALWAYS_KEY = 'listen:quickbuy-always:v1';

/**
 * ON unless the user has explicitly turned it off. Quickbuy is the
 * card's primary action, and hiding it behind hover meant a board of
 * rows showed no way to buy until the pointer landed on one.
 *
 * The absent key and a stored 'false' are therefore DIFFERENT states:
 * only an explicit opt-out reads false, so flipping the default never
 * overrides someone who already chose off. `public/quickbuy-boot.js`
 * stamps the same rule before first paint — keep the two in step.
 */
const QUICKBUY_ALWAYS_DEFAULT = true;

export function getQuickbuyAlways(): boolean {
  if (typeof window === 'undefined') return QUICKBUY_ALWAYS_DEFAULT;
  try {
    const raw = window.localStorage.getItem(QUICKBUY_ALWAYS_KEY);
    return raw === null ? QUICKBUY_ALWAYS_DEFAULT : raw === 'true';
  } catch {
    return QUICKBUY_ALWAYS_DEFAULT;
  }
}

export function setQuickbuyAlways(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(QUICKBUY_ALWAYS_KEY, on ? 'true' : 'false');
  } catch {
    // Preference only.
  }
  applyQuickbuyAlwaysAttr();
}

/** Stamp the persisted pref onto <html>; call from any always-mounted
 *  surface (DiscoverPage does) — the attribute then survives client-side
 *  route changes. */
export function applyQuickbuyAlwaysAttr(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-qb-always', getQuickbuyAlways());
}
