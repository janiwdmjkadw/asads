'use client';

import { useRef, useState } from 'react';
import './trade-chart.css';
import { ChartToolbar } from './ChartToolbar';
import { PriceChart } from './PriceChart';
import { InstantTradeBox } from './InstantTradeBox';
import { mockCandles, mockGraduatedAtMs, mockOHLC, mockToken } from './mockTrade';
import type { WalletActivityEvent } from '@/components/discover/useWalletActivity';
import { type ChartTimeframe } from './timeframes';
import type { UseTradeStream } from './useTradeStream';
import type { MultiWalletTokenBalance } from './useMultiWalletTokenBalance';

/*
 * ── THE BOX'S FEEDS, STOOD DOWN ──────────────────────────────────────
 *
 * `InstantTradeBox` wants a live order stream and a multi-wallet balance
 * snapshot, both of which are owned by the old `TradePage`. Neither
 * exists here, so it gets a quiet one: connected, holding nothing, and a
 * submit that resolves without going anywhere.
 *
 * This is the same bargain the chart takes with its mock candles — the
 * SHAPE is real so the component behaves the way it will when the feed
 * is behind it, and nothing pretends to have data it does not have.
 */
const IDLE_STREAM: UseTradeStream = {
  position: null,
  tokenBalance: null,
  tokenBalanceInfo: null,
  allPositions: [],
  lastEvent: null,
  orderEvents: [],
  connected: true,
  inFlight: 0,
  refreshPositions: async () => [],
  submit: async () => ({ ok: false, errorKind: 'not_wired' }) as never,
};

const IDLE_BALANCE: MultiWalletTokenBalance = {
  totalBaseUnits: 0n,
  perWallet: new Map(),
  status: 'idle',
};

/*
 * ── A FEW BUBBLES, SO THE PANE IS NOT EMPTY ──────────────────────────
 *
 * Every marker class the chart can draw needs an event stream behind it,
 * and none of those streams are wired on this page. These stand in: one
 * of each kind, anchored to candles a little way back from the right
 * edge so the stack is on screen without sitting under the price line.
 *
 * Sandbox only. The prop names are the real ones, so replacing this with
 * the live feeds is a deletion, not a rewrite.
 */
const CANDLE_MS = 60_000;
const NOW = mockCandles.length > 0 ? Number(mockCandles[mockCandles.length - 1]!.time) * 1000 : Date.now();

const at = (candlesBack: number): number => NOW - candlesBack * CANDLE_MS;

const event = (
  signature: string,
  wallet: string,
  candlesBack: number,
  isBuy: boolean,
  sol: number,
): WalletActivityEvent => ({
  signature,
  slot: 0,
  blockTimeMs: at(candlesBack),
  wallet,
  mint: mockToken.mintAddress,
  isBuy,
  solLamports: String(Math.round(sol * 1e9)),
  tokens: '1000000000',
  venue: 'bonding_curve',
  receivedAtMs: at(candlesBack),
});

/*
 * Placed the way they land on a real coin, not scattered: the dev and
 * the snipers are on the FIRST candles, everything else happens through
 * the run and the chop, and the claim comes late — a creator takes fees
 * out after there are fees to take.
 */
/* The series is 52 bars against a ~56 bar window, so EVERY bar is on
   screen and bar 0 really is the start of the chart. That is where the
   dev's buy goes. */
const FIRST_VISIBLE = mockCandles.length - 1;
/* The dev buys FIRST, alone on its candle, so the mark is the dev's and
   nothing shares the bar with it. The snipers and the bundler come in on
   the next two. */
