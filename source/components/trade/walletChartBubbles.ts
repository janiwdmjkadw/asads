import type {
  CandlestickData,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

/**
 * Tracked-wallet trade bubbles on the price chart, drawn as a custom
 * series primitive: a filled green (buy) / red (sell) disc with the
 * wallet's emoji CENTERED inside it, filling most of the circle.
 *
 * lightweight-charts' built-in series markers can only render text NEXT
 * to a shape (which put the emoji outside the circle); a primitive owns
 * its own canvas pass, so the disc + glyph compose exactly. Positions are
 * recomputed in `updateAllViews` (the library calls it before every
 * paint), so the bubbles pan/zoom/autoscale in perfect sync with the
 * candles — no rAF loop, no drift.
 */

export interface WalletBubble {
  /** Candle bucket the trade snapped to (chart x anchor). */
  timeSec: number;
  /** Same-bucket bubbles stack upward instead of overlapping. */
  stackIndex: number;
  isBuy: boolean;
  /** Wallet emoji, or the 'B'/'S' fallback when the wallet has none.
   *  Dev (creator) trades use 'DB'/'DS'. */
  label: string;
  isEmoji: boolean;
  /** A drawn mark instead of a label. `insider` is the bundler's; `wallet`
   *  is a claim. Both are filled paths, so they take the disc's ink the
   *  way a letter does. */
  icon?: BubbleIcon;
  /** Overrides the buy/sell disc fill — the graduation "M" marker's
   *  gold disc is neither a buy nor a sell. */
  fillColor?: string;
}

interface BubblePoint {
  x: number;
  y: number;
  isBuy: boolean;
  label: string;
  isEmoji: boolean;
  icon?: BubbleIcon;
  fillColor?: string;
}

/*
 * ── THE TWO DRAWN MARKS ──────────────────────────────────────────────
 *
 * Everything else on a bubble is a letter or an emoji, which canvas can
 * simply `fillText`. These two are pictures, so they are paths: taken
 * from the app's own artwork (`/assets/insider_icon.svg` and the icon
 * set's Wallet), authored on a 24 unit box, and scaled into the disc at
 * draw time.
 *
 * `wallet` is stroked rather than filled — it is a line icon and a
 * filled version of it is a black rectangle.
 */
const ICON_PATHS = {
  insider: {
    fill:
      'M12 2C16.9706 2 21 6.02944 21 11V18.5C21 20.433 19.433 22 17.5 22C16.3001 22 15.2413 21.3962 14.6107 20.476C14.0976 21.3857 13.1205 22 12 22C10.8795 22 9.9024 21.3857 9.38728 20.4754C8.75869 21.3962 7.69985 22 6.5 22C4.63144 22 3.10487 20.5357 3.00518 18.692L3 18.5V11C3 6.02944 7.02944 2 12 2ZM12 4C8.21455 4 5.1309 7.00478 5.00406 10.7593L5 11L4.99927 18.4461L5.00226 18.584C5.04504 19.3751 5.70251 20 6.5 20C6.95179 20 7.36652 19.8007 7.64704 19.4648L7.73545 19.3478C8.57033 18.1248 10.3985 18.2016 11.1279 19.4904C11.3053 19.8038 11.6345 20 12 20C12.3651 20 12.6933 19.8044 12.8687 19.4934C13.5692 18.2516 15.2898 18.1317 16.1636 19.2151L16.2606 19.3455C16.5401 19.7534 16.9976 20 17.5 20C18.2797 20 18.9204 19.4051 18.9931 18.6445L19 18.5V11C19 7.13401 15.866 4 12 4ZM12 12C13.1046 12 14 13.1193 14 14.5C14 15.8807 13.1046 17 12 17C10.8954 17 10 15.8807 10 14.5C10 13.1193 10.8954 12 12 12ZM9.5 8C10.3284 8 11 8.67157 11 9.5C11 10.3284 10.3284 11 9.5 11C8.67157 11 8 10.3284 8 9.5C8 8.67157 8.67157 8 9.5 8ZM14.5 8C15.3284 8 16 8.67157 16 9.5C16 10.3284 15.3284 11 14.5 11C13.6716 11 13 10.3284 13 9.5C13 8.67157 13.6716 8 14.5 8Z',
  },
  wallet: {
    stroke: 'M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2M16 12h5M16 16h5',
  },
} as const;

export type BubbleIcon = keyof typeof ICON_PATHS;

/** Multiply a #rrggbb by a factor, clamped. */
function darken(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const out = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.round(c * factor)));
  return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

/*
 * 13, from 10.
 *
 * A 20px disc carrying a letter or a two character class code was the
 * smallest readable thing on the pane, and it is the mark you are
 * meant to find first: it says a wallet you are watching traded HERE.
 * At 26px the letter inside it is legible at a glance instead of under
 * inspection, and everything derived from this — the label sizes, the
 * gap off the wick, the stack step and the hit box — comes up with it.
 */
