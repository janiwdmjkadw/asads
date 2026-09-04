/**
 * The hover card's pure half (spec/10-system.md §1.4.2) — the glimpse.
 *
 * Everything a test can pin without a DOM lives here: the open/close bus
 * (the same module-scope pattern as `composerFocus.ts`), the candle→path
 * geometry for the 336×64 lime chart, the scrub maths, and the little
 * formatters the pane needs. The React half (`TokenHoverCard.tsx`) only
 * fetches and draws.
 */

export interface HoverAnchor {
  /** Viewport rect of the hovered tag. */
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface HoverRequest {
  readonly mint: string;
  readonly label: string;
  readonly anchor: HoverAnchor;
}

type Listener = (open: HoverRequest | null) => void;

const listeners = new Set<Listener>();
let current: HoverRequest | null = null;

/** Publish a tag hover (or `null` on leave). One card at a time. */
export function publishTokenHover(next: HoverRequest | null): void {
  current = next;
  for (const l of listeners) l(current);
}

export function subscribeTokenHover(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ *
 * Chart geometry. The design is a smooth cubic line with a soft wash —
 * no axes, no dots at rest. Catmull-Rom through the closes, emitted as
 * cubic beziers; the wash closes the same path to the baseline.
 * ------------------------------------------------------------------ */

export interface ChartGeometry {
  readonly line: string;
  readonly wash: string;
  /** X per point, for the scrub's nearest-index lookup. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

export function chartGeometry(
  closes: readonly number[],
  width: number,
  height: number,
  pad = 3,
): ChartGeometry | null {
  const pts = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (pts.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const c of pts) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const spread = max - min || max * 0.001 || 1;
  const xs: number[] = [];
  const ys: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    xs.push((i / (n - 1)) * width);
    ys.push(pad + (1 - (pts[i] - min) / spread) * (height - pad * 2));
  }
  const seg = (i: number) => {
    // Catmull-Rom → cubic bezier control points (standard 1/6 form).
    const p0 = Math.max(0, i - 1);
    const p3 = Math.min(n - 1, i + 2);
    const c1x = xs[i] + (xs[i + 1] - xs[p0]) / 6;
    const c1y = ys[i] + (ys[i + 1] - ys[p0]) / 6;
    const c2x = xs[i + 1] - (xs[p3] - xs[i]) / 6;
    const c2y = ys[i + 1] - (ys[p3] - ys[i]) / 6;
    return `C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(xs[i + 1])} ${r2(ys[i + 1])}`;
  };
  let line = `M${r2(xs[0])} ${r2(ys[0])}`;
  for (let i = 0; i < n - 1; i++) line += seg(i);
  const wash = `${line}L${r2(xs[n - 1])} ${height}L${r2(xs[0])} ${height}Z`;
  return { line, wash, xs, ys };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Nearest point index for a pointer x — the scrub's whole logic. */
export function scrubIndex(xs: readonly number[], pointerX: number): number {
  if (xs.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - pointerX);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** `14:32` in the reader's zone — the only text the chart hover shows. */
export function scrubTime(bucketStartSec: number): string {
  const d = new Date(bucketStartSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Percent change over the drawn window, or null when it cannot be said. */
export function windowChangePct(closes: readonly number[]): number | null {
  const pts = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

/** A rational-string candle close (`close_num`/`close_den`) → number. */
export function rationalToNumber(num: string, den: string): number {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return NaN;
  return n / d;
}

/**
 * Where the card goes: under the paragraph, full reply width; when the
 * space below the anchor inside the window cannot hold it, it flips
 * above the tag (§1.4.2's measured constraint — the card is ~241px tall
 * and lands ~9px above the composer on a low reply).
 */
export function cardPosition(
  anchor: HoverAnchor,
  cardHeight: number,
  boundsTop: number,
  boundsBottom: number,
): { top: number; flipped: boolean } {
  const below = anchor.bottom + 8;
  if (below + cardHeight <= boundsBottom - 8) return { top: below, flipped: false };
  const above = anchor.top - 8 - cardHeight;
  if (above >= boundsTop + 8) return { top: above, flipped: true };
  // Neither fits cleanly — pin to the bottom bound, still under the tag
  // when possible (the design accepts scroll-to-make-room as the out).
  return { top: Math.max(boundsTop + 8, boundsBottom - 8 - cardHeight), flipped: false };
}