const DEV: WalletActivityEvent[] = [
  event('mk-dev-1', 'DevWa11et11111111111111111111111111111111111', FIRST_VISIBLE, true, 3.5),
  event('mk-dev-2', 'DevWa11et11111111111111111111111111111111111', 30, false, 12.5),
];
const SNIPER: WalletActivityEvent[] = [
  event('mk-snipe-1', 'Sn1perWa11et1111111111111111111111111111111', FIRST_VISIBLE - 1, true, 0.9),
  event('mk-snipe-2', 'Sn1perWa11et2222222222222222222222222222222', FIRST_VISIBLE - 2, true, 1.4),
];
const BUNDLER: WalletActivityEvent[] = [
  event('mk-bundle-1', 'Bund1erWa11et111111111111111111111111111111', FIRST_VISIBLE - 2, true, 0.6),
];
const TRACKED: WalletActivityEvent[] = [
  event('mk-tracked-1', 'Trak1ngWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 40, true, 3.2),
  event('mk-tracked-2', 'Trak1ngWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 36, false, 1.4),
  event('mk-tracked-3', 'Trak1ngWa11etCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 20, true, 8.1),
  event('mk-tracked-4', 'Trak1ngWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 8, false, 5.6),
];
const SELF: WalletActivityEvent[] = [
  event('mk-self-1', 'SandboxWa11etPubkey11111111111111111111111111', 26, true, 2.0),
];
const CLAIM: WalletActivityEvent[] = [
  event('mk-claim-1', 'DevWa11et11111111111111111111111111111111111', 11, true, 4.7),
];

/** Names and marks for the tracked three, so their discs are not all B. */
/* No wallet in here is called "dev wallet" — a tracked wallet with that
   name made its `W`/`K` disc read as a mislabelled dev. */
const MARKER_LABELS: Record<string, string> = {
  Trak1ngWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: 'whale one',
  Trak1ngWa11etBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB: 'kessel',
  Trak1ngWa11etCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC: 'nomad',
};
const MARKER_EMOJI: Record<string, string> = {
  Trak1ngWa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA: '🐷',
};

/**
 * The chart, on the rebuilt trade page.
 *
 * ── IT IS THE EXISTING RENDERER, NOT A NEW ONE ───────────────────────
 *
 * `PriceChart` is a working lightweight-charts surface — candles, the
 * wallet and dev bubbles, the top-holder price lines, the graduation
 * marker, the coin-call thesis popovers. None of that is design work
 * worth redoing: it is a charting library doing what a charting library
 * does, plus a lot of anchoring logic that was got right once.
 *
 * So this brings it in as it stands and gives it the two things it needs
 * to run on a page that no longer has the old TradePage around it: a
 * timeframe to sit at, and a token to draw.
 *
 * ── WHY THE MOCK ─────────────────────────────────────────────────────
 *
 * The live wiring — the snapshot fetch, the candle stream, the tape, the
 * tracked-wallet subscriptions — all lives in `TradePage`, which is not
 * mounted. Rather than half-connect it, the chart runs on the repo's own
 * mock series, which is what it was built against. Swapping in the real
 * feed is one prop: `candles`.
 */
export function TokenChart() {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  /* The box opens ANCHORED to whatever was pressed, so it arrives where
     the eye already is rather than in the middle of the window. */
  const [instantOpen, setInstantOpen] = useState(false);
  const anchorRef = useRef<DOMRectReadOnly | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="tc" ref={rootRef}>
      <ChartToolbar timeframe={timeframe} onTimeframeChange={setTimeframe} />
      <div className="tc-canvas">
        <PriceChart
          token={mockToken}
          ohlc={mockOHLC}
          candles={mockCandles}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
          walletActivityEvents={TRACKED}
          devActivityEvents={DEV}
          selfActivityEvents={SELF}
          sniperActivityEvents={SNIPER}
          bundlerActivityEvents={BUNDLER}
          claimActivityEvents={CLAIM}
          walletLabelByAddress={MARKER_LABELS}
          walletEmojiByAddress={MARKER_EMOJI}
          graduatedAtMs={mockGraduatedAtMs}
          instantTradeOpen={instantOpen}
          onInstantTradeClick={() => {
            const r = rootRef.current?.getBoundingClientRect();
            anchorRef.current = r ? (r as DOMRectReadOnly) : null;
            setInstantOpen((v) => !v);
          }}
        />
      </div>

      {instantOpen ? (
        <InstantTradeBox
          token={mockToken}
          priceLamportsPerBaseUnit={1}
          initialAnchor={anchorRef.current}
          stream={IDLE_STREAM}
          walletBalance="0"
          multiTokenBalance={IDLE_BALANCE}
          onClose={() => setInstantOpen(false)}
        />
      ) : null}
    </div>
  );
}
