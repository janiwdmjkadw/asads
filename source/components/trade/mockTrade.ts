import type {
  CandlestickData,
  SeriesMarker,
  SeriesMarkerBarPosition,
  SeriesMarkerShape,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import type { TokenHolder } from './types';

/**
 * Shape is compatible with `MetaRowCoin` from the Discover page's
 * CardMetaRows so we can pass `mockToken` straight to Discover's MetaRow
 * component. Fields like `ticker` / `ageLabel` / `txns` / `score` /
 * `hasWebsite` / `hasLink` / `hasAgent` are required by that contract —
 * the trade page additionally consumes `symbol`, `name`, `imageUrl`, etc.
 */
export interface MockToken {
  mintAddress: string;
  symbol: string;
  ticker: string;
  name: string;
  imageUrl: string;
  imageFallbackUrl?: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
  ageLabel: string;
  price: string;
  liquidity: string;
  marketCap: string;
  /** Numeric USD market cap from the snapshot — the "since call" baseline a
   *  coin call captures. Absent/null on hint/loading/mock tokens. */
  marketCapUsd?: number | null;
  ath: string;
  platform: string;
  source: string;
  mintShort: string;
  txns: number;
  score: number;
  graduated?: boolean;
  graduatedAtMs?: number | null;
  /** Pair quote mint (base58); absent/null = SOL pair. */
  quoteMint?: string | null;
  /** Live SOL/USD from the snapshot, for $-denominated est-receive on
   *  USDC pairs. Absent on hint/loading tokens. */
  solUsd?: number | null;
  hasWebsite: boolean;
  hasLink: boolean;
  hasAgent: boolean;
  isMayhem: boolean;
  isCashback: boolean;
}

export const mockToken: MockToken = {
  mintAddress: 'Ecco111111111111111111111111111111111pump',
  symbol: 'Ecco',
  ticker: 'Ecco',
  name: 'Ecco the Dolphin',
  imageUrl: 'https://picsum.photos/seed/ecco-dolphin/96/96',
  twitterUrl: 'https://x.com/eccothedolphin',
  telegramUrl: null,
  websiteUrl: 'https://en.wikipedia.org/wiki/Ecco_the_Dolphin',
  ageLabel: '40m',
  price: '$0.0₅2',
  liquidity: '$5.13K',
  marketCap: '$2.39K',
  ath: '$4.82K',
  platform: 'Pump V1',
  source: 'axiom.trade',
  mintShort: 'Ec...oPN',
  txns: 142,
  score: 7.3,
  hasWebsite: true,
  hasLink: true,
  hasAgent: true,
  isMayhem: false,
  isCashback: false,
};

export interface VolSnapshot {
  window: string;
  vol: string;
  buys: { count: number; amount: string };
  sells: { count: number; amount: string };
  netVol: string;
}

export const mockVol: VolSnapshot = {
  window: '5m',
  vol: '$0',
  buys: { count: 0, amount: '$0' },
  sells: { count: 0, amount: '$0' },
  netVol: '-$0',
};

export interface OHLCSnapshot {
  o: number;
  h: number;
  l: number;
  c: number;
  change: number;
  changePct: number;
}

export const mockOHLC: OHLCSnapshot = {
  o: 2430,
  h: 2400,
  l: 2400,
  c: 2400,
  change: -28.2761,
  changePct: -1.17,
};

/**
 * Synthetic candles drifting from ~4.8K down to ~2.4K with intermittent
 * volatility.
 *
 * ── TWO THINGS THAT MADE IT NOT LOOK LIKE A CHART ────────────────────
 *
 * The series was stamped at a FIXED epoch — 1_700_000_000, November
 * 2023 — so the time axis read two years into the past no matter when
 * you opened it, and the "1m" pill sat over candles dated to a different
 * year.
 *
 * And the candles were one SECOND apart (`start + i`) while every
 * timeframe control on the page said minutes. 220 one-second bars under
 * a 1m label is not a minute chart; it is three and a half minutes of
 * tape stretched across the pane, which is why it read as starting at
 * the beginning of time and going nowhere.
 *
 * Now: one bar per minute, ending at the current minute, so the axis
 * says what the pill says and the right edge is now.
 */
const CANDLE_SEC = 60;
const MOCK_NOW_SEC = Math.floor(Date.now() / 1000 / CANDLE_SEC) * CANDLE_SEC;

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return x - Math.floor(x);
}

