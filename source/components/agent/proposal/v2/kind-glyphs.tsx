/**
 * P2 — the row marker.
 *
 * A 16px rounded-square chip carrying the kind hue at 12% over
 * `--surface-3`, with the glyph at ink-1. Seven marks on ONE 12-unit grid,
 * lifted verbatim from the design lab
 * (`tasks/agent-chat/placement-mocks/conditional-card-lab-final.html`,
 * section c7): market trend, speech bubble, figure, flag, wallet, clock,
 * plus the chain-link used for plan wiring and the dashed empty field for a
 * kind this build does not recognise.
 *
 * Two rules from the lab are load-bearing:
 * - The unrecognised kind is a difference of SHAPE, never of colour: no
 *   tint at all, a dashed hairline field instead.
 * - The rendered stroke is 1.4px. The glyph draws at 11px from a 12-unit
 *   viewBox, so the authored stroke width is 1.527 (1.527 × 11/12 = 1.4).
 *   Do not "tidy" that number — it is the whole discipline.
 *
 * Optical corrections live inside the path geometry (circles overshoot to
 * 10.4u, the figure narrows to 9.5u, every mass centres on 6,6), which is
 * why the coordinates are copied rather than regenerated.
 */

import type { CSSProperties, ReactElement } from 'react';

// ───────────────────────── groups ─────────────────────────

export type GlyphGroup = 'market' | 'social' | 'holder' | 'event' | 'wallet' | 'clock' | 'link' | 'unknown';

/** Kind hue at 12%, from the lab. `unknown` deliberately has none. */
export const GROUP_TINT: Readonly<Record<GlyphGroup, string>> = {
  market: 'hsla(205,58%,64%,.12)',
  social: 'hsla(268,42%,72%,.12)',
  holder: 'hsla(148,38%,58%,.12)',
  event: 'hsla(38,62%,62%,.12)',
  wallet: 'hsla(16,55%,64%,.12)',
  clock: 'hsla(220,12%,62%,.12)',
  link: 'hsla(220,12%,62%,.12)',
  unknown: 'rgba(255,255,255,0)',
};

/** The lab's `aria-label` per mark — the only place kind is ever named. */
export const GROUP_LABEL: Readonly<Record<GlyphGroup, string>> = {
  market: 'Market data',
  social: 'A post and its traction',
  holder: 'Holder analytics',
  event: 'Token lifecycle and metadata',
  wallet: 'The agent wallet',
  clock: 'The clock',
  link: 'Settlement chain',
  unknown: 'A condition type this build does not recognise — shown exactly as the server describes it',
};

/**
 * Leaf kind → mark.
 *
 * `structural` splits on its own check: the three tweet checks are social,
 * the three token checks are lifecycle events. Everything this build cannot
 * place is `unknown`, which is a rendering decision, not an error.
 */
export function glyphGroupFor(kind: string, spec?: unknown): GlyphGroup {
  switch (kind) {
    case 'market':
    case 'guardrail_min_liquidity':
    case 'guardrail_entry_ceiling':
    case 'guardrail_market_threshold':
      return 'market';
    case 'engagement':
      return 'social';
    case 'holder':
      return 'holder';
    case 'portfolio_arm':
    case 'portfolio_fire':
      return 'wallet';
    case 'temporal':
      return 'clock';
    case 'structural': {
      const check =
        typeof spec === 'object' && spec !== null && !Array.isArray(spec)
          ? (spec as Record<string, unknown>)['check']
          : undefined;
      return typeof check === 'string' && check.startsWith('tweet_') ? 'social' : 'event';
    }
    default:
      return 'unknown';
  }
}

// ───────────────────────── the marks ─────────────────────────

/**
 * 11px of drawing inside a 16px chip; stroke 1.527 user units = 1.4px
 * rendered. `butt`/`miter` are the lab's — round joins fattened the marks.
 */
const GLYPH_SVG: CSSProperties = {
  display: 'block',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'butt',
  strokeLinejoin: 'miter',
  strokeMiterlimit: 4,
  strokeWidth: 1.527,
  width: '11px',
  height: '11px',
};

interface GlyphProps {
  /** Overrides the 11px in-chip size; the stroke scales photographically. */
  readonly size?: number;
}

function glyph(group: GlyphGroup, body: ReactElement, size?: number): ReactElement {
  const style: CSSProperties =
    size === undefined
      ? GLYPH_SVG
      : { ...GLYPH_SVG, width: `${size}px`, height: `${size}px`, strokeWidth: (1.4 * 12) / size };
  return (
    <svg viewBox="0 0 12 12" role="img" aria-label={GROUP_LABEL[group]} style={style}>
      {body}
    </svg>
  );
}

