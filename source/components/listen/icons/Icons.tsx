import { useId } from 'react';
import type { CSSProperties, ReactElement, SVGProps } from 'react';

/**
 * Listen — inline-SVG icon kit.
 *
 * Tight, brand-consistent set tuned to 1.75px stroke. Replaces the trade
 * page's `@heroicons/react` imports so we own the glyph set and can
 * adjust stroke / corners / sizing without depending on a third-party
 * package update.
 *
 * All icons are `currentColor` strokes (unless noted) so callers control
 * tint via `style={{ color }}` or className utilities. Pass SVG props
 * through; `width`/`height` should be set by the caller (default 16px).
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  className?: string;
  style?: CSSProperties;
};

interface BaseProps {
  d?: string;
  children?: React.ReactNode;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  /** Override default stroke-width (1.75). Set 0 for filled icons. */
  strokeWidth?: number;
}

function makeIcon({
  d,
  children,
  viewBox = '0 0 24 24',
  fill = 'none',
  stroke = 'currentColor',
  strokeWidth = 1.75,
}: BaseProps): (props: IconProps) => ReactElement {
  return function Icon({ className, style, ...rest }: IconProps) {
    return (
      <svg
        viewBox={viewBox}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth || undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden
        {...rest}
      >
        {d ? <path d={d} /> : children}
      </svg>
    );
  };
}

export const Sparkles = makeIcon({
  d: 'M9.8 14.4l-1.6 3.6-1.6-3.6L3 12.8l3.6-1.6L8.2 7.6l1.6 3.6 3.6 1.6zM16 4l.9 2.1L19 7l-2.1.9L16 10l-.9-2.1L13 7l2.1-.9zM18 14l.8 1.8 1.8.8-1.8.8L18 19.2l-.8-1.8-1.8-.8 1.8-.8z',
});

export const Settings = makeIcon({
  children: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h0a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v0a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
});

export const Chevron = makeIcon({ d: 'M6 9l6 6 6-6' });

/** The blacklists. A bookmark, which is the mark the reference clients
 *  use for the same thing — a list you keep, not a thing you toggle. */
export const Bookmark = makeIcon({
  d: 'M6 4.5h12a1 1 0 011 1V20l-7-3.6L5 20V5.5a1 1 0 011-1z',
});

export const Pencil = makeIcon({
  d: 'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
});

export const Calendar = makeIcon({
  children: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
});