/*
 * ── A COIN'S LIFE, NOT A SLIDE ───────────────────────────────────────
 *
 * The old series opened at its high — 4,800 on the first bar — and drifted
 * down for 220 minutes. Nothing launches at its top: the first candle of
 * a pump.fun chart is the smallest market cap the coin will ever have,
 * and everything after it is the argument about where that goes.
 *
 * So the shape is the one every one of these actually has:
 *
 *   · a low, quiet open — the first few minutes at launch size
 *   · the run — a fast leg up on rising range
 *   · the top — a blow off wick and a sharp rejection
 *   · the chop — a wide, mean range that goes nowhere
 *   · the bleed — a slow give back into the right edge
 *
 * Deterministic: one seeded generator, no `Math.random`, so the chart is
 * the same chart on every reload and a screenshot means something.
 */
function phaseTarget(progress: number): number {
  const LAUNCH = 9_000;
  const PEAK = 46_000;
  /*
   * The run takes a THIRD of the pane, not a tenth. A 15x in twenty bars
   * is a vertical line with a chart drawn around it: every candle before
   * it flattens into the axis and every candle after it is a footnote.
   * Five times over seventy bars is a chart you can read a decision off.
   */
  if (progress < 0.1) return LAUNCH * (1 + progress * 1.4);
  if (progress < 0.42) {
    const p = (progress - 0.1) / 0.32;
    return LAUNCH * 1.14 + (PEAK - LAUNCH * 1.14) * p ** 1.25;
  }
  if (progress < 0.52) {
    /* The rejection off the top. */
    const p = (progress - 0.42) / 0.1;
    return PEAK - (PEAK - 31_000) * p ** 0.7;
  }
  if (progress < 0.84) {
    /* The chop: a mean with a slow downward tilt under it. */
    const p = (progress - 0.52) / 0.32;
    return 31_000 - 5_000 * p + Math.sin(p * 9) * 2_400;
  }
  /* The bleed. */
  const p = (progress - 0.84) / 0.16;
  return 26_000 - 6_500 * p;
}

function buildCandles(count: number): CandlestickData<Time>[] {
  const now = MOCK_NOW_SEC;
  const start = now - count * CANDLE_SEC;

  const out: CandlestickData<Time>[] = [];
  let price = 9_000;

  for (let i = 0; i < count; i++) {
    const t = start + i * CANDLE_SEC;
    const progress = i / count;
    const target = phaseTarget(progress);

    /* Range scales with price — a 2% candle on a 60K cap is a bigger
       number than a 2% candle on a 4K one, and a chart drawn with a flat
       noise term flattens into a line as soon as the price runs. */
    const vol = target * (progress > 0.42 && progress < 0.84 ? 0.03 : 0.018);
    const open = price;
    const close = target + (seededUnit(i) - 0.5) * vol * 2;

    /*
     * ── THE WICK IS A FRACTION OF THE BODY ───────────────────────────
     *
     * It used to be a flat `random * 80` on each side, while the body was
     * usually ten to forty. So nearly every candle was a small block with
     * a spike twice its length above and below it, and the chart read as
     * a field of needles.
     *
     * Real tape does not look like that. A wick is normally a fraction of
     * the move it belongs to: mostly a third or less, occasionally longer
     * when something got rejected. Tying it to the body's own size gives
     * that shape, and the floor keeps a doji from having no wick at all.
     */
    const body = Math.abs(close - open);
    const reach = Math.max(target * 0.004, body * 0.45);
    /* One blow off wick at the top, because every one of these has one. */
    const topping = progress > 0.405 && progress < 0.425;
    const high = Math.max(open, close) + seededUnit(i + 10_000) * reach * (topping ? 6 : 1);
    const low = Math.min(open, close) - seededUnit(i + 20_000) * reach;

    out.push({
      time: t as UTCTimestamp,
      open: Math.max(1, open),
      high: Math.max(1, high),
      low: Math.max(1, low),
      close: Math.max(1, close),
    });
    price = close;
  }

  return out;
}

