'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './trade-panel.css';
import { SolDefs, SolMark } from '@/components/discover/column/sol';
import { PILL_MARKS } from '@/components/discover/column/Pills';
/* The pads out of the board's own data, so the badge is the REAL logo
   bitmap rather than a drawn stand in — and the ring colour beside it is
   the one sampled off that same artwork. */
import { PADS } from '@/components/discover/column/rowData';
import { WalletCountButton } from '@/components/trade/WalletCountButton';

/*
 * THE TRADE PANEL — the right rail of a coin's page.
 *
 * Everything you do to a token, in one column: the buy and sell control,
 * what you hold, and then the facts about the coin that are too long to
 * fit in the header.
 *
 * ── NO FLOW STRIP ────────────────────────────────────────────────────
 *
 * It opened with 24h Vol / Buys / Sells / Net Vol over a split bar,
 * which is the SAME four readings the header already carries at its
 * right end — the same numbers, twice, a few hundred pixels apart. The
 * header's copy is the one that stays; it has the window switcher on it.
 *
 * ── IT IS A SIDE, NOT A CARD ─────────────────────────────────────────
 *
 * No border, no corners, no plate of its own. It is the right edge of
 * the page — docked to it, running its full height — and a floating card
 * inside a pane is a card that has to explain why it is floating. One
 * hairline down its left is the whole frame.
 *
 * ── WHAT SEPARATES ITS SECTIONS ──────────────────────────────────────
 *
 * Sections that are part of the SAME act share a plate; sections that
 * are different acts are parted by space and a rule. Buying is one act —
 * amount, chips, settings and the button are one plate. What you hold is
 * another. What the coin IS is a third.
 *
 * ── FIXTURES ─────────────────────────────────────────────────────────
 *
 * Every figure is the reference's own, copied verbatim, so the layout is
 * tested against real lengths — "6mYcNBqiior9gYj…phga" is as long as a
 * real address, and "15.2K / $718K" is as wide as a real pair.
 */

/*
 * THE COIN THIS PANEL IS ABOUT.
 *
 * The rail is drawn from fixtures, and the wallet picker needs a real
 * mint rather than the elided `6mYcNBqiior9gYj…phga` that is printed in
 * Token Info: it is what the per wallet token balances are read for. On
 * the live page this is the route's mint.
 */
const PANEL_MINT = '6mYcNBqiior9gYjHiVjNPHnFdhP5Jz1kBqLpVpp2phga';

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const Chevron = (
  <svg viewBox="0 0 24 24" {...S}><path d="m6 9.5 6 6 6-6" /></svg>
);
const Pencil = (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /></svg>
);
/*
 * ── SLIPPAGE, AS SOMEONE SLIPPING ────────────────────────────────────
 *
 * It was a percent sign, which names the UNIT and not the setting —
 * three of the four figures on this row are percentages of something.
 *
 * A figure going out from under itself: head, a torso swept back, the
 * front leg kicked out and the floor it is about to meet. Drawn heavy
 * and with the arms left off, because at 15px a full stick figure is
 * five strokes converging on one joint and the joint wins.
 */
const Slip = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="16.4" cy="5" r="2.4" fill="currentColor" stroke="none" />
    <path d="M15 9 6.4 16.6" />
    <path d="M9.4 13.8 19.6 12" />
    <path d="M2.6 21.2h18.8" />
  </svg>
);
const Gas = (
  <svg viewBox="0 0 24 24" {...S}><rect x="4" y="4" width="10" height="16" rx="2" /><path d="M14 9h3a2 2 0 0 1 2 2v5a1.5 1.5 0 0 1-3 0v-3" /></svg>
);
const Tip = (
  <svg viewBox="0 0 24 24" {...S}><ellipse cx="12" cy="12" rx="8.5" ry="5" /></svg>
);
const Shield = (
  <svg viewBox="0 0 24 24" {...S}><path d="M12 3.5 19 6v6c0 4-3 7-7 8.5C8 19 5 16 5 12V6z" /></svg>
);
/*
 * ── THREE SHIELDS, ONE PER LEVEL ─────────────────────────────────────
 *
 * The same shield in all three cells would be decoration — a mark that
 * repeats says nothing the label has not already said. So the outline is
 * shared and what is INSIDE it carries the level: nothing and struck
 * through for off, a half filled for reduced, a tick for secure.
 */
const SHIELD = 'M12 3.5 19 6v6c0 4-3 7-7 8.5C8 19 5 16 5 12V6z';

const ShieldOff = (
  <svg viewBox="0 0 24 24" {...S}><path d={SHIELD} /><path d="M7 19 17.5 5.5" /></svg>
);
const ShieldHalf = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d={SHIELD} />
    <path d="M12 3.5 19 6v6c0 4-3 7-7 8.5z" fill="currentColor" stroke="none" />
  </svg>
);
const ShieldOn = (
  <svg viewBox="0 0 24 24" {...S}><path d={SHIELD} /><path d="m8.8 11.8 2.4 2.5 4.2-4.6" /></svg>
);
const Refresh = (
  <svg viewBox="0 0 24 24" {...S}><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20.5 4v4.5H16" /></svg>
);
const Search = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="10.6" cy="10.6" r="6.4" /><path d="m15.3 15.3 4.5 4.5" /></svg>
);
const Target = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
);
const Clock = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>
);
const Up = (
  <svg viewBox="0 0 24 24" {...S}><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg>
);
/* Pro traders: a bar chart rising. It shared the plain up arrow with the
   dev wallet chip below, which put one glyph on two unrelated things in
   the same section. */
