'use client';

/**
 * The card's non-predicate marks — the four drawings the assembled card
 * needs that the P2 kind set (`kind-glyphs.tsx`) does not carry.
 *
 * The chevron, the arrow and the padlock are lifted from the design lab's
 * `<defs>` block (`tasks/agent-chat/placement-mocks/conditional-card-lab-final.html`,
 * section c1). The other two are NOT:
 *
 * - The SOL mark is the app's own `Solana` glyph, not the lab's drawing.
 *   The lab's was a mock's stand-in and drew a mark the product does not
 *   use anywhere else; SOL is a LOGO, and a logo that changes shape per
 *   surface is not one. It keeps the lab's sizing discipline (.85em, on
 *   the baseline, a hair of air ahead) and gives up the lab's per-context
 *   ink steps, which a brand gradient cannot honour.
 * - The token disc is the REAL coin image, resolved from the mint through
 *   the same proxy + failure ladder as v1's `TokenArt` — one mechanism,
 *   one cache, one placeholder. The lab's lit sphere survives as the
 *   fallback, which is what a mint with no art still gets.
 */

import type { CSSProperties, ReactElement } from 'react';
import { Solana } from '@/components/listen/icons/Icons';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import { ARW, CHEV, LOCK, SOL, TOK } from './card-classes';

/**
 * Riding the numeral: .85em wide, on the baseline, a hair of air ahead.
 *
 * `Solana` marks itself `aria-hidden`; here the mark is often the ONLY
 * statement of the unit (a sentence renders it where `rowText` writes
 * `◎`), so it is re-labelled as the image it is.
 */
export function SolMark({ className }: { readonly className?: string }): ReactElement {
  return (
    <Solana
      className={className ?? SOL}
      role="img"
      aria-label="SOL"
      aria-hidden={undefined}
      data-testid="pcv2-sol-glyph"
    />
  );
}

/**
 * The token disc — the coin's own art at 1.05em, round, ringed.
 *
 * The image proxy needs nothing but the mint, so this asks for no new
 * server payload; `useResolvedTokenImage` owns the failure ladder and
 * the lab's lit sphere stands in the moment it bottoms out. Identity is
 * carried by the symbol beside it, never by the disc alone.
 */
export function TokenDisc({
  mint,
  className,
}: {
  readonly mint?: string | null;
  readonly className?: string;
}): ReactElement {
  const proxySrc = mint === undefined || mint === null ? null : ingestionTokenImageUrl(mint);
  const image = useResolvedTokenImage(proxySrc, null, mint ?? null);
  const base = className ?? TOK;
  if (proxySrc === null || image.isPlaceholder) {
    return <i className={base} aria-hidden data-testid="pcv2-token-disc-fallback" />;
  }
  return (
    <img
      className={`${base} pcv2-tok--art object-cover`}
      src={image.src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={image.onError}
      onLoad={image.onLoad}
      aria-hidden
      data-testid="pcv2-token-disc"
    />
  );
}

const STROKE: CSSProperties = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Details, collapsed — a chevron, pointing at what it opens. */
export function ChevronMark({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg className={className ?? CHEV} viewBox="0 0 12 12" aria-hidden focusable="false">
      <path d="M4.4 2.2 8.2 6l-3.8 3.8" style={STROKE} />
    </svg>
  );
}

/** The live-page arrow. Travels 3px on hover; the row never widens. */
export function ArrowMark({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg className={className ?? ARW} viewBox="0 0 18 12" aria-hidden focusable="false">
      <path d="M1 6h15M11.6 1.6 16.4 6l-4.8 4.4" style={STROKE} />
    </svg>
  );
}

/** Step-up · a padlock drawn on the same 12-unit grid as the P2 marks. */
export function LockMark({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg className={className ?? LOCK} viewBox="0 0 12 12" aria-hidden focusable="false">
      <rect x="2.5" y="5.3" width="7" height="5.2" rx="1.2" />
      <path d="M4.15 5.3V3.75a1.85 1.85 0 0 1 3.7 0V5.3" />
    </svg>
  );
}