/*
 * 60 bars, not 220.
 *
 * The chart opens on a ~56 bar window (see `visibleLogicalBars`), so a
 * 220 bar series meant the default view was always the LAST QUARTER of
 * the coin's life — which, on any coin, is the bleed. The launch, the
 * run and the top were all off the left edge, and every look at this
 * page opened on a chart falling out of the sky with nothing above it.
 *
 * At 60 the whole arc is the window: it opens low, runs, tops, chops and
 * bleeds, all on screen, which is what a chart of a coin looks like.
 */
export const mockCandles: CandlestickData<Time>[] = buildCandles(52);

/**
 * When this coin graduated: the FIRST bar whose close crosses the bonding
 * curve's completion cap, not the last one to touch it.
 *
 * A coin graduates once, on the way up, at the moment the curve fills.
 * Picking a bar by eye put the M somewhere in the chop where the price
 * happened to be at that level again — which reads as the coin
 * graduating twice, or graduating on the way down.
 */
export const MOCK_GRADUATION_MC = 39_000;

export const mockGraduatedAtMs: number | null = (() => {
  const bar = mockCandles.find((c) => c.close >= MOCK_GRADUATION_MC);
  return bar ? Number(bar.time) * 1000 : null;
})();

/** SS = Stop Sell, DS = Dev Sell, SB = Strategy Buy, B = Buy */
export const mockMarkers: SeriesMarker<Time>[] = (() => {
  const len = mockCandles.length;
  const pick = (
    idx: number,
    shape: SeriesMarkerShape,
    position: SeriesMarkerBarPosition,
    color: string,
    text: string,
  ): SeriesMarker<Time> => ({
    time: mockCandles[idx]!.time,
    position,
    color,
    shape,
    text,
  });
  /* Indices are FRACTIONS of the series, not counts back from its end.
     They were absolute (`len - 55`), which reached past the start the
     moment the series was shortened from 220 bars to 52 and took the
     whole page down on `undefined.time`. */
  const at = (fraction: number) => Math.min(len - 1, Math.max(0, Math.round(fraction * (len - 1))));
  return [
    pick(at(0.12), 'circle', 'belowBar', '#22c77e', 'B'),
    pick(at(0.22), 'circle', 'belowBar', '#22c77e', 'SB'),
    pick(at(0.4), 'circle', 'aboveBar', '#f0567a', 'SS'),
    pick(at(0.46), 'circle', 'aboveBar', '#f0567a', 'SS'),
    pick(at(0.52), 'circle', 'aboveBar', '#f0567a', 'DS'),
    pick(at(0.58), 'circle', 'aboveBar', '#f0567a', 'DS'),
    pick(at(0.74), 'circle', 'aboveBar', '#f0567a', 'SS'),
    pick(at(0.86), 'circle', 'aboveBar', '#f0567a', 'SS'),
  ];
})();

export interface MockTrade {
  id: string;
  /** Source event arrival timestamp; when present the table can keep age ticking locally. */
  arrivedAtMs?: number;
  /** Whole-second clock used as the baseline for synchronized age ticks. */
  ageBaseMs?: number;
  /** Seconds since trade — used for sorting; age string is derived. */
  ageSec: number;
  age: string;
  type: 'Buy' | 'Sell';
  mc: string;
  totalSol: string;
  /** Percent of total supply this individual trade represented. */
  supplyPct: string;
  /** Percent of total supply the trader holds after this trade. */
  supplyHeld: string;
  trader: string;
  /** Full wallet address when the row came from live snapshot data. */
  traderAddress?: string;
  /** Transaction signature when known — powers the Solscan tx jump. */
  signature?: string;
  badge: number;
}

/*
 * ── EVERY ROW CARRIES A FULL ADDRESS ─────────────────────────────────
 *
 * `trader` is the truncated form the cell prints; `traderAddress` is
 * what the cell actually needs. Without it `TradesTable` renders the
 * name as a plain `<span>` instead of a button — the wallet profile
 * could not be opened from the tape at all, and nothing said why.
 *
 * These are the middle-truncated forms filled back out, so what the row
 * shows and what the click carries are the same wallet.
 */
