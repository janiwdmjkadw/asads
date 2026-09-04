'use client';

/**
 * The standalone bar, for judging a panel against the thing it hangs off.
 *
 * ── WHY THIS FILE EXISTS AGAIN ───────────────────────────────────────
 *
 * The nav sheet that first produced it was cleared once the nav shipped,
 * and this file went with it — but `sandbox/account/SealInBar.tsx` still
 * imports `NavBar` to stage the account panel under a real bar. This is a
 * rebuild to the contract that file and `account.css` depend on, not the
 * original: the geometry below is taken from the numbers they encode
 * rather than recovered.
 *
 * ── THE GEOMETRY THAT IS LOAD BEARING ────────────────────────────────
 *
 * `.am-stage-anchor` is `top: 69px; right: 22px`, and `SealInBar`'s note
 * spells out why: the bar is 60px over a 1px rule (so 61, plus the
 * popover's `sideOffset={8}` is 69), its right padding is 22px, and the
 * account tile is the last thing on it. Change any of those three and the
 * staged panel stops landing where the real popper would.
 *
 * It boots nothing — no providers, no queries, no streams. That is the
 * second rule `/whatever` enforces.
 */

import './nav-designs.css';

/** The destinations, in `TABS` order, lowercase as the bar renders them. */
const DESTS = ['discover', 'tracker', 'portfolio', 'rewards', 'frens', 'conditionals'] as const;

export interface NavBarProps {
  /** How Ask Soren is drawn. `trail` is the one that shipped. */
  readonly field?: 'trail' | 'plate' | 'none';
  /** How the right hand group is packed. `cluster` is the one that shipped. */
  readonly layout?: 'cluster' | 'spread';
  /** The conditional action: the setup chip, or Deposit once it exists. */
  readonly action?: 'deposit' | 'setup' | 'none';
  /** The wallet pill's treatment. `edge` is the one that shipped. */
  readonly wallet?: 'edge' | 'fill' | 'none';
  /** Which destination reads as current. */
  readonly active?: (typeof DESTS)[number];
}

export function NavBar({
  field = 'trail',
  layout = 'cluster',
  action = 'deposit',
  wallet = 'edge',
  active = 'discover',
}: NavBarProps = {}) {
  return (
    <div className={`nd-bar nd-layout-${layout}`}>
      <span className="nd-logo" aria-hidden />

      <span className="nd-tabs">
        {DESTS.map((d) => (
          <button key={d} type="button" className={`nd-tab${d === active ? ' is-on' : ''}`}>
            {d}
          </button>
        ))}
      </span>

      <span className="nd-end">
        {field === 'none' ? null : (
          <span className={`nd-field is-${field}`}>
            Ask Soren
            <span className="nd-kbd">⌘K</span>
          </span>
        )}

        <span className="nd-sq" aria-hidden>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
        </span>

        {action === 'none' ? null : (
          <button type="button" className="nd-action">
            {action === 'deposit' ? 'Deposit' : 'Set up agent wallet'}
          </button>
        )}

        {wallet === 'none' ? null : (
          <span className={`nd-wallet is-${wallet}`}>
            <span className="nd-num">100.5</span>
            <span className="nd-div" aria-hidden />
            <span className="nd-num">250.00</span>
          </span>
        )}

        <span className="nd-sq" aria-hidden>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8a6 6 0 10-12 0c0 7-2 9-2 9h16s-2-2-2-9" strokeLinejoin="round" />
            <path d="M10.3 21a2 2 0 003.4 0" strokeLinecap="round" />
          </svg>
        </span>

        {/* LAST on the bar, and the anchor `.am-stage-anchor` aligns to. */}
        <span className="nd-account" aria-hidden />
      </span>
    </div>
  );
}