export const BUBBLE_RADIUS = 13;
/** Emoji glyphs are ~square at font-size, so 1.5R fills most of the disc. */
const EMOJI_FONT_PX = Math.round(BUBBLE_RADIUS * 1.5);
const LETTER_FONT_PX = Math.round(BUBBLE_RADIUS * 1.1);
/**
 * Gap between the candle high and the first bubble's bottom edge.
 *
 * Six put the disc on top of the wick it belonged to — close enough that
 * the mark and the candle read as one object, and on a tall wick the
 * disc sat in the middle of the bar. Fourteen is clear of the tape and
 * still unmistakably attached to that candle rather than the one beside
 * it.
 */
export const ANCHOR_GAP_PX = 14;
export const STACK_STEP_PX = BUBBLE_RADIUS * 2 + 4;
/*
 * The app's own face, not `sans-serif`.
 *
 * Canvas has no access to the CSS cascade, so `700 11px sans-serif`
 * resolved to whatever the platform calls sans — Arial on Windows, and
 * at 11px inside a 20px disc that is visibly thinner and narrower than
 * the same letters set anywhere else in the product. Naming Geist first
 * puts the disc in the same voice as the panel beside it.
 */
const BUBBLE_FONT = "'Geist', 'Geist Fallback', system-ui, sans-serif";
/*
 * ── AND THE DISCS ARE THE PAGE'S OWN GREEN AND RED ───────────────────
 *
 * These two were the black chart's pair: a bright mint and a hot pink,
 * picked to carry on a near black pane. On paper a light disc with dark
 * letters in it is the WEAKEST mark on the chart — which is the other
 * half of why these were hard to find. The candles were deepened for
 * the same reason; the bubbles that sit on them were missed.
 */
const BUY_COLOR = '#0f6d5f';
const SELL_COLOR = '#b4482e';

/*
 * The label reads off its own disc rather than off a constant. A single
 * ink colour was right when every disc was a bright hue, and wrong the
 * moment one of them is the aggregate's ink or the migration's amber:
 * near black letters on a near black disc are not letters at all.
 */
function labelInk(fill: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const luminance = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
  return luminance > 0.62 ? '#0b0d11' : '#ffffff';
}

class BubblesPaneRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly points: readonly BubblePoint[],
    private readonly hovered: number,
  ) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (let index = 0; index < this.points.length; index += 1) {
        const point = this.points[index]!;
        ctx.beginPath();
        ctx.arc(point.x, point.y, BUBBLE_RADIUS, 0, Math.PI * 2);
        const base = point.fillColor ?? (point.isBuy ? BUY_COLOR : SELL_COLOR);
        const ink = labelInk(base);
        /* Under the pointer the disc DARKENS and nothing else moves. A
           20px mark sitting on a candle cannot grow, ring or lift
           without covering the candle beside it. */
        ctx.fillStyle = index === this.hovered ? darken(base, 0.72) : base;
        ctx.fill();
        /*
         * ── NO RING ──────────────────────────────────────────────
         *
         * Every class used to carry a 1.5px stroke in its own colour:
         * gold for the dev, cyan for you, red for a sniper, violet for
         * a bundler, pale amber on the graduation mark, grey on the
         * overflow. Six hues on a 20px disc that is already green or
         * pink, stacked eight high over a candle — the discs read as
         * outlined stickers rather than as marks on a chart, and the
         * outline was the loudest thing in the pane.
         *
         * The LABEL carries the class instead. It already did for the
         * dev (DB/DS), the sniper and the bundler; `self` now says Y
         * rather than B, which is the one case a ring was doing work
         * the letter was not.
         */
        if (point.icon) {
          /* The 24 unit artwork, centred and scaled to 0.72 of the
             diameter — the same optical size a two letter label takes. */
          const scale = (BUBBLE_RADIUS * 2 * 0.72) / 24;
          ctx.save();
          ctx.translate(point.x - BUBBLE_RADIUS * 0.72, point.y - BUBBLE_RADIUS * 0.72);
          ctx.scale(scale, scale);
          const art = ICON_PATHS[point.icon];
          if ('fill' in art) {
            ctx.fillStyle = ink;
            ctx.fill(new Path2D(art.fill));
          } else {
            ctx.strokeStyle = ink;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke(new Path2D(art.stroke));
          }
          ctx.restore();
          continue;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (point.isEmoji) {
          ctx.font = `${EMOJI_FONT_PX}px ${BUBBLE_FONT}`;
          // Emoji render in their own color; +0.5 optically centers the
          // glyph box inside the disc.
          ctx.fillText(point.label, point.x, point.y + 0.5);
        } else {
          // Two-char labels (DB/DS) shrink to stay inside the disc.
          const px = point.label.length > 1 ? Math.round(BUBBLE_RADIUS * 0.9) : LETTER_FONT_PX;
          ctx.font = `800 ${px}px ${BUBBLE_FONT}`;
          ctx.fillStyle = ink;
          ctx.fillText(point.label, point.x, point.y + 0.5);
        }
      }
    });
  }
}

