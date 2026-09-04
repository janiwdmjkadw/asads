'use client';

import type { ReactNode } from 'react';
import './chart-marks.css';

/*
 * ── SHEET 5 · THE CHART'S MARKS, AND THE CARD THEY OPEN ──────────────
 *
 * The last sheet, and the only one whose subjects are not on a row: the
 * discs the chart stacks over its candles, the card one opens, and the
 * claim's one line tooltip.
 *
 *
 * Bubbles are canvas in the product (`walletChartBubbles.ts` paints them
 * with `ctx.arc`), reproduced here in CSS at the same numbers — 20px
 * across, buy `#22c77e`, sell `#f0567a`, label in `#0b0d11`.
 *
 * The class is told by the LABEL, in the side's own colour:
 *
 *   B  / S    a tracked wallet with no emoji set
 *   emoji     a tracked wallet that has one
 *   picture   a KOL, its side as a ring since the fill is spoken for
 *   DB / DS   the dev
 *   SB / SS   a sniper
 *   insider   a bundler
 *   wallet    a claim, always green: money arriving, never leaving
 *   Y         you
 *   M         graduation, amber
 *   N         white, a candle with more than one trade on it
 */

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/* From `/assets/insider_icon.svg`, redrawn as currentColor so it takes
   the disc's ink rather than the file's own baked red. */
const Insider = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2C16.9706 2 21 6.02944 21 11V18.5C21 20.433 19.433 22 17.5 22C16.3001 22 15.2413 21.3962 14.6107 20.476C14.0976 21.3857 13.1205 22 12 22C10.8795 22 9.9024 21.3857 9.38728 20.4754C8.75869 21.3962 7.69985 22 6.5 22C4.63144 22 3.10487 20.5357 3.00518 18.692L3 18.5V11C3 6.02944 7.02944 2 12 2ZM12 4C8.21455 4 5.1309 7.00478 5.00406 10.7593L5 11L4.99927 18.4461L5.00226 18.584C5.04504 19.3751 5.70251 20 6.5 20C6.95179 20 7.36652 19.8007 7.64704 19.4648L7.73545 19.3478C8.57033 18.1248 10.3985 18.2016 11.1279 19.4904C11.3053 19.8038 11.6345 20 12 20C12.3651 20 12.6933 19.8044 12.8687 19.4934C13.5692 18.2516 15.2898 18.1317 16.1636 19.2151L16.2606 19.3455C16.5401 19.7534 16.9976 20 17.5 20C18.2797 20 18.9204 19.4051 18.9931 18.6445L19 18.5V11C19 7.13401 15.866 4 12 4ZM12 12C13.1046 12 14 13.1193 14 14.5C14 15.8807 13.1046 17 12 17C10.8954 17 10 15.8807 10 14.5C10 13.1193 10.8954 12 12 12ZM9.5 8C10.3284 8 11 8.67157 11 9.5C11 10.3284 10.3284 11 9.5 11C8.67157 11 8 10.3284 8 9.5C8 8.67157 8.67157 8 9.5 8ZM14.5 8C15.3284 8 16 8.67157 16 9.5C16 10.3284 15.3284 11 14.5 11C13.6716 11 13 10.3284 13 9.5C13 8.67157 13.6716 8 14.5 8Z" />
  </svg>
);

const WalletMark = (
  <svg viewBox="0 0 24 24" {...S} strokeWidth={2}>
    <path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2" />
    <path d="M16 12h5M16 16h5" />
  </svg>
);

/* ── the marks inside the card ────────────────────────────────────── */

const Copy = (
  <svg viewBox="0 0 24 24" {...S}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5H6.5A2.5 2.5 0 0 0 4 8v8" />
  </svg>
);

/**
 * Solscan's mark: the filled disc with the S cut out of it.
 *
 * Drawn, because there is no Solscan artwork in `public/assets` — the
 * product's existing Solscan links all use a generic arrow-out-of-a-box,
 * which is the thing being replaced here. Drop the real SVG into
 * `public/assets/solscan.svg` and this becomes an `<img>` in one line,
 * here and in `SolscanButton`.
 */
const Solscan = (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path
      d="M15.1 9.3c0-1.35-1.4-2.3-3.2-2.3-1.9 0-3.3 1-3.3 2.45 0 1.3.95 2.05 2.85 2.4l1 .18c1 .18 1.4.45 1.4.95 0 .6-.62 1-1.6 1-1.1 0-1.8-.42-1.9-1.13H8.5c.1 1.5 1.5 2.45 3.5 2.45 2 0 3.4-1 3.4-2.5 0-1.28-.85-2-2.75-2.35l-1.05-.2c-1.05-.2-1.45-.45-1.45-.95 0-.6.6-1 1.5-1 .95 0 1.6.42 1.7 1.05z"
      fill="#0e0f12"
    />
  </svg>
);

const Filter = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M4 6h16l-6.2 7.3V19l-3.6-2v-3.7z" />
  </svg>
);

const FACE = 'https://picsum.photos/seed/kol/64';

function One({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <span className="ci-one">
      {children}
      <small>{tag}</small>
    </span>
  );
}

function Wide({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <span className="ci-wide">
      {children}
      <small>{tag}</small>
    </span>
  );
}