const Pro = (
  <svg viewBox="0 0 24 24" {...S}><path d="M5 19V13M12 19V7M19 19v-9" /></svg>
);
const People = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="9.6" cy="8.4" r="3.4" /><path d="M3.8 19.4v-1.1a4.2 4.2 0 0 1 4.2-4.2h3.2a4.2 4.2 0 0 1 4.2 4.2v1.1" /><path d="M16.6 6.1a3.3 3.3 0 0 1 0 6.2M18.2 14.3a4.2 4.2 0 0 1 2.4 3.8v1.3" /></svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);
/*
 * The dev's own mark — the chef hat out of `PILL_MARKS`, which is what
 * the third line of a Discover row already uses for the dev's holding.
 *
 * It has been an up arrow and then a crown here. Both were wrong for the
 * same reason: "Dev Sell" is about WHO sells, and the product already
 * has a mark for that person. The crown is the dev's RECORD — migrations
 * shipped — which is a different fact about them.
 */
const DevSell = PILL_MARKS.dev;
const Dca = (
  <svg viewBox="0 0 24 24" {...S}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></svg>
);
/* Fresh wallets: a sprout. Both fresh readings share it — they are the
   same population counted two ways. */
const Leaf = (
  <svg viewBox="0 0 24 24" {...S}><path d="M20 4c0 8-4.5 13-11 13a5 5 0 0 1-5-5C4 6.5 11 4 20 4z" /><path d="M4 20c2-5 5.5-8.5 10-11" /></svg>
);
/*
 * Open elsewhere. A box with the arrow leaving it — the one action on
 * these rows that takes you off the page, so it is the only mark here
 * that points outward.
 */
const External = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M13.5 5H19v5.5" />
    <path d="M19 5l-7.5 7.5" />
    <path d="M18 14.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7.5A1.5 1.5 0 0 1 6 6h3.5" />
  </svg>
);
const Down = (
  <svg viewBox="0 0 24 24" {...S}><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></svg>
);
const Info = (
  <svg viewBox="0 0 24 24" {...S}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11.2v5" />
    <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);
const Plus = (
  <svg viewBox="0 0 24 24" {...S}><path d="M12 5v14M5 12h14" /></svg>
);
const Trash = (
  <svg viewBox="0 0 24 24" {...S}>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7" />
    <path d="M6.5 7.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-11.5" />
  </svg>
);
const Doc = (
  <svg viewBox="0 0 24 24" {...S}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></svg>
);


/*
 * One cell of the token-info grid: a figure over what it counts.
 *
 * `mark` is optional. Most readings are a percentage of something and
 * take a glyph for what that something is — holders, the dev, snipers.
 * The authority checks are not: "Mint Auth. — No" is a yes-or-no about a
 * permission, and there is no quantity for a mark to stand for.
 *
 * `extra` is the second figure on a split cell. Snipers is the one
 * reading here that is two facts — how MUCH supply they hold and how
 * MANY of them there are — and either alone is misleading: 13 snipers on
 * 0% is noise, one sniper on 40% is the whole story.
 */
function Cell({
  mark,
  value,
  extra,
  label,
  tone,
}: {
  mark?: React.ReactNode;
  value: string;
  extra?: string;
  label: string;
  tone: 'bad' | 'ok' | 'flat';
}) {
  return (
    <div className="tp-cell" data-tone={tone}>
      <span className="tp-cell-v">
        {mark}
        {value}
        {extra ? (
          <>
            <i className="tp-cell-sep" aria-hidden />
            {extra}
          </>
        ) : null}
      </span>
      <span className="tp-cell-k">{label}</span>
    </div>
  );
}

/*
 * ── THE TOKENS WEARING THE SAME NAME ─────────────────────────────────
 *
 * The row that matters is the WHOLE row. You are not scanning for a
 * ticker — every one of these is called some version of Finn, which is
 * the point — you are scanning for the one with liquidity in it. So the
 * picture, the name, the age and the three figures all have to be on
 * screen at once, and the figures have to be in a column you can run
 * your eye down.
 */
const SIMILAR = [
  { tick: 'Finn', name: 'Finn', pad: 'pumpfun', age: '1h', liq: '$6K', vol: '$199', mc: '$3K' },
  { tick: '$Finn', name: 'Finn', pad: 'pumpfun', age: '1h', liq: '$6K', vol: '$98', mc: '$3K' },
  { tick: 'F*INN', name: 'THE F WORD', pad: 'pumpfun', age: '1yr', liq: '$5K', vol: '$0', mc: '$2K' },
  { tick: 'RETARD', name: 'finn is a retard', pad: 'bonk', age: '8mo', liq: '$5K', vol: '$0', mc: '$4K' },
  { tick: 'FINN', name: 'Finn', pad: 'moonit', age: '1yr', liq: '$9K', vol: '$0', mc: '$5K' },
] as const;