export const Swap = makeIcon({ d: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4' });

export const Bolt = makeIcon({ d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' });

export const Wallet = makeIcon({
  children: (
    <>
      <path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-2" />
      <path d="M16 12h5M16 16h5" />
    </>
  ),
});

/** Agent glyph: antenna'd head with two solid eyes (filled, not stroked). */
export const Bot = makeIcon({
  children: (
    <>
      <rect x="4.5" y="8" width="15" height="10" rx="3" />
      <path d="M12 8V5.2" />
      <circle cx="12" cy="3.9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
});

export const Shield = makeIcon({ d: 'M12 2l8 4v6c0 5-3.5 8.8-8 10-4.5-1.2-8-5-8-10V6l8-4z' });

export const Clock = makeIcon({
  children: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
});

export const Grid = makeIcon({
  children: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
});

export const EyeOff = makeIcon({
  d: 'M3 3l18 18M10.6 10.6A3 3 0 0012 15a3 3 0 002.4-1.2M6.1 6.1C3.6 7.8 2 10 2 12c1.3 2 5 5 10 5 1.6 0 3.2-.3 4.6-.9M17.9 17.9C20.4 16.2 22 14 22 12c-1.3-2-5-5-10-5-.8 0-1.5.1-2.2.3',
});

export const Undo = makeIcon({ d: 'M3 7h11a6 6 0 010 12H6M3 7l4-4M3 7l4 4' });

/** Clockwise re-run arc — "retry this turn". */
export const Retry = makeIcon({
  children: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </>
  ),
});

export const Expand = makeIcon({ d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' });

export const X = makeIcon({ d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' });

export const Camera = makeIcon({
  children: (
    <>
      <path d="M3 9a2 2 0 012-2h1.5l2-2h7l2 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
});

export const ArrowUp = makeIcon({ d: 'M12 19V5m0 0l-6 6m6-6l6 6' });
export const ArrowDown = makeIcon({ d: 'M12 5v14m0 0l-6-6m6 6l6-6' });
export const TrendUp = makeIcon({ d: 'M3 17l6-6 4 4 8-8M21 7h-5M21 7v5' });
export const Formula = makeIcon({ d: 'M14 4a2 2 0 00-2 2v3H7v2h5v7a2 2 0 002 2M9 15l3-3m0 0l3 3m-3-3l-3 3' });

/* ─── Discover-page additions ────────────────────────────────────────── */

export const Search = makeIcon({
  children: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
});

export const User = makeIcon({
  children: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
});

export const Users = makeIcon({
  children: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 21a7 7 0 0114 0" />
      <path d="M16 4a3.5 3.5 0 010 7" />
      <path d="M22 21a7 7 0 00-5-6.7" />
    </>
  ),
});

export const Globe = makeIcon({
  children: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 010 18" />
      <path d="M12 3a14 14 0 000 18" />
    </>
  ),
});

export const Link = makeIcon({
  children: (
    <>
      <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07L12.5 19.5" />
    </>
  ),
});

export const Cpu = makeIcon({
  children: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
});

export const Eye = makeIcon({
  children: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
});

export const SwapH = makeIcon({
  d: 'M16 4l4 4-4 4M20 8H4M8 20l-4-4 4-4M4 16h16',
});

// Slice "Portfolio page wallets tab": a few additional glyphs used by
// the Wallets table action cluster. All currentColor strokes.

export const Star = makeIcon({
  d: 'M12 3l2.6 5.6 6 0.5-4.6 4 1.4 6-5.4-3.2-5.4 3.2 1.4-6-4.6-4 6-0.5z',
});

export const Copy = makeIcon({
  children: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
});

export const Trash = makeIcon({
  children: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
});

export const Plus = makeIcon({
  d: 'M12 5v14M5 12h14',
});

export const ExternalLink = makeIcon({
  children: (
    <>
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </>
  ),
});

export const Filter = makeIcon({
  d: 'M3 5h18l-7 9v6l-4-2v-4z',
});

export const Layers = makeIcon({
  children: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
});

export const Folder = makeIcon({
  d: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
});

export const Archive = makeIcon({
  children: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
      <path d="M10 13h4" />
    </>
  ),
});

export const Key = makeIcon({
  children: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15L21 2" />
      <path d="M17 6l3 3" />
      <path d="M14 9l3 3" />
    </>
  ),
});

/**
 * Solana logomark — official three-bar mark with the canonical
 * purple→green gradient. Mirrors `/public/assets/SOL.svg` 1:1 so the
 * icon matches the official Solana brand wherever we display SOL
 * balances or totals. The internal gradient `<defs>` are namespaced
 * so multiple instances on the page don't clash.
 *
 * Color is baked in (not `currentColor`) by design; pass `width` /
 * `height` via `style` or props to size it.
 */
/** Circle USDC mark — blue disc, white $ and broken arcs. Fixed brand
 *  fills (like the asset-baked icons), so tints only affect any hover
 *  shell around it, never the glyph itself. */
export function Usdc({ className, style, ...rest }: IconProps): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 2000 2000"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <circle cx="1000" cy="1000" r="1000" fill="#2775ca" />
      <path
        fill="#fff"
        d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"
      />
      <path
        fill="#fff"
        d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z"
      />
    </svg>
  );
}

/**
 * The Solana mark.
 *
 * `mono` fills it with `currentColor` instead of the brand gradient.
 * That gradient runs violet `#9945FF` to mint `#19FB9B`, and on a
 * screen built out of one ink scale it is the only thing with a hue —
 * four of them on the wallets tab alone, at 16px, next to figures that
 * are white. The brand mark stays the brand mark everywhere else; on
 * the portfolio it is a unit symbol beside a number, and a unit symbol
 * takes the ink of the number it belongs to.
 */
export function Solana({ className, style, mono, ...rest }: IconProps & { mono?: boolean }): ReactElement {
  // Per-instance gradient id. A fixed document-wide id breaks once route
  // panes stay mounted under `display:none` — Chromium resolves `url(#id)`
  // to the first (hidden) definition and paints no gradient anywhere else.
  const gradientId = `listen-sol-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.44955 6.75999H12.0395C12.1595 6.75999 12.2695 6.80999 12.3595 6.89999L13.8795 8.45999C14.1595 8.74999 13.9595 9.23999 13.5595 9.23999H3.96955C3.84955 9.23999 3.73955 9.18999 3.64955 9.09999L2.12955 7.53999C1.84955 7.24999 2.04955 6.75999 2.44955 6.75999ZM2.12955 4.68999L3.64955 3.12999C3.72955 3.03999 3.84955 2.98999 3.96955 2.98999H13.5495C13.9495 2.98999 14.1495 3.47999 13.8695 3.76999L12.3595 5.32999C12.2795 5.41999 12.1595 5.46999 12.0395 5.46999H2.44955C2.04955 5.46999 1.84955 4.97999 2.12955 4.68999ZM13.8695 11.3L12.3495 12.86C12.2595 12.95 12.1495 13 12.0295 13H2.44955C2.04955 13 1.84955 12.51 2.12955 12.22L3.64955 10.66C3.72955 10.57 3.84955 10.52 3.96955 10.52H13.5495C13.9495 10.52 14.1495 11.01 13.8695 11.3Z"
        fill={mono ? 'currentColor' : `url(#${gradientId})`}
      />
      {/* Skipped in `mono`: the fill no longer points at it, and a
          page that has taken the hue out should not still be shipping
          six brand stops in its DOM for nothing to reference. */}
      {mono ? null : (
        <defs>
          <linearGradient
            id={gradientId}
            x1="1.77756"
            y1="13.3327"
            x2="13.9679"
            y2="1.14234"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#9945FF" />
            <stop offset="0.24" stopColor="#8752F3" />
            <stop offset="0.465" stopColor="#5497D5" />
            <stop offset="0.6" stopColor="#43B4CA" />
            <stop offset="0.735" stopColor="#28E0B9" />
            <stop offset="1" stopColor="#19FB9B" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

/**
 * Leaf — filled glyph (matches Discover's original inline LeafIcon).
 * Used in MetaRow as the "fresh / new" indicator. `currentColor` fill so
 * the consumer can tint it via `style={{ color }}`.
 */
export function Leaf({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M3 17c0-7 4-12 14-13-1 9-5 13-12 13-1 0-1-1-1-1l3-3" />
    </svg>
  );
}

/* Crown is filled (not stroked) — used as a category badge in TradesTable. */
export function Crown({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M3 6.5a1 1 0 011.6-.8L7 7.4l2.2-3.8a1 1 0 011.6 0L13 7.4l2.4-1.7A1 1 0 0117 6.5v7.2a1.3 1.3 0 01-1.3 1.3H4.3A1.3 1.3 0 013 13.7V6.5z" />
    </svg>
  );
}

/* Slip / Gas / Tip — fee-knob iconography for the Trading Settings
   modal's three input cells (slippage / priority / bribe). Original
   SVGs ship in `terminal/public/assets/` as `slip.svg`, `gas.svg`,
   `tip.svg`; mirrored here as inline components so callers can tint
   via `color` (the path `fill` is rewritten to `currentColor`). */

export function Slip({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M5.6149 3.63297C5.98202 3.96106 6.32831 4.272 6.67802 4.57925C6.70572 4.60352 6.7582 4.61275 6.79697 4.60853C7.36875 4.54576 7.94106 4.48431 8.51178 4.41205C8.79873 4.37565 9.0113 4.46506 9.17903 4.70532C9.48576 5.1447 9.80752 5.57354 10.1206 6.0087C10.2551 6.19569 10.2828 6.39824 10.1641 6.60211C10.042 6.81205 9.85552 6.92413 9.6084 6.91253C9.42299 6.90383 9.28954 6.80044 9.18484 6.65459C8.95433 6.33336 8.71934 6.01503 8.49728 5.68827C8.42106 5.57591 8.348 5.54136 8.20901 5.55956C7.64752 5.63367 7.08365 5.69011 6.49947 5.75552C6.53244 5.7906 6.55222 5.81539 6.57543 5.83569C6.93569 6.15139 7.29385 6.46945 7.65833 6.7804C7.83583 6.93205 7.91046 7.11007 7.9007 7.34664C7.87539 7.96114 7.86563 8.57644 7.85429 9.19174C7.84822 9.51719 7.60057 9.76088 7.26827 9.7564C6.94545 9.75218 6.71178 9.51376 6.72391 9.1891C6.74317 8.67983 6.77218 8.17081 6.79011 7.66128C6.79222 7.60062 6.7706 7.51754 6.7284 7.47983C5.80216 6.64958 4.87169 5.82435 3.94176 4.99859C3.91908 4.97829 3.89402 4.96088 3.86238 4.93609C3.66405 5.23042 3.46572 5.51947 3.27556 5.8138C3.25499 5.84572 3.2658 5.9135 3.28506 5.95358C3.46334 6.3207 3.6469 6.68519 3.82835 7.05099C3.96629 7.32897 3.86765 7.60325 3.59178 7.71218C3.3051 7.82532 3.04664 7.69161 2.93613 7.41099C2.79635 7.05653 2.62809 6.71341 2.47117 6.3658C2.41341 6.23789 2.3575 6.10866 2.29235 5.98444C2.21508 5.83701 2.22668 5.69407 2.30765 5.55772C2.6418 4.99517 2.97886 4.43446 3.3175 3.87455C3.34862 3.82312 3.39767 3.78277 3.44013 3.73873C3.45517 3.72317 3.47627 3.71341 3.49209 3.69838C4.16778 3.04774 5.03152 2.77714 5.89736 2.51262C6.02976 2.47227 6.12655 2.40343 6.20989 2.29319C6.42747 2.00598 6.65165 1.72378 6.88031 1.44528C7.02273 1.27174 7.21341 1.23191 7.41411 1.31552C7.61983 1.40097 7.7546 1.59481 7.72347 1.80053C7.70844 1.89969 7.66255 2.00466 7.60136 2.08484C7.32681 2.44457 7.0462 2.79983 6.75688 3.14796C6.69068 3.22761 6.58941 3.29117 6.4913 3.32888C6.20989 3.43701 5.92189 3.52774 5.61464 3.63297H5.6149Z" />
      <path d="M5.99919 11.0574C4.55365 11.0574 3.10812 11.0574 1.66258 11.0574C1.60983 11.0574 1.55708 11.0585 1.50434 11.0553C1.24165 11.0392 1.03304 10.8451 1.02935 10.6146C1.02565 10.3844 1.22741 10.1847 1.49062 10.1597C1.53414 10.1554 1.57845 10.157 1.62223 10.157C4.54416 10.157 7.46609 10.157 10.388 10.1578C10.4619 10.1578 10.5384 10.1612 10.6096 10.1792C10.8514 10.2398 10.9938 10.4223 10.9785 10.6405C10.9643 10.8456 10.7789 11.0242 10.5465 11.0521C10.4859 11.0595 10.4236 11.0574 10.3622 11.0574C8.90794 11.0574 7.45343 11.0574 5.99919 11.0574Z" />
      <path d="M2.90148 0.922858C3.53181 0.920748 4.03581 1.41895 4.03819 2.04637C4.04056 2.67459 3.54157 3.18018 2.91441 3.18598C2.29515 3.19152 1.77928 2.68198 1.77348 2.05903C1.76794 1.43794 2.27695 0.924968 2.90148 0.922858Z" />
    </svg>
  );
}

export function Gas({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M14 19H15V21H2V19H3V4C3 3.44772 3.44772 3 4 3H13C13.5523 3 14 3.44772 14 4V12H16C17.1046 12 18 12.8954 18 14V18C18 18.5523 18.4477 19 19 19C19.5523 19 20 18.5523 20 18V11H18C17.4477 11 17 10.5523 17 10V6.41421L15.3431 4.75736L16.7574 3.34315L21.7071 8.29289C21.9024 8.48816 22 8.74408 22 9V18C22 19.6569 20.6569 21 19 21C17.3431 21 16 19.6569 16 18V14H14V19ZM5 19H12V13H5V19ZM5 5V11H12V5H5Z" />
    </svg>
  );
}

export function Tip({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <path d="M12.0049 4.00281C18.08 4.00281 23.0049 6.6891 23.0049 10.0028V14.0028C23.0049 17.3165 18.08 20.0028 12.0049 20.0028C6.03824 20.0028 1.18114 17.4116 1.00957 14.1797L1.00488 14.0028V10.0028C1.00488 6.6891 5.92975 4.00281 12.0049 4.00281ZM12.0049 16.0028C8.28443 16.0028 4.99537 14.9953 3.00466 13.4533L3.00488 14.0028C3.00488 15.885 6.88751 18.0028 12.0049 18.0028C17.0156 18.0028 20.8426 15.9723 20.9999 14.1207L21.0049 14.0028L21.0061 13.4525C19.0155 14.995 15.726 16.0028 12.0049 16.0028ZM12.0049 6.00281C6.88751 6.00281 3.00488 8.12061 3.00488 10.0028C3.00488 11.885 6.88751 14.0028 12.0049 14.0028C17.1223 14.0028 21.0049 11.885 21.0049 10.0028C21.0049 8.12061 17.1223 6.00281 12.0049 6.00281Z" />
    </svg>
  );
}

/**
 * Brand mark used as the token avatar default. Decorative-only — gradient
 * fill ignores the consumer's `color` so the dolphin always renders
 * cyan→violet regardless of theme. Theme tinting still bleeds through via
 * the `.token-avatar::after` overlay.
 */
export function Dolphin({ className, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      style={style}
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient id="listen-dolphin-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#9d5cff" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="10" fill="url(#listen-dolphin-bg)" />
      <path
        d="M10 30c4-2 7-3 10-3 4 0 6 2 10 2s8-4 9-10c-3 4-6 5-9 5-4 0-7-2-11-2-5 0-10 2-13 6 1 .5 2 1 4 2z"
        fill="#0a0c10"
        opacity="0.35"
      />
      <path
        d="M12 32c3-2 6-3 9-3 4 0 7 2 11 1 4-1 7-4 8-9-3 3-5 4-8 4-4 0-7-2-11-2-5 0-10 2-13 7"
        fill="#fff"
      />
      <circle cx="30" cy="22" r="1.2" fill="#0a0c10" />
    </svg>
  );
}
