'use client';

import './token-row.css';
import { feeAuthority, sol, type FeeAuthority } from './rowData';

/*
 * THE FEE PANEL — the layout that was already there, in the product's
 * own colours.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ───────────────────────────────────
 *
 * The structure is untouched: title, the authority on its own row, the
 * status centred in a band between two rules, a SHARES label, then a
 * row per recipient with an avatar on the left and the figures right.
 *
 * Only the palette moved, to the one `groups-popover-v2.css` settled:
 *
 *   ground   #111111        a step UP in tone from a near-black board,
 *                           equal channels so the lift is tone and not
 *                           a colour cast
 *   edge     white at 12%
 *   radius   10px
 *   shadow   a long drop plus a faint outer glow, so it reads as raised
 *            rather than as a hole cut in the board
 *   ink      white for what matters on a line, 55% for its context,
 *            #4b4f5b for what is inert
 *
 * ── COLOUR IS SPENT ONCE ─────────────────────────────────────────────
 *
 * On locked or not. It is the only fact here that changes what every
 * figure below it MEANS, and an unlocked authority is a warning, so it
 * is red by default and green has to be earned.
 *
 * Everything else gave its colour up. The avatar was a pink disc for an
 * organisation and a grey one for a person — two hues carrying a
 * distinction the shape alone already makes, round against square. The
 * SOL figures were green, and a settled amount is not good news, it is
 * just an amount; green on it was competing with the one green in the
 * panel that means something.
 */

const CopyMark = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

function Lock({ locked }: { locked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      {locked ? <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /> : <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.8" />}
    </svg>
  );
}

export function FeePanelBody({ auth }: { auth: FeeAuthority }) {
  return (
    <>
      <span className="fp-title">Fee Authority</span>

      <span className="fp-addr">
        <span className="fp-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 3.2 20 8v8l-8 4.8L4 16V8z" />
          </svg>
        </span>
        <span className="fp-ca">{auth.authority}</span>
        <span className="fp-copy">{CopyMark}</span>
      </span>

      <span className="fp-band" data-locked={auth.locked ? '' : undefined}>
        <span className="fp-lock">
          <Lock locked={auth.locked} />
          {auth.locked ? 'Locked' : 'Unlocked'}
        </span>
        <span className="fp-sub">Status</span>
      </span>

      <span className="fp-sec">Shares</span>

      {auth.shares.map((s) => (
        <span className="fp-share" key={s.address}>
          {/*
            * Round for a person, square for an organisation — the only
            * distinction the data carries, and the shape makes it, so
            * the two hues that used to make it as well are gone.
            */}
          <span className="fp-av" data-org={s.org ? '' : undefined}>
            {s.name[0].toUpperCase()}
          </span>
          <span className="fp-who">
            <span className="fp-name">{s.name}</span>
            <span className="fp-addr2">
              {s.address}
              <span className="fp-copy sm">{CopyMark}</span>
            </span>
          </span>
          <span className="fp-amt">
            <span className="fp-pct">{s.pct.toFixed(2)}%</span>
            <span className="fp-sol">{sol(s.sol)} SOL</span>
          </span>
        </span>
      ))}
    </>
  );
}

