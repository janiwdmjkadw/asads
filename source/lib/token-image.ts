import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Inline SVG placeholder shown when a token has no usable image (or
 * both the primary and fallback sources fail to load). Single source
 * of truth — previously inlined inside `CoinCard.tsx`.
 */
export const TOKEN_IMAGE_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2296%22 height=%2296%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2214%22 fill=%22%23f1f4f3%22/%3E%3Ccircle cx=%2248%22 cy=%2248%22 r=%2223%22 fill=%22none%22 stroke=%22%230b0e14%22 stroke-opacity=%22.22%22 stroke-width=%222%22/%3E%3Cpath d=%22M48 27v42M27 48h42%22 stroke=%22%230b0e14%22 stroke-opacity=%22.28%22 stroke-width=%222%22 stroke-linecap=%22round%22/%3E%3C/svg%3E';

export interface ResolvedTokenImage {
  /** The src to render right now (primary, fallback, or placeholder). */
  src: string;
  /** True when `src` is the synthetic placeholder (no real artwork). */
  isPlaceholder: boolean;
  /** Wire to `<img onError>`; advances primary -> fallback -> placeholder. */
  onError: () => void;
  /** Wire to `<img onLoad>`; arms the painted-src latch (see hook docs). */
  onLoad: () => void;
}

function resolveInitial(
  primarySrc: string | null | undefined,
  fallbackSrc: string | null | undefined,
): string {
  return primarySrc || fallbackSrc || TOKEN_IMAGE_PLACEHOLDER;
}

/**
 * Owns the token-image fallback state machine in one place so a
 * thumbnail and its hover-preview always resolve to the exact same
 * `src` (they never diverge, and a broken primary degrades both in
 * lockstep). Order: `primarySrc` -> `fallbackSrc` -> placeholder.
 *
 * Painted-src latch (`identityKey`): live feed frames UPGRADE a token's
 * image url mid-display (fresh mints stream with only the source url;
 * the daemon mirrors a thumb seconds later and the priority swaps to
 * it). Re-resolving on that churn refetches + refades artwork the user
 * is already looking at — the "image loads twice" flash. So once a real
 * (non-placeholder) src has actually PAINTED (`onLoad` fired) for a
 * given identity, later input changes are ignored. The latch never
 * blocks: placeholder -> real upgrades, fallback-on-error advances,
 * still-loading swaps (faster thumb wins the race), and identity
 * changes (recycled card) all resolve fresh. Callers without an
 * `identityKey` keep the old always-reset behavior.
 */
export function useResolvedTokenImage(
  primarySrc: string | null | undefined,
  fallbackSrc?: string | null,
  identityKey?: string | null,
): ResolvedTokenImage {
  const [src, setSrc] = useState<string>(() =>
    resolveInitial(primarySrc, fallbackSrc),
  );
  const identityRef = useRef(identityKey);
  const paintedSrcRef = useRef<string | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;

  useEffect(() => {
    const sameIdentity = identityRef.current === identityKey;
    if (!sameIdentity) {
      identityRef.current = identityKey;
      paintedSrcRef.current = null;
    }
    const next = resolveInitial(primarySrc, fallbackSrc);
    setSrc((current) => {
      const latched =
        sameIdentity &&
        identityKey != null &&
        paintedSrcRef.current === current &&
        isPreviewableTokenImage(current);
      return latched ? current : next;
    });
  }, [primarySrc, fallbackSrc, identityKey]);

  const onLoad = useCallback(() => {
    paintedSrcRef.current = srcRef.current;
  }, []);

  const onError = useCallback(() => {
    setSrc((current) => {
      if (
        fallbackSrc &&
        current !== fallbackSrc &&
        current !== TOKEN_IMAGE_PLACEHOLDER
      ) {
        return fallbackSrc;
      }
      return current === TOKEN_IMAGE_PLACEHOLDER
        ? current
        : TOKEN_IMAGE_PLACEHOLDER;
    });
  }, [fallbackSrc]);

  return { src, isPlaceholder: src === TOKEN_IMAGE_PLACEHOLDER, onError, onLoad };
}

/**
 * Pure predicate: does this src represent real artwork worth showing
 * in an enlarged preview? Excludes empty strings and the inline-SVG
 * placeholder. Used by `TokenImagePreview` to skip the hover card
 * entirely for placeholder/empty images.
 */
export function isPreviewableTokenImage(src: string | null | undefined): boolean {
  if (!src) return false;
  if (src === TOKEN_IMAGE_PLACEHOLDER) return false;
  return !src.startsWith('data:image/svg+xml');
}