export function TokenTradePanel() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [mode, setMode] = useState<'market' | 'limit' | 'adv'>('market');
  const [preset, setPreset] = useState(0);
  /* The preset's own settings, opened by pressing the preset you are
     already on. Buy and sell are configured separately because they are
     different orders — a slippage that is right for getting in is not
     the one you want for getting out. */
  const [pOpen, setPOpen] = useState(false);
  const [pSide, setPSide] = useState<'buy' | 'sell'>('buy');
  const [autoFee, setAutoFee] = useState(false);
  const [mev, setMev] = useState<'off' | 'red' | 'sec'>('red');
  const [adv, setAdv] = useState(false);
  /* The exit legs the strategy is built from. Each is one rule: what
     fires it, and how much of the position it sells. */
  const [exits, setExits] = useState<{ id: number; kind: 'tp' | 'sl' | 'dev'; at: string; amt: string }[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  /* Which advanced order. Only read while `mode` is `adv`. */
  const [strat, setStrat] = useState<'dev' | 'trail' | 'dca'>('dev');
  /* The limit level, as a distance from the current market cap. */
  const [pct, setPct] = useState(0);
  const [amount, setAmount] = useState('');
  /* The four shortcuts, and whether the pencil has them open. They are
     state rather than a constant because the pencil edits them. */
  const [quick, setQuick] = useState(['0.01', '0.1', '1', '10']);
  const [editQ, setEditQ] = useState(false);
  /* The position figures read in SOL or in dollars. One control flips
     all four, because comparing a bought in SOL against a PnL in USD is
     the mistake the toggle exists to prevent. */
  const [denom, setDenom] = useState<'sol' | 'usd'>('sol');
  const [spin, setSpin] = useState(false);
  /* Trailing stop is a SELL-side order — it exists to get you out. So it
     is not offered on a buy, and a strategy left selected from the sell
     side falls back rather than sitting there unreachable. */
  const strategy = side === 'buy' && strat === 'trail' ? 'dev' : strat;
  /* Token Info folds away, and it starts folded. Nine readings is the
     tallest block on the rail, and once you have looked at them they are
     the thing standing between you and the addresses under them. Most
     visits to this panel are to trade, not to read the readings, so the
     rail opens with them out of the way and one click brings them back. */
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoSpin, setInfoSpin] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [similarOpen, setSimilarOpen] = useState(false);

  /*
   * ── ON A PHONE THE RAIL IS A SHEET WITH THREE STOPS ─────────────────
   *
   * Below 700 there is no room for a column beside the chart, so the
   * panel docks to the bottom of the window.
   *
   *   down   the handle and nothing else. The chart gets the whole
   *          screen, which is the point of putting it away.
   *   peek   the order itself — side, amount, and the buy button.
   *   up     the whole panel.
   *
   * Two stops was not enough. The peek covers a third of a phone, and
   * there was no way to get it off the screen at all: you could open it
   * or half open it. `down` is what makes the sheet a sheet rather than
   * a permanent bottom bar.
   *
   * It DRAGS between them rather than only toggling. A sheet that can
   * only be tapped teaches you nothing about where it goes, and the
   * thumb is already on it.
   */
  const DOWN = 34;
  const PEEK = 330;
  type Stop = 'down' | 'peek' | 'up';
  /*
   * ── IT STARTS DOWN ───────────────────────────────────────────────
   *
   * The arithmetic decides this. On a 812px phone the nav and header
   * take about 185, the sheet's peek takes 330, and that leaves under
   * 300 for the chart AND the tape together — so landing at `peek` meant
   * arriving with the ledger entirely behind the panel and a chart too
   * short to read.
   *
   * Down, the same page has ~590 for the two of them. You land looking
   * at the coin, and the order is one pull away — which is the right way
   * round: you decide before you trade.
   *
   * On a wide window there is no sheet at all and this value is inert.
   */
  const [sheet, setSheet] = useState<Stop>('down');
  /* How far the thumb has moved this drag, in px, already clamped so the
     sheet cannot be pulled past either end. `null` when nobody is
     dragging — which is also what turns the transition back on. */
  const [drag, setDrag] = useState<number | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ id: number; y0: number; t0: number; shown0: number; h: number } | null>(null);

  /* How much of the sheet a stop leaves on screen. */
  const shownAt = useCallback((stop: Stop, h: number) => (
    stop === 'down' ? DOWN : stop === 'peek' ? Math.min(PEEK, h) : h
  ), []);

  const onGrabDown = useCallback((e: React.PointerEvent) => {
    const h = sheetRef.current?.getBoundingClientRect().height ?? 0;
    dragRef.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, shown0: shownAt(sheet, h), h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(0);
  }, [sheet, shownAt]);

  /* Dragging up shows more of the sheet, so a negative dy is a bigger
     `shown`. Clamping the SHOWN rather than the dy is what lets a drag
     cross a stop in one go — and what stops it stretching past the ends
     in either direction, whichever stop it started from. */
  const clampDy = (dy: number, d: { shown0: number; h: number }) => {
    const shown = Math.min(d.h, Math.max(DOWN, d.shown0 - dy));
    return d.shown0 - shown;
  };

  const onGrabMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setDrag(clampDy(e.clientY - d.y0, d));
  }, []);

  const onGrabUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    setDrag(null);

    const dy = clampDy(e.clientY - d.y0, d);
    const ms = Math.max(1, e.timeStamp - d.t0);
    const v = dy / ms;

    /* A drag that went nowhere is a tap, and a tap steps the sheet up —
       or back to the peek from the top. */
    if (Math.abs(dy) < 4 && ms < 400) {
      setSheet((cur) => (cur === 'up' ? 'peek' : cur === 'peek' ? 'up' : 'peek'));
      return;
    }

    const shown = d.shown0 - dy;
    const stops: Stop[] = ['down', 'peek', 'up'];
    /* A flick goes to the next stop in the direction it was thrown,
       however short it was. Without this a fast, small swipe snaps back,
       which reads as the sheet refusing you. */
    if (Math.abs(v) > 0.5) {
      const here = stops.indexOf(sheet);
      setSheet(stops[Math.min(stops.length - 1, Math.max(0, here + (v < 0 ? 1 : -1)))]);
      return;
    }
    /* A slow drag lands on whichever stop it is closest to. */
    setSheet(stops.reduce((best, st) => (
      Math.abs(shownAt(st, d.h) - shown) < Math.abs(shownAt(best, d.h) - shown) ? st : best
    ), stops[0]));
  }, [sheet, shownAt]);

  /* Escape shuts it, the way it shuts anything else laid over a page. */
  useEffect(() => {
    if (sheet !== 'up') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet('peek'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);

  return (
    <div
      className="tp-wrap"
      data-sheet={sheet}
      data-dragging={drag === null ? undefined : ''}
      style={drag === null ? undefined : ({ ['--tp-drag' as string]: `${drag}px` })}
    >
      <SolDefs />

      {/* Only drawn on the sheet. It dims the page behind and shuts on a
          press, which is the other half of what makes a sheet a sheet. */}
      <button
        type="button"
        className="tp-scrim"
        aria-label="Close the trade panel"
        tabIndex={sheet === 'up' ? 0 : -1}
        onClick={() => setSheet('peek')}
      />

      <aside className="tp" ref={sheetRef}>
        {/* ── THE HANDLE ────────────────────────────────────────────
            OUTSIDE the scrolling part of the sheet, not stuck to the top
            of it. Sticky inside a scroller meant the same gesture was
            both "drag the sheet" and "scroll its contents", and once the
            sheet was open the scroller won — which is why it could be
            pulled up and then not back down.

            Drag it, or press it. */}
        <button
          type="button"
          className="tp-grab"
          aria-label={sheet === 'up' ? 'Lower the trade panel' : 'Raise the trade panel'}
          aria-expanded={sheet === 'up'}
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
        >
          <span aria-hidden />
        </button>

        {/* Everything the panel actually shows. It is the part that
            scrolls; the handle above it never moves. */}
        <div className="tp-body">

        {/* ── THE TRADE ─────────────────────────────────────────────
            Side, mode, amount, chips, settings and the button are ONE
            act, so they share one plate. Everything below this block is
            a different act and is parted from it. */}
        <div className="tp-card">
          <div className="tp-side">
            <button type="button" className="tp-side-b" data-on={side === 'buy' ? '' : undefined} onClick={() => setSide('buy')}>Buy</button>
            <button type="button" className="tp-side-b" data-on={side === 'sell' ? '' : undefined} onClick={() => setSide('sell')}>Sell</button>
          </div>

          <div className="tp-modes">
            <div className="tp-tabs">
              {(['market', 'limit', 'adv'] as const).map((m) => (
                <button type="button" className="tp-tab" key={m} data-on={mode === m ? '' : undefined} onClick={() => setMode(m)}>
                  {m === 'adv' ? 'Adv.' : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Which advanced order. A filled pair rather than the tabs
              above, because this is a CHOICE inside the mode rather
              than a change of mode — same reason Buy and Sell are
              filled and Market/Limit/Adv. are not. */}
          {mode === 'adv' ? (
            <div className="tp-strat">
              <button type="button" className="tp-strat-b" data-on={strategy === 'dev' ? '' : undefined} onClick={() => setStrat('dev')}>
                {DevSell}Dev Sell
              </button>
              {side === 'sell' ? (
                <button type="button" className="tp-strat-b" data-on={strategy === 'trail' ? '' : undefined} onClick={() => setStrat('trail')}>
                  {Down}Trail SL
                </button>
              ) : null}
              <button type="button" className="tp-strat-b" data-on={strategy === 'dca' ? '' : undefined} onClick={() => setStrat('dca')}>
                {Dca}DCA
              </button>
            </div>
          ) : null}

          {/* ── WHICH WALLETS ARE PAYING ──────────────────────────
              Directly above the amount, because those are the two halves
              of one sentence: how much, out of what. Asking for the
              figure first and leaving the account implicit is how an
              order goes out of the wrong wallet.

              It is a COUNT, not a name. The list underneath is a
              multi select — any wallet, as many as you want — so a name
              in the trigger would be a lie the moment a second one is
              ticked, and even with one ticked the name is the thing you
              open the list to check, not the thing you glance at while
              typing an amount.

              `WalletCountButton` is the control the header chip already
              uses, so this writes to the same selection the order reads
              rather than being a second picker that could disagree with
              it. `field` is its full width form. */}
          <div className="tp-wal">
            {/* The mint is what puts the TOKENS column in the list: each
                wallet's holding of THIS coin, beside its SOL, under a
                column head that names both. The trigger stays one
                reading — the wallets and how many — because the holding
                is per wallet and a single figure on the button cannot
                say which of them it belongs to. */}
            <WalletCountButton layout="field" mint={PANEL_MINT} />
          </div>

          {/* ── THE AMOUNT ────────────────────────────────────────
              The field and the four shortcuts are ONE object. Typing
              1.4 and pressing `1` set the same number, so drawing them
              as a field plus five loose buttons put six borders on the
              screen for a single value.

              A real input, not a span showing "0.0" — the one thing on
              this panel you actually type into had nothing to type
              into. */}
          <div className="tp-amt">
            <label className="tp-amount">
              {/* A DCA does not place ONE order, so the field is not
                  asking for one order's size — it is the pot the
                  slices come out of, and the name has to say so. */}
              <span className="tp-amount-k">{mode === 'adv' && strategy === 'dca' ? 'DCA total amount' : 'Amount'}</span>
              <input
                className="tp-amount-v"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <SolMark size={14} />
            </label>

            {/* ── EDITING HAPPENS IN PLACE ──────────────────────
                The pencil turns the four shortcuts into four fields
                where they already sit, rather than opening a panel to
                set them somewhere else. You are changing what these
                buttons say, so you should be looking at the buttons. */}
            <div className="tp-quick" data-editing={editQ ? '' : undefined}>
              {quick.map((v, i) => (editQ ? (
                <input
                  className="tp-q tp-q-in"
                  key={i}
                  inputMode="decimal"
                  aria-label={`Shortcut ${i + 1}`}
                  value={v}
                  onChange={(e) => setQuick((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ) : (
                <button
                  type="button"
                  className="tp-q"
                  key={i}
                  data-on={amount === v ? '' : undefined}
                  onClick={() => setAmount(v)}
                >
                  {v}
                </button>
              )))}
              <button
                type="button"
                className="tp-q tp-q-edit"
                data-on={editQ ? '' : undefined}
                aria-label={editQ ? 'Done editing amounts' : 'Edit amounts'}
                onClick={() => setEditQ((v) => !v)}
              >
                {editQ ? Check() : Pencil}
              </button>
            </div>
          </div>

          {/* Slippage, priority, bribe and MEV protection. Four settings
              that are never read, only checked — so they are one line of
              mark and value, at the smallest type on the panel.

              Under Adv. the bribe turns gold and gains a warning: an
              advanced order sits on the book, so the tip is what decides
              whether it ever lands. */}
          <div className="tp-set">
            <span className="tp-s" data-tip="Max slippage">{Slip}20%</span>
            <span className="tp-s" data-tip="Priority fee">{Gas}0.001</span>
            <span className="tp-s" data-tip="Bribe">{Tip}0.01</span>
            <span className="tp-s is-on" data-tip="MEV protection">{Shield}On</span>
            {/* Sells the initial stake and leaves the rest riding. It is
                the only thing on this line that DOES something rather
                than reporting a setting, so it sits apart at the end and
                takes the down colour of the side it belongs to. */}
            {side === 'sell' && mode === 'market' ? (
              <button type="button" className="tp-s tp-s-init">Sell Init.</button>
            ) : null}
          </div>

          {/* ── WHAT EACH MODE ADDS ────────────────────────────────
              Market needs nothing more — it fills now, at whatever the
              price is. The other two each need ONE more thing: a level
              to fire at, and a condition to fire on. */}
          {mode === 'limit' ? (
            <>
              <div className="tp-field">
                <span className="tp-field-k">MKT CAP</span>
                {/* Bound to the slider below: moving one moves this. */}
                <span className="tp-field-v">{Math.round(8851 * (1 + pct / 100)).toLocaleString()}</span>
                <span className="tp-field-u">$</span>
              </div>

              {/* The same level again, as a distance from where the coin
                  is now. A market cap is an absolute number nobody holds
                  in their head; "down 50%" is the way the decision is
                  actually made, so the two are bound together and either
                  can be set. */}
              {/*
                * ── A REAL RANGE, DRAGGED ────────────────────────────
                *
                * It was three spans that looked like a slider and did
                * nothing. This is an `<input type="range">` laid over the
                * drawn track, transparent, so the dragging, the keyboard
                * and the accessibility come from the browser and only the
                * appearance is ours.
                *
                * The FILL runs from the centre out to the thumb, because
                * zero is the middle of this scale — a bar growing from
                * the left would say -100% was the starting point.
                */}
              <div className="tp-slider">
                <div className="tp-track">
                  {[0, 25, 50, 75, 100].map((x) => (
                    <span className="tp-tick" key={x} style={{ left: `${x}%` }} />
                  ))}
                  <span
                    className="tp-fill"
                    style={pct >= 0
                      ? { left: '50%', width: `${pct / 2}%` }
                      : { left: `${50 + pct / 2}%`, width: `${-pct / 2}%` }}
                  />
                  <input
                    className="tp-range"
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={pct}
                    aria-label="Limit level, percent from market cap"
                    onChange={(e) => setPct(Number(e.target.value))}
                  />
                </div>
                <div className="tp-scale">
                  <span className="is-down">-100%</span>
                  <span className="is-down">-50%</span>
                  <span>0%</span>
                  <span className="is-up">+50%</span>
                  <span className="is-up">+100%</span>
                </div>
              </div>
            </>
          ) : null}

          {/* ── WHAT THE STRATEGY NEEDS TO KNOW ───────────────────
              A dev sell has one question: how big a sell counts. A DCA
              has four, and they pair off — how it is cut up, then the
              window it is allowed to run in — so they sit as two rows
              of two rather than a column of four. */}
          {mode === 'adv' && strategy === 'dev' ? (
            <div className="tp-field">
              <span className="tp-field-k">MIN DEV SELL %</span>
              <span className="tp-field-v is-dim">Any</span>
              <span className="tp-field-u">%</span>
            </div>
          ) : null}

          {/* A trailing stop asks one thing: how far off the high it
              lets the price fall before it gets out. */}
          {mode === 'adv' && strategy === 'trail' ? (
            <div className="tp-field">
              <span className="tp-field-k">SELL WHEN DROP</span>
              <input className="tp-field-i" inputMode="decimal" defaultValue="30" />
              <span className="tp-field-u">%</span>
            </div>
          ) : null}

          {mode === 'adv' && strategy === 'dca' ? (
            <div className="tp-dca">
              <label className="tp-field">
                <span className="tp-field-k">SLICES</span>
                <input className="tp-field-i" inputMode="numeric" defaultValue="5" />
              </label>
              <label className="tp-field">
                <span className="tp-field-k">INTERVAL</span>
                <input className="tp-field-i" inputMode="numeric" defaultValue="60" />
                <span className="tp-field-u">s</span>
              </label>
              <label className="tp-field">
                <span className="tp-field-k">MIN MC</span>
                <input className="tp-field-i" inputMode="decimal" placeholder="None" />
                <span className="tp-field-u">$</span>
              </label>
              <label className="tp-field">
                <span className="tp-field-k">MAX MC</span>
                <input className="tp-field-i" inputMode="decimal" placeholder="None" />
                <span className="tp-field-u">$</span>
              </label>
            </div>
          ) : null}

          {/* The box draws a TICK when it is on. It was a filled green
              square, which says "something is set here" without saying
              what — a checkbox that never shows a check. */}
          <label className="tp-adv">
            <input type="checkbox" checked={adv} onChange={(e) => setAdv(e.target.checked)} />
            <span className="tp-box" aria-hidden><Check /></span>
            Advanced Trading Strategy
          </label>

          {/* ── THE EXIT LEGS ─────────────────────────────────────
              A strategy is a LIST — take profit here, cut there, and
              get out if the dev does. So the switch opens a list you
              add to, not a form with every field on screen at once:
              most orders have one leg, and a fixed form would show
              three sets of empty inputs to say so.

              Each leg is its own row and its own delete, because each
              one fires independently of the others. */}
          {adv ? (
            <div className="tp-exits">
              {exits.map((e) => (
                <div className="tp-exit" key={e.id}>
                  {e.kind === 'dev' ? (
                    /* One field, not two. A dev sell has no level to
                       set — the dev selling IS the trigger — so the
                       row states the condition and asks the one
                       question left: how much of it goes. */
                    <label className="tp-xf is-wide">
                      <span className="tp-xf-k">{DevSell}Sell Amount on Dev Sell</span>
                      <input
                        className="tp-xf-v"
                        inputMode="decimal"
                        value={e.amt}
                        onChange={(ev) => setExits((all) => all.map((x) => (x.id === e.id ? { ...x, amt: ev.target.value } : x)))}
                      />
                      <span className="tp-xf-u">%</span>
                    </label>
                  ) : (
                    <>
                      <label className="tp-xf" data-kind={e.kind}>
                        <span className="tp-xf-k">
                          {e.kind === 'tp' ? Up : Down}
                          {e.kind === 'tp' ? 'TP' : 'SL'}
                        </span>
                        <input
                          className="tp-xf-v"
                          inputMode="decimal"
                          value={e.at}
                          onChange={(ev) => setExits((all) => all.map((x) => (x.id === e.id ? { ...x, at: ev.target.value } : x)))}
                        />
                        <span className="tp-xf-u">%</span>
                      </label>
                      <label className="tp-xf">
                        <span className="tp-xf-k">Amount</span>
                        <input
                          className="tp-xf-v"
                          inputMode="decimal"
                          value={e.amt}
                          onChange={(ev) => setExits((all) => all.map((x) => (x.id === e.id ? { ...x, amt: ev.target.value } : x)))}
                        />
                        <span className="tp-xf-u">%</span>
                      </label>
                    </>
                  )}
                  <button
                    type="button"
                    className="tp-xdel"
                    aria-label="Remove this leg"
                    onClick={() => setExits((all) => all.filter((x) => x.id !== e.id))}
                  >
                    {Trash}
                  </button>
                </div>
              ))}

              <div className="tp-add-wrap">
                <button type="button" className="tp-add" data-on={addOpen ? '' : undefined} onClick={() => setAddOpen((v) => !v)}>
                  Add
                  <span className="tp-add-p" aria-hidden>{Plus}</span>
                </button>

                {/* Opens UPWARD. The button sits directly above the buy
                    button, and a menu falling downward would cover the
                    one control you must not press by accident. */}
                {addOpen ? (
                  <div className="tp-add-menu">
                    {([
                      ['tp', Up, 'Take Profit'],
                      ['sl', Down, 'Stop Loss'],
                      ['dev', DevSell, 'Dev Sold'],
                    ] as const).map(([kind, mark, label]) => (
                      <button
                        type="button"
                        className="tp-add-i"
                        key={kind}
                        onClick={() => {
                          setExits((all) => [...all, {
                            id: all.reduce((m, x) => Math.max(m, x.id), 0) + 1,
                            kind,
                            at: kind === 'sl' ? '-0' : '+0',
                            amt: '0',
                          }]);
                          setAddOpen(false);
                        }}
                      >
                        {mark}{label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/*
            * The button says what pressing it DOES, and the three modes
            * do different things. Market fills now — "Buy One". Limit
            * and Adv. put something on the book that fires later, which
            * is placing an order, not buying.
            */}
          <button type="button" className="tp-go" data-side={side}>
            {mode === 'market' ? `${side === 'buy' ? 'Buy' : 'Sell'} One` : 'Place Order'}
          </button>
        </div>

        {/* ── WHAT YOU HOLD ─────────────────────────────────────────
            Four readings about YOUR position, not the coin's. They sit
            outside the trade plate because they are its result. */}
        <div className="tp-pos">
          <div className="tp-pos-c">
            <span className="tp-pos-k">Bought</span>
            <span className="tp-pos-v">{denom === 'sol' ? <SolMark size={11} /> : <span className="tp-usd">$</span>}0</span>
          </div>
          <div className="tp-pos-c">
            <span className="tp-pos-k">Sold</span>
            <span className="tp-pos-v is-down">{denom === 'sol' ? <SolMark size={11} /> : <span className="tp-usd">$</span>}0</span>
          </div>
          <div className="tp-pos-c">
            <span className="tp-pos-k">Holding</span>
            <span className="tp-pos-v">{denom === 'sol' ? <SolMark size={11} /> : <span className="tp-usd">$</span>}0</span>
          </div>
          <div className="tp-pos-c">
            {/*
              * The toggle flips ALL FOUR, which is why it sits on PnL
              * rather than on each figure: four independently switchable
              * denominations is four ways to compare a number in SOL
              * against one in dollars.
              */}
            <span className="tp-pos-k">
              PnL
              <button
                type="button"
                className="tp-denom"
                data-spin={spin ? '' : undefined}
                aria-label={`Show in ${denom === 'sol' ? 'dollars' : 'SOL'}`}
                onClick={() => {
                  setDenom((d) => (d === 'sol' ? 'usd' : 'sol'));
                  setSpin(true);
                  window.setTimeout(() => setSpin(false), 420);
                }}
              >
                {Refresh}
              </button>
            </span>
            <span className="tp-pos-v is-up">{denom === 'sol' ? <SolMark size={11} /> : <span className="tp-usd">$</span>}+0 (+0%)</span>
          </div>
        </div>

        {/* Three named segments in one track, and nothing else on the
            row — the same object the mode selector uses, because it is
            the same kind of question. */}
        {/* Pressing the preset you are ALREADY on opens its settings;
            pressing another switches to it. One button, because "which
            preset" and "what is in it" are the same object — a separate
            gear beside them made the row read as four controls where
            three are a choice. */}
        <div className="tp-presets">
          {[1, 2, 3].map((n, i) => (
            <button
              type="button"
              className="tp-preset"
              key={n}
              data-on={preset === i ? '' : undefined}
              aria-expanded={preset === i ? pOpen : undefined}
              onClick={() => {
                if (preset === i) setPOpen((v) => !v);
                else setPreset(i);
              }}
            >
              Preset {n}
            </button>
          ))}
        </div>

        {/* Always mounted, collapsed to nothing when shut. It has to be
            in the tree for the open and the close to animate — a panel
            that only exists while it is open can only ever appear. */}
        <div className="tp-pp-wrap" data-open={pOpen ? '' : undefined} aria-hidden={pOpen ? undefined : true}>
          <div className="tp-pp-clip">
          <div className="tp-pp">
            {/* Which side these settings belong to. Filled rather than
                ruled, because everything below it changes when this
                changes — it is not a tab through a document, it is a
                switch between two sets of numbers. */}
            <div className="tp-pp-side">
              {(['buy', 'sell'] as const).map((k) => (
                <button
                  type="button"
                  className="tp-pp-sb"
                  key={k}
                  data-side={k}
                  data-on={pSide === k ? '' : undefined}
                  onClick={() => setPSide(k)}
                >
                  {k === 'buy' ? 'Buy settings' : 'Sell settings'}
                </button>
              ))}
            </div>

            {/* The three fees, as three cells. The figure leads and the
                marked name sits under it, because these are compared
                against each other far more often than they are read. */}
            <div className="tp-pp-fees">
              <label className="tp-pp-fee">
                <span className="tp-pp-fee-v">
                  <input defaultValue="20" inputMode="decimal" aria-label="Slippage" />
                  <i>%</i>
                </span>
                <span className="tp-pp-fee-k">{Slip}Slippage</span>
              </label>
              <label className="tp-pp-fee">
                <span className="tp-pp-fee-v">
                  <input defaultValue="0.001" inputMode="decimal" aria-label="Priority fee" />
                </span>
                <span className="tp-pp-fee-k">{Gas}Priority</span>
              </label>
              <label className="tp-pp-fee">
                <span className="tp-pp-fee-v">
                  <input defaultValue="0.01" inputMode="decimal" aria-label="Bribe" />
                </span>
                <span className="tp-pp-fee-k">{Tip}Bribe</span>
              </label>
            </div>

            {/* Auto Fee and the ceiling it needs are one decision, so
                they share a row: the field is dead until the switch is
                on, and a live input for a setting that is off is a
                question with no answer. */}
            <div className="tp-pp-row">
              <label className="tp-pp-check">
                <input type="checkbox" checked={autoFee} onChange={(e) => setAutoFee(e.target.checked)} />
                <span className="tp-box" aria-hidden><Check /></span>
                Auto Fee
              </label>
              <label className="tp-pp-f" data-off={autoFee ? undefined : ''}>
                <span className="tp-pp-f-k">Max fee</span>
                <input defaultValue="0.1" inputMode="decimal" disabled={!autoFee} aria-label="Max fee" />
              </label>
            </div>

            <div className="tp-pp-row">
              <span className="tp-pp-k">MEV Mode {Info}</span>
              <div className="tp-pp-seg">
                {([
                  ['off', ShieldOff, 'Off'],
                  ['red', ShieldHalf, 'Red.'],
                  ['sec', ShieldOn, 'Sec.'],
                ] as const).map(([k, mark, label]) => (
                  <button
                    type="button"
                    className="tp-pp-sg"
                    key={k}
                    data-on={mev === k ? '' : undefined}
                    onClick={() => setMev(k)}
                  >
                    {mark}{label}
                  </button>
                ))}
              </div>
            </div>

            <div className="tp-pp-row">
              <span className="tp-pp-k">Max Tax {Info}</span>
              <label className="tp-pp-f">
                <input defaultValue="0.0" inputMode="decimal" aria-label="Max tax" />
                <span className="tp-pp-f-u">%</span>
              </label>
            </div>

            <label className="tp-pp-f is-full">
              <span className="tp-pp-f-k">RPC</span>
              <input placeholder="https://…" aria-label="RPC endpoint" />
            </label>
          </div>
          </div>
        </div>

        {/* ── WHAT THE COIN IS ──────────────────────────────────────
            Nine risk readings in a grid. A grid rather than a list
            because they are read by SCANNING for the bad one — the eye
            wants three across, not nine down. */}
        <section className="tp-sec" data-open={infoOpen ? '' : undefined}>
          <header className="tp-sec-h">
            {/* The whole title is the handle, not just the chevron —
                a 13px arrow is not something a pointer aims at. */}
            <button
              type="button"
              className="tp-sec-t"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
            >
              Token Info {Chevron}
            </button>
            <button
              type="button"
              className="tp-sec-a"
              aria-label="Refresh token info"
              data-spin={infoSpin ? '' : undefined}
              onClick={() => {
                setInfoSpin(true);
                window.setTimeout(() => setInfoSpin(false), 620);
              }}
            >
              {Refresh}
            </button>
          </header>
          {/* Clipped rather than unmounted, so shutting it is an
              animation and not a disappearance. */}
          <div className="tp-fold">
          <div className="tp-grid">
            <Cell mark={People} value="5%" label="Top 10 H." tone="ok" />
            <Cell mark={PILL_MARKS.dev} value="0%" label="Dev holding" tone="ok" />
            {/* Two figures: supply held, and how many wallets hold it. */}
            <Cell mark={Target} value="0%" extra="13" label="Snipers" tone="ok" />
            <Cell mark={PILL_MARKS.insiders} value="0%" label="Insiders H." tone="ok" />
            <Cell mark={PILL_MARKS.bundles} value="0%" label="Bundles H." tone="ok" />
            <Cell mark={Leaf} value="21" label="Fresh buys" tone="ok" />
            <Cell mark={Leaf} value="&gt;0%" label="Fresh holding" tone="ok" />
            {/* No mark. These two are a permission being on or off, not a
                quantity — there is nothing for a glyph to stand for. */}
            <Cell value="No" label="Mint Auth." tone="ok" />
            <Cell value="No" label="Freeze Auth." tone="ok" />
          </div>
          </div>
        </section>

        {/* The two addresses. Both truncate in the middle, which is the
            one place an address can lose characters and stay
            recognisable — the head and the tail are what people match. */}
        <div className="tp-addr">
          <span className="tp-addr-k">{Doc}CA:</span>
          <span className="tp-addr-v">6mYcNBqiior9gYj…phga</span>
          {/* The actions are a CLUSTER, not three items on the row's
              rhythm. They belong to each other, so they touch. */}
          <span className="tp-addr-acts">
            <span className="tp-addr-a" data-tip="Search the contract">{Search}</span>
            <span className="tp-addr-a" data-tip="Open in explorer" data-tip-end>{External}</span>
          </span>
        </div>

        {/*
          * ── THE DEPLOYER IS ONE BLOCK, NOT TWO ROWS ───────────────
          *
          * The address and what is known about the wallet behind it were
          * two separate bordered rows sitting under each other. They are
          * one subject: this is the deployer, this is its funding wallet,
          * this is its balance, this is how old it is.
          *
          * Split, the second row read as a loose set of chips belonging
          * to nothing — a violet pill, a figure and a duration floating
          * under an address. In one box the address heads it and the
          * three facts below are plainly about that address.
          */}
        <div className="tp-dev-block">
          {/* The DEV address, so it takes the dev's own mark rather than
              the contract's document — the two rows are different kinds
              of address and the leading glyph is what says which. */}
          <div className="tp-addr is-bare">
            <span className="tp-addr-k">{PILL_MARKS.dev}DA:</span>
            <span className="tp-addr-v">bwamJzztZsep…fSXa</span>
            <span className="tp-addr-acts">
              <span className="tp-addr-a" data-tip="Blacklist this dev">{PILL_MARKS.dev}</span>
              <span className="tp-addr-a" data-tip="Search the wallet">{Search}</span>
              <span className="tp-addr-a" data-tip="Open in explorer" data-tip-end>{External}</span>
            </span>
          </div>

          <div className="tp-dev">
            <span className="tp-dev-w">{Up}Bigr…nvTu</span>
            <span className="tp-dev-b"><SolMark size={11} />15</span>
            <span className="tp-dev-t">{Clock}1y</span>
          </div>
        </div>

        <section className="tp-sec" data-open={bannerOpen ? '' : undefined}>
          <header className="tp-sec-h">
            <button
              type="button"
              className="tp-sec-t"
              aria-expanded={bannerOpen}
              onClick={() => setBannerOpen((v) => !v)}
            >
              Token Banner {Chevron}
            </button>
          </header>
          {/* The banner sits inside a plain wrapper. A `0fr` track is
              sized by its item's base size, and the banner has a fixed
              height — so it needs something auto-height between it and
              the track for the fold to close on. */}
          <div className="tp-fold">
            <div>
              <div className="tp-banner" aria-hidden />
            </div>
          </div>
        </section>

        {/* ── SIMILAR TOKENS ────────────────────────────────────────
            Its own section, so it gets the rule that closes the banner
            above it — full width, the same divider every other block on
            the rail is parted by.

            It starts shut. The blocks above answer "what is this coin";
            this one answers "what else is out there", which is a
            question you ask after, not while. */}
        <section className="tp-sec" data-open={similarOpen ? '' : undefined}>
          <header className="tp-sec-h">
            <button
              type="button"
              className="tp-sec-t"
              aria-expanded={similarOpen}
              onClick={() => setSimilarOpen((v) => !v)}
            >
              Similar Tokens {Chevron}
            </button>
          </header>
          <div className="tp-fold">
            <div>
              <div className="tp-similar">
                {SIMILAR.map((t, i) => {
                  const pad = PADS.find((x) => x.key === t.pad)!;
                  return (
                    <button type="button" className="tp-sim" key={i}>
                      {/* The board's own ring: a painted BAND, not an
                          outline. The box carries the pad colour as its
                          background, its padding makes the band, and the
                          picture punches the ground coloured gap back
                          out of the inside of it — which is what lets a
                          graduated token paint the ring with a gradient
                          rather than a flat colour. */}
                      <span className="tp-sim-box" style={{ ['--ring' as string]: pad.colour }}>
                        <span className="tp-sim-img" />
                        <span className="tp-sim-pad">
                          <span className="tp-sim-pad-face">
                            <img src={pad.logo} alt="" data-solid={pad.solid ? '' : undefined} />
                          </span>
                        </span>
                      </span>

                      <span className="tp-sim-mid">
                        <span className="tp-sim-l1">
                          <b>{t.tick}</b>
                          <i>{t.name}</i>
                        </span>
                        {/* No clock. The row has one duration on it and
                            nothing else it could be mistaken for. */}
                        <span className="tp-sim-age">{t.age}</span>
                      </span>

                      {/* Right aligned and stacked, so the three
                          numbers line up down every row — which is the
                          only way a column of them is readable. */}
                      <span className="tp-sim-figs">
                        <span><b>{t.liq}</b><i>Liq</i></span>
                        <span><b>{t.vol}</b><i>Vol</i></span>
                        <span className="is-mc"><b>{t.mc}</b><i>MC</i></span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        </div>
      </aside>
    </div>
  );
}