class BubblesPaneView implements IPrimitivePaneView {
  constructor(private readonly owner: WalletChartBubbles) {}

  zOrder(): 'top' {
    // Above the candles — a bubble half-covered by a wick reads broken.
    return 'top';
  }

  renderer(): IPrimitivePaneRenderer {
    return new BubblesPaneRenderer(this.owner.points, this.owner.hovered);
  }
}

export class WalletChartBubbles implements ISeriesPrimitive<Time> {
  points: BubblePoint[] = [];
  /** Index into `points` of the disc under the pointer, or -1. */
  hovered = -1;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick', Time> | null = null;
  private requestUpdateFn: (() => void) | null = null;
  private bubbles: readonly WalletBubble[] = [];
  private readonly paneView = new BubblesPaneView(this);

  /**
   * `candlesRef` is a live ref to the series' CURRENT ascending candle
   * array — bubble y anchors read each bucket's `high` at update time, so
   * a live tick that grows a candle pushes its bubbles up with it.
   */
  constructor(private readonly candlesRef: { current: CandlestickData<Time>[] }) {}

  /**
   * Light one disc. Takes a pane point rather than an index so the caller
   * does not have to know how `points` is ordered — the primitive owns
   * that, and it is the only thing that knows where each disc landed.
   *
   * Returns the lit disc's OWN CENTRE, which is what anything anchored to
   * it should use. Handing back a boolean and letting the caller place a
   * tooltip at the pointer made the tooltip drift with the mouse inside
   * the disc's hit area; a mark on a chart does not move, so nothing
   * attached to it should either.
   */
  setHovered(x: number, y: number): { x: number; y: number } | null {
    let next = -1;
    let best = Infinity;
    const reach = BUBBLE_RADIUS + 3;
    for (let i = 0; i < this.points.length; i += 1) {
      const p = this.points[i]!;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 < best) {
        best = d2;
        next = i;
      }
    }
    if (next !== this.hovered) {
      this.hovered = next;
      this.requestUpdateFn?.();
    }
    const point = next === -1 ? null : this.points[next]!;
    return point ? { x: point.x, y: point.y } : null;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick', Time>;
    this.requestUpdateFn = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdateFn = null;
  }

  /** `bubbles` must be ascending by `timeSec` (buildWalletTradeMarkerModel
   *  emits them from time-sorted bucket runs) — `updateAllViews` binary
   *  searches the visible window against that order. */
  setBubbles(bubbles: readonly WalletBubble[]): void {
    this.bubbles = bubbles;
    this.requestUpdateFn?.();
  }

  updateAllViews(): void {
    const chart = this.chart;
    const series = this.series;
    const next: BubblePoint[] = [];
    if (chart && series && this.bubbles.length > 0) {
      const timeScale = chart.timeScale();
      // Only project the visible time window. Off-window bubbles already
      // rendered nothing (timeToCoordinate returns null outside the visible
      // range), but on a busy mint this ran the full projection — including
      // a per-bubble binary search over the whole candle array — for EVERY
      // bubble on EVERY paint, which is exactly the wheel-zoom hot path.
      const range = timeScale.getVisibleRange();
      if (range !== null) {
        const fromSec = Number(range.from);
        const toSec = Number(range.to);
        const candles = this.candlesRef.current;
        const bubbles = this.bubbles;
        // Lower bound: first bubble with timeSec >= fromSec.
        let lo = 0;
        let hi = bubbles.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (bubbles[mid]!.timeSec < fromSec) lo = mid + 1;
          else hi = mid;
        }
        for (let i = lo; i < bubbles.length; i += 1) {
          const bubble = bubbles[i]!;
          if (bubble.timeSec > toSec) break;
          const x = timeScale.timeToCoordinate(bubble.timeSec as Time);
          if (x === null) continue;
          const high = highAtTime(candles, bubble.timeSec);
          if (high === null) continue;
          const anchorY = series.priceToCoordinate(high);
          if (anchorY === null) continue;
          next.push({
            x,
            y: anchorY - ANCHOR_GAP_PX - BUBBLE_RADIUS - bubble.stackIndex * STACK_STEP_PX,
            isBuy: bubble.isBuy,
            label: bubble.label,
            isEmoji: bubble.isEmoji,
            icon: bubble.icon,
            fillColor: bubble.fillColor,
          });
        }
      }
    }
    this.points = next;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}

/** Binary search the ascending candle array for a bucket's candle. */
export function candleAtTime(
  candles: readonly CandlestickData<Time>[],
  timeSec: number,
): CandlestickData<Time> | null {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(candles[mid]!.time);
    if (t === timeSec) return candles[mid]!;
    if (t < timeSec) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Binary search the ascending candle array for a bucket's high. */
export function highAtTime(candles: readonly CandlestickData<Time>[], timeSec: number): number | null {
  return candleAtTime(candles, timeSec)?.high ?? null;
}
