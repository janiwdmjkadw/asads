import { memo } from 'react';

/**
 * Bonding-progress visuals + math shared by the discover cards and the
 * token search results. Extracted from `CoinCard.tsx` / `useLiveNewPairs.ts`
 * verbatim so both surfaces render the exact same graduation frame.
 */

const BONDING_BORDER_OCTANTS = 8;
/* Two-tone green: the unlit remainder is a greyed/dark green track, and
   the lit progress is the brighter theme green. Graduated coins (pinned
   to a full border) read gold instead. */
const BONDING_TRACK_COLOR = 'color-mix(in srgb, var(--up) 28%, var(--surface-3))';
const BONDING_FILL_COLOR = 'var(--up)';
const BONDING_GRADUATED_COLOR = '#F3C709';

/**
 * Square progress border framing the token image.
 *
 * Geometry: a full-bleed SVG `<rect>` (0,0 → 100,100, square corners)
 * sized to the frame box. The svg is offset past the image by a single
 * `-inset-[3px]` (the ONE gap knob), and `overflow-visible` lets the
 * centered 1px `non-scaling-stroke` straddle the box edge without being
 * clipped — so the visible gap from image to line is ~`inset - 0.5px`.
 *
 * Fill: `pathLength={8}` normalizes the perimeter to 8 units so each
 * octant is exactly one unit (regardless of pixel size or unequal
 * corner/edge lengths), and `strokeDasharray` lights `bucket`/8 of it
 * clockwise starting at the top-left corner.
 *
 * Reads ONLY the quantized `bucket`, so `memo` skips this subtree on the
 * frequent market-cap ticks that re-render the parent card — it repaints
 * only when progress crosses a 12.5% boundary. `pointer-events: none`
 * keeps the image's hover-preview and the card's click target intact.
 */
const BONDING_RECT = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  fill: 'none',
  vectorEffect: 'non-scaling-stroke' as const,
  strokeWidth: 1,
} as const;

export const BondingBorder = memo(function BondingBorder({
  bucket,
  graduated,
}: {
  bucket: number | null;
  graduated: boolean;
}) {
  const fill = graduated ? BONDING_GRADUATED_COLOR : BONDING_FILL_COLOR;
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      className="pointer-events-none absolute -inset-[3px] overflow-visible"
    >
      {/* Greyed-green full-perimeter track (the unlit remainder). */}
      <rect {...BONDING_RECT} stroke={BONDING_TRACK_COLOR} />
      {/* Lit segment: bucket/8 of the perimeter (gold when graduated). */}
      {bucket != null && bucket > 0 ? (
        <rect
          {...BONDING_RECT}
          stroke={fill}
          pathLength={BONDING_BORDER_OCTANTS}
          strokeDasharray={`${bucket} ${BONDING_BORDER_OCTANTS - bucket}`}
          style={{
            filter: `drop-shadow(0 0 2px color-mix(in srgb, ${fill} 45%, transparent))`,
          }}
        />
      ) : null}
    </svg>
  );
});

/**
 * pump.fun badge pinned to the bottom-right corner of the token image,
 * sitting on the graduation border. Decorative (pointer-events: none) —
 * the clickable pump.fun link still lives in MetaRow. Memoized on
 * `graduated` (only thing it reads) so it skips the parent card's
 * frequent market-cap ticks. The ring matches the frame color (gold once
 * graduated) so it reads as connected to the border.
 */
export const PumpBadge = memo(function PumpBadge({ graduated }: { graduated: boolean }) {
  const ring = graduated ? BONDING_GRADUATED_COLOR : BONDING_FILL_COLOR;
  return (
    <span
      aria-hidden
      // bottom-0 right-0 anchors to the image's bottom-right corner; the
      // 50% translate puts the circle's CENTER exactly on that corner,
      // independent of the circle's size.
      className="pointer-events-none absolute bottom-0 right-0 flex translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full"
      style={{
        width: 14,
        height: 14,
        background: 'var(--surface-3)',
        border: `1.5px solid ${ring}`,
        boxShadow: `0 0 3px color-mix(in srgb, ${ring} 40%, transparent)`,
      }}
    >
      <img src="/assets/pump_icon.svg" alt="" className="block" style={{ width: 8, height: 8 }} />
    </span>
  );
});

/* Canonical pump.fun bonding-curve seed: 793.1M tokens (x 1e6 decimals)
   start on the curve for sale. Graduation triggers exactly when these
   drain to zero — the same `real_token_base_units == 0` rule the
   ingestion engine uses — so progress to graduation is the fraction of
   these tokens already sold. Constant matches the backend curve seeds
   (INITIAL_VTR_BASE / TOTAL_SUPPLY_BASE). */
const BONDING_CURVE_TOKENS_FOR_SALE_BASE = 793_100_000_000_000n;
const BONDING_PROGRESS_BUCKETS = 8;

/**
 * Token-reserve-based graduation progress (0-100), the true trigger:
 * `(1 - realTokenBaseUnits / initialForSale) * 100`. BigInt math keeps
 * full precision on the string-encoded reserves (above JS safe-int
 * range), then a basis-point integer is converted once and clamped.
 * Returns `null` when reserves are unknown so callers can render an
 * empty state instead of a misleading 0%.
 */
export function bondingProgressFromReserves(
  realTokenBaseUnits: string | null | undefined,
): number | null {
  if (!realTokenBaseUnits) return null;
  try {
    const remaining = BigInt(realTokenBaseUnits);
    if (remaining < 0n) return null;
    const sold = BONDING_CURVE_TOKENS_FOR_SALE_BASE - remaining;
    if (sold <= 0n) return 0;
    if (sold >= BONDING_CURVE_TOKENS_FOR_SALE_BASE) return 100;
    // Basis points keep one decimal of headroom without floats on big ints.
    const bps = (sold * 10_000n) / BONDING_CURVE_TOKENS_FOR_SALE_BASE;
    return Number(bps) / 100;
  } catch {
    return null;
  }
}

/**
 * Quantize progress into 8 octants (0-8 lit segments). Floors to the
 * octant so the border only advances once a full 12.5% step is crossed,
 * which keeps the visual stable and adds no re-renders beyond the
 * existing market-cap ticks (see `coinsEqual`). `null` passes through.
 */
export function bondingProgressBucket(pct: number | null): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const bucket = Math.floor(pct / (100 / BONDING_PROGRESS_BUCKETS));
  return Math.max(0, Math.min(BONDING_PROGRESS_BUCKETS, bucket));
}