/** market · a trend and its corner. Visual box x 0.75–11.15, centre (5.95,6). */
export function MarketGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'market',
    <>
      <path d="M1.4 8.85 4.9 4.85 7.2 7.15 10.5 3.15" />
      <path d="M8 3.15H10.5V5.65" />
    </>,
    size,
  );
}

/** social · a bubble with a mitred tail; body 10u wide, tail to 10.9. */
export function SocialGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'social',
    <>
      <rect x="1.65" y="1.9" width="8.7" height="6.5" rx="2" />
      <path d="M4.1 8.4V10.9L6.6 8.4" />
    </>,
    size,
  );
}

/** holder · one figure; shoulders 9.5u so a tall shape does not read wide. */
export function HolderGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'holder',
    <>
      <circle cx="6" cy="3.3" r="1.8" />
      <path d="M1.9 10.6C1.9 8.35 3.7 7.6 6 7.6S10.1 8.35 10.1 10.6" />
    </>,
    size,
  );
}

/** event · a flag; the pole is the only full-height stroke in the set. */
export function EventGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'event',
    <>
      <path d="M2.9 1.35V10.9" />
      <path d="M2.9 2.55H10.2L8.5 5.05 10.2 7.55H2.9" />
    </>,
    size,
  );
}

/** wallet · the clasp is an OPEN pocket; closing it read as a blob. */
export function WalletGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'wallet',
    <>
      <rect x="1.65" y="2.95" width="8.7" height="6.1" rx="1.5" />
      <path d="M10.35 5.55H8.25a0.9 0.9 0 0 0 0 1.8h2.1" />
    </>,
    size,
  );
}

/** clock · circle overshoots to 10.4u visual; hands mitre at a right angle. */
export function ClockGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'clock',
    <>
      <circle cx="6" cy="6" r="4.55" />
      <path d="M6 3.2V6H8.4" />
    </>,
    size,
  );
}

/** link · plan wiring (settlement chain), from lab section c1. */
export function LinkGlyph({ size }: GlyphProps): ReactElement {
  return glyph(
    'link',
    <>
      <path d="M5.1 3.7H3.7a2.3 2.3 0 0 0 0 4.6H5.1" />
      <path d="M6.9 3.7H8.3a2.3 2.3 0 0 1 0 4.6H6.9" />
      <path d="M4.7 6H7.3" />
    </>,
    size,
  );
}

/** unknown · an empty dashed field. A difference of SHAPE, never colour. */
export function UnknownGlyph({ size }: GlyphProps): ReactElement {
  return glyph('unknown', <rect x="1.7" y="1.7" width="8.6" height="8.6" rx="2.2" strokeDasharray="2.15 2.15" />, size);
}

const GLYPHS: Readonly<Record<GlyphGroup, (props: GlyphProps) => ReactElement>> = {
  market: MarketGlyph,
  social: SocialGlyph,
  holder: HolderGlyph,
  event: EventGlyph,
  wallet: WalletGlyph,
  clock: ClockGlyph,
  link: LinkGlyph,
  unknown: UnknownGlyph,
};

// ───────────────────────── the chip ─────────────────────────

export interface KindChipProps {
  readonly group: GlyphGroup;
  /** Chip edge in px. Defaults to the card's 16. The drawing scales with it. */
  readonly size?: number;
}

/**
 * The duotone chip. The tint is a flat layer over `--surface-3` rather than
 * a background-colour blend, so the 12% stays 12% whatever the surface ramp
 * does underneath it. The unrecognised kind takes an inset hairline instead.
 */
export function KindChip({ group, size = 16 }: KindChipProps): ReactElement {
  const scale = size / 16;
  const raw = group === 'unknown';
  const style: CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${5 * scale}px`,
    color: raw ? 'var(--ink-3)' : 'var(--ink-1)',
    ...(raw
      ? { background: 'none', boxShadow: `inset 0 0 0 ${scale}px rgba(255,255,255,.14)` }
      : {
          background: `linear-gradient(0deg,${GROUP_TINT[group]},${GROUP_TINT[group]}),var(--surface-3)`,
        }),
  };
  const Glyph = GLYPHS[group];
  return (
    <span style={style} data-kind-group={group}>
      <Glyph size={11 * scale} />
    </span>
  );
}