export const mockTrades: MockTrade[] = [
  { id: 'mock-1', traderAddress: 'fR9qL8mYcNBqiior9gYjKpW2vTzDseVhNrbXumEnaL1', ageSec: 14,  age: '14s', type: 'Sell', mc: '$2.41K', totalSol: '0.812', supplyPct: '1.24%', supplyHeld: '2.10%', trader: 'fR9...aL1', badge: 4 },
  { id: 'mock-2', traderAddress: '6oA3xKpVnZtLdQmHs9WcJyEbRf2gTuN7iPaMkXvZ6oY', ageSec: 42,  age: '42s', type: 'Buy',  mc: '$2.58K', totalSol: '2.524', supplyPct: '4.21%', supplyHeld: '8.33%', trader: '6oA...6oY', badge: 3 },
  { id: 'mock-3', traderAddress: 'D6KtnLpWvB4cRzXyQmEa8sHfJdU3gTiVoN5rZbKxzf4', ageSec: 78,  age: '1m',  type: 'Buy',  mc: '$2.9K',  totalSol: '1.322', supplyPct: '2.18%', supplyHeld: '4.52%', trader: 'D6K...zf4', badge: 2 },
  { id: 'mock-4', traderAddress: 'WGn7qYrLcTvB2mKdXsEpJz9RaHf4uNiVoQ3tZbMysk2', ageSec: 94,  age: '1m',  type: 'Buy',  mc: '$3.14K', totalSol: '1.363', supplyPct: '2.07%', supplyHeld: '3.21%', trader: 'WGn...sk2', badge: 2 },
  { id: 'mock-5', traderAddress: 'C5EhKqWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcVbXyqw', ageSec: 108, age: '1m',  type: 'Buy',  mc: '$3.3K',  totalSol: '0.402', supplyPct: '0.59%', supplyHeld: '1.84%', trader: 'C5E...yqw', badge: 2 },
  { id: 'mock-6', traderAddress: 'od1RmKpWvL9cTzXqYsEbJn4HfDa7uGiVoP3tZrMxTeq', ageSec: 120, age: '2m',  type: 'Buy',  mc: '$3.34K', totalSol: '0.04',  supplyPct: '0.06%', supplyHeld: '0.42%', trader: 'od1...Teq', badge: 2 },
  { id: 'mock-7', traderAddress: 'K7zVnLqWpRt5cMzXyBsEdJf2HaU8gTiNoQ6rZbKvqB8', ageSec: 156, age: '2m',  type: 'Sell', mc: '$3.41K', totalSol: '0.228', supplyPct: '0.32%', supplyHeld: '0.08%', trader: 'K7z...qB8', badge: 1 },
];

export interface MockPnL {
  bought: string;
  sold: string;
  holding: string;
  pnl: string;
}

export const mockPnL: MockPnL = {
  bought: '0',
  sold: '0',
  holding: '0',
  pnl: '+0 (+0%)',
};


/*
 * ── HOLDERS ──────────────────────────────────────────────────────────
 *
 * The Holders tab is a live feed on the shipping page; here it has the
 * same standing as the tape — a set of rows with the real SHAPE, so the
 * table can be looked at and worked on. Sol amounts are lamport strings
 * and token amounts base units, because that is what the cells parse.
 */
