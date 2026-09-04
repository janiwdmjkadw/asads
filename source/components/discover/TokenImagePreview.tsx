'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { isPreviewableTokenImage } from '@/lib/token-image';
import { createBoundedUrlSet } from './boundedUrlSet';
import { isFeedScrollActive } from './feedNavigationPause';

interface Props {
  /**
   * The thumbnail's resolved src (after the `useResolvedTokenImage`
   * fallback chain). Painted instantly as the preview's base layer
   * (already cached from the thumbnail), and used as the final image
   * when no higher-res `previewSrc` is supplied.
   */
  src: string;
  /**
   * Optional higher-resolution artwork for the enlarged preview. Card
   * thumbnails are intentionally small (fast list render); when a
   * larger CDN/source rendition exists, pass it here so the ~192px
   * preview is never an upscaled thumbnail. It fades in over the
   * cached thumbnail once loaded, and is prefetched on hover intent so
   * it is usually ready by the time the card opens.
   */
  previewSrc?: string | null;
  alt: string;
  /**
   * The existing thumbnail markup. Rendered as the hover trigger via
   * `asChild`, so no extra DOM node is introduced and the caller's
   * click / keyboard navigation keeps bubbling unchanged.
   */
  children: ReactNode;
  /**
   * Escape hatch for callers whose own state says there is nothing to
   * preview (e.g. the Trade header showing its Dolphin glyph). When
   * true — or when `src` is empty / the placeholder — the children are
   * returned bare with zero hover-card overhead.
   */
  disabled?: boolean;
}

const PREVIEW_PX = 192;
// Snappy but still intent-gated. The image itself no longer waits on
// this delay because we prefetch on pointer-enter (below).
const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 80;

/**
 * Bounded LRU of high-res URLs already warmed into the browser image cache.
 * Module-scoped so repeated hovers over the same card don't re-issue
 * `Image()` loads, and capped so a long session over a churning feed can't let
 * full-res hover images accumulate without limit -- evicting a URL only means
 * a later re-hover re-prefetches it (still fast; the bytes are usually still in
 * the HTTP cache).
 */
const PREFETCH_LRU_LIMIT = 40;
const prefetched = createBoundedUrlSet(PREFETCH_LRU_LIMIT);

/**
 * Kick a high-res image into the browser cache ahead of render. Called
 * on hover intent so the bytes are in flight before `HoverCardContent`
 * mounts — the later `<img>` then reuses the same cached response.
 */
function prefetchImage(url: string): void {
  if (typeof window === 'undefined') return;
  if (!prefetched.add(url)) return; // already warm (and now marked most-recent)
  const img = new window.Image();
  img.decoding = 'async';
  // `fetchPriority` is honored by modern Chromium/Safari, ignored else.
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high';
  img.src = url;
}

function composePointerEnter(
  theirs: ((e: ReactPointerEvent) => void) | undefined,
  ours: (e: ReactPointerEvent) => void,
): (e: ReactPointerEvent) => void {
  return (e) => {
    theirs?.(e);
    ours(e);
  };
}

/**
 * Wraps a square token thumbnail so hovering pops out an enlarged
 * ~192x192 preview anchored to it. Used by Discover cards and the
 * Trade header.
 *
 * Instant-feel: the cached thumbnail (`src`) paints immediately as the
 * base layer, and a high-res `previewSrc` (prefetched on hover intent)
 * fades in on top once decoded — so the preview is never blank and
 * still sharpens to full quality.
 *
 * Performance: `HoverCardContent` mounts lazily (only while open) and
 * the high-res fetch is intent-gated, so a full Discover list adds zero
 * render-time DOM/JS or network for this feature until a real hover.
 * Open state lives inside the Radix portal, so parent cards never
 * re-render on hover.
 */
export function TokenImagePreview({ src, previewSrc, alt, children, disabled = false }: Props) {
  const [highResFailed, setHighResFailed] = useState(false);
  const [highResLoaded, setHighResLoaded] = useState(false);

  // A failed/loaded result belongs to one URL — when the card's artwork
  // updates, give the new rendition a fresh chance instead of keeping the
  // overlay permanently disabled.
  useEffect(() => {
    setHighResFailed(false);
    setHighResLoaded(false);
  }, [previewSrc]);

  const wantsHighRes =
    !highResFailed && isPreviewableTokenImage(previewSrc) && previewSrc !== src;
  const highResUrl = wantsHighRes ? (previewSrc as string) : null;

  const onPointerEnter = useCallback((event: ReactPointerEvent) => {
    // Scroll guard (same rule as the card's prewarm heartbeat): thumbnails
    // sweeping under a stationary cursor during a lane scroll fire
    // pointerEnter per card — each an unrelated full-res fetch + decode on
    // the scroll frames, churning the prefetch LRU. Deliberate hovers that
    // began mid-scroll still warm via the open catch-up below.
    if (isFeedScrollActive()) {
      // HoverCardTrigger composes the child's handler before its own and
      // honors defaultPrevented, so Radix cannot start a new open timer as
      // cards sweep beneath a stationary pointer.
      event.preventDefault();
      return;
    }
    if (highResUrl) prefetchImage(highResUrl);
  }, [highResUrl]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      // Catch-up for a pointerEnter skipped by the scroll guard (the cursor
      // settling on a card fires no second enter). Idempotent via the LRU;
      // the content <img> below reuses the same in-flight response.
      if (open && highResUrl) prefetchImage(highResUrl);
    },
    [highResUrl],
  );

  if (disabled || !isPreviewableTokenImage(src)) {
    return <>{children}</>;
  }

  // Attach the prefetch to the trigger element itself (no wrapper DOM),
  // composing with any pointer-enter the caller already set.
  const trigger = isValidElement(children) ? (
    cloneElement(children as ReactElement<{ onPointerEnter?: (e: ReactPointerEvent) => void }>, {
      onPointerEnter: composePointerEnter(
        (children as ReactElement<{ onPointerEnter?: (e: ReactPointerEvent) => void }>).props
          .onPointerEnter,
        onPointerEnter,
      ),
    })
  ) : (
    <>{children}</>
  );

  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} onOpenChange={onOpenChange}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent
        data-token-image-preview=""
        side="right"
        align="start"
        sideOffset={10}
        /* Tight padding + theme surface; the image is the content. */
        className="w-auto p-1.5"
      >
        <div
          className="relative overflow-hidden rounded-md"
          style={{
            width: PREVIEW_PX,
            height: PREVIEW_PX,
            background: 'var(--surface-3)',
          }}
        >
          {/* Base layer: the cached thumbnail. Paints instantly (already
              fetched for the 68px card image), so the preview is never
              blank while the high-res rendition loads. */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="absolute inset-0 block h-full w-full object-cover"
          />
          {/* High-res overlay: fades in over the thumbnail once decoded.
              Plain <img> (not next/image) so it reuses the raw bytes we
              prefetched on hover intent — no extra optimized fetch or
              remote-host allowlist. On error it unmounts, leaving the
              thumbnail base visible. */}
          {highResUrl ? (
            <img
              key={highResUrl}
              src={highResUrl}
              alt=""
              aria-hidden
              draggable={false}
              decoding="async"
              onLoad={() => setHighResLoaded(true)}
              onError={() => setHighResFailed(true)}
              className="absolute inset-0 block h-full w-full object-cover transition-opacity duration-150 ease-out"
              style={{ opacity: highResLoaded ? 1 : 0 }}
            />
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