/** The card a bubble opens. One trade, never a list. */
function Card({
  side,
  name,
  face,
  mark,
  amount,
  mc,
  ago,
  pnl,
  pnlPct,
}: {
  side: 'buy' | 'sell';
  name: string;
  face?: string;
  mark?: string;
  amount: string;
  mc: string;
  ago: string;
  pnl: string;
  pnlPct: string;
}) {
  const up = !pnl.startsWith('-');
  return (
    <div className="hc">
      <div className="hc-head">
        <span className="hc-face" data-buy={!face && side === 'buy' ? '' : undefined} data-sell={!face && side === 'sell' ? '' : undefined}>
          {face ? <img src={face} alt="" /> : mark}
        </span>
        <span className="hc-name">{name}</span>
        <button type="button" className="hc-ico" aria-label="Copy address">{Copy}</button>
        {/* The unit the figures are in. Pressing it swaps the card
            between dollars and SOL — the character IS the control, so
            there is nothing to learn. */}
        <button type="button" className="hc-ico" aria-label="Show in SOL">
          $
        </button>
      </div>

      <div className="hc-amt" data-buy={side === 'buy' ? '' : undefined} data-sell={side === 'sell' ? '' : undefined}>
        {amount}
      </div>

      <div className="hc-when">
        <span className="hc-side" data-buy={side === 'buy' ? '' : undefined} data-sell={side === 'sell' ? '' : undefined}>
          {side === 'buy' ? 'Buy' : 'Sell'}
        </span>
        <i>
          @ {mc} MC, {ago}
        </i>
        <button type="button" className="hc-ico" aria-label="Only this wallet">{Filter}</button>
      </div>

      <div className="hc-pnl">
        <span>
          <b>Realized PnL</b>
          <s data-up={up ? '' : undefined} data-down={up ? undefined : ''}>
            {pnl} ({pnlPct})
          </s>
        </span>
        <button type="button" className="hc-ico" data-out aria-label="View wallet on Solscan">
          {Solscan}
        </button>
      </div>
    </div>
  );
}

export function ChartMarksSheet() {
  return (
    <div className="ci">
      <h2>Bubbles</h2>
      <p className="ci-note">
        One per trade the chart knows the actor of. Green bought, pink sold, the label says who. A
        candle with more than one trade on it draws the white count instead of any of them.
      </p>

      <div className="ci-set">
        <One tag="Tracked buy"><span className="bub">B</span></One>
        <One tag="Tracked sell"><span className="bub" data-sell>S</span></One>
        <One tag="Emoji set"><span className="bub" data-emoji>🐷</span></One>
        <One tag="Emoji, sold"><span className="bub" data-sell data-emoji>🐷</span></One>
        <One tag="KOL bought"><span className="bub" data-kol><img src={FACE} alt="" /></span></One>
        <One tag="KOL sold"><span className="bub" data-kol data-sell><img src={FACE} alt="" /></span></One>
        <One tag="Dev bought"><span className="bub" data-two>DB</span></One>
        <One tag="Dev sold"><span className="bub" data-sell data-two>DS</span></One>
        <One tag="Sniper bought"><span className="bub" data-two>SB</span></One>
        <One tag="Sniper sold"><span className="bub" data-sell data-two>SS</span></One>
        <One tag="Bundler bought"><span className="bub">{Insider}</span></One>
        <One tag="Bundler sold"><span className="bub" data-sell>{Insider}</span></One>
        <One tag="Claimed"><span className="bub">{WalletMark}</span></One>
        <One tag="You bought"><span className="bub">Y</span></One>
        <One tag="You sold"><span className="bub" data-sell>Y</span></One>
        <One tag="Graduated"><span className="bub" data-kind="migration">M</span></One>
        <One tag="7 on one candle"><span className="bub" data-kind="count">7+</span></One>
      </div>

      <h2>The card a bubble opens</h2>
      <p className="ci-note">
        The old one was a list: hovering a busy candle put up to twelve rows of side, wallet, amount
        and time on screen at 10px, and every one of them was a trade you had not asked about. With
        one disc per candle there is one trade to talk about, so the card talks about it. Four
        marks, all the same 16px object with the same hover: copy the address, swap the unit between
        dollars and SOL, filter the pane to this wallet, and open it on Solscan.
      </p>

      <div className="ci-set" style={{ gap: 26 }}>
        <Wide tag="A sell">
          <Card
            side="sell"
            name="Jason"
            face={FACE}
            amount="$463"
            mc="$123K"
            ago="30m ago"
            pnl="-$409.9"
            pnlPct="-36%"
          />
        </Wide>

        <Wide tag="A buy">
          <Card
            side="buy"
            name="Jason"
            face={FACE}
            amount="$148.2"
            mc="$54.2K"
            ago="38m ago"
            pnl="+$1,204"
            pnlPct="+62%"
          />
        </Wide>

        <Wide tag="The dev">
          <Card
            side="buy"
            name="Dev"
            mark="DB"
            amount="$0.987"
            mc="$42.2K"
            ago="26m ago"
            pnl="-$1.194"
            pnlPct="-100%"
          />
        </Wide>
      </div>

      <h2>The claim tooltip</h2>
      <p className="ci-note">
        A claim has no side, no market cap and no position. It is one sentence, so it gets one line
        rather than a card with three empty rows in it.
      </p>
      <div className="ci-set">
        <Wide tag="Creator fees claimed">
          <span className="ct">
            <b>2k5h…pP5y</b> claimed 0.0₃ SOL
            <u>{WalletMark}</u>
          </span>
        </Wide>
      </div>
    </div>
  );
}