export const mockHolders: TokenHolder[] = [
  { rank: 1,  owner: 'LiQpooLW7vTnB4cRzXyQmEa8sHfJdU3gTiVoN5rZbKx', amountBaseUnits: '58200000000000', supplyPct: 5.82, tokenAccountCount: 1, solBalanceLamports: '3370000000',  boughtTokenBaseUnits: '0',              boughtSolLamports: '0',          soldTokenBaseUnits: '0', soldSolLamports: '0', heldSinceMs: 1_700_000_000_000, fundingSource: 'FiwwHe2obYsFoxpr' },
  { rank: 2,  owner: '5D6HqWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcVbX84m', amountBaseUnits: '41900000000000', supplyPct: 4.19, tokenAccountCount: 1, solBalanceLamports: '166300000',   boughtTokenBaseUnits: '41900000000000', boughtSolLamports: '93000000',   soldTokenBaseUnits: '0', soldSolLamports: '0', avgBuyMarketCapUsd: 21000,  unrealizedPnlSol: -0.5845, heldSinceMs: 1_699_996_400_000, fundingSource: 'Robinhood' },
  { rank: 3,  owner: 'AgiN7qYrLcTvB2mKdXsEpJz9RaHf4uNiVoQ3tZbHx9', amountBaseUnits: '22000000000000', supplyPct: 2.20, tokenAccountCount: 1, solBalanceLamports: '139980000',   boughtTokenBaseUnits: '22000000000000', boughtSolLamports: '46000000',   soldTokenBaseUnits: '0', soldSolLamports: '0', avgBuyMarketCapUsd: 14600,  unrealizedPnlSol: -0.3424, heldSinceMs: 1_699_992_800_000, fundingSource: 'Revolut' },
  { rank: 4,  owner: 'aLpHast4rfishKqWnLpT8vRzYmXdBs2JfUa6gTiNo1', amountBaseUnits: '41900000000000', supplyPct: 4.19, tokenAccountCount: 3, solBalanceLamports: '134080000',   boughtTokenBaseUnits: '41900000000000', boughtSolLamports: '141000000',  soldTokenBaseUnits: '20900000000000', soldSolLamports: '279400000', avgBuyMarketCapUsd: 14100, avgSellMarketCapUsd: 12500, unrealizedPnlSol: -0.3504, heldSinceMs: 1_699_989_200_000, fundingSource: 'Coinbase' },
  { rank: 5,  owner: 'CV45qWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcVbGxK7', amountBaseUnits: '39300000000000', supplyPct: 3.93, tokenAccountCount: 2, solBalanceLamports: '130290000',   boughtTokenBaseUnits: '39300000000000', boughtSolLamports: '40000000',   soldTokenBaseUnits: '18900000000000', soldSolLamports: '251500000', avgBuyMarketCapUsd: 13300, avgSellMarketCapUsd: 12500, unrealizedPnlSol: -0.3054, heldSinceMs: 1_699_985_600_000, fundingSource: 'Binance' },
  { rank: 6,  owner: 'ggg88FoMoqWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcV', amountBaseUnits: '24200000000000', supplyPct: 2.42, tokenAccountCount: 1, solBalanceLamports: '126780000',   boughtTokenBaseUnits: '24200000000000', boughtSolLamports: '3878000000', soldTokenBaseUnits: '4300000000000',  soldSolLamports: '51960000',  avgBuyMarketCapUsd: 9800,  avgSellMarketCapUsd: 11300, unrealizedPnlSol: -0.2009, heldSinceMs: 1_699_982_000_000, fundingSource: '7U5UJRTTg' },
  { rank: 7,  owner: 'MnT4qWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcVbXyH2', amountBaseUnits: '18400000000000', supplyPct: 1.84, tokenAccountCount: 1, solBalanceLamports: '98400000',    boughtTokenBaseUnits: '18400000000000', boughtSolLamports: '31000000',   soldTokenBaseUnits: '0', soldSolLamports: '0', avgBuyMarketCapUsd: 9100,   unrealizedPnlSol: 0.0412,  heldSinceMs: 1_699_978_400_000, fundingSource: 'Kraken' },
  { rank: 8,  owner: 'Ph9xqWnLpT8vRzYmXdBs2JfUa6gTiNoQ4rZcVbXyR5', amountBaseUnits: '12600000000000', supplyPct: 1.26, tokenAccountCount: 1, solBalanceLamports: '74200000',    boughtTokenBaseUnits: '12600000000000', boughtSolLamports: '19000000',   soldTokenBaseUnits: '0', soldSolLamports: '0', avgBuyMarketCapUsd: 7400,   unrealizedPnlSol: 0.1188,  heldSinceMs: 1_699_974_800_000, fundingSource: 'Bybit' },
];
