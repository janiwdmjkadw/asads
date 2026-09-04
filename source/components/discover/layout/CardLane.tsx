'use client';

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
  type WheelEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { noteFeedScrollActivity } from '../feedNavigationPause';
import { noteLaneScrollActivity } from '../laneScrollDamper';
import { laneWillConsumeWheel } from '../laneWheelIntent';
import { useHorizontalWheel } from '../useHorizontalWheel';
import { CardVisibilityContext } from './cardVisibility';
import {
  createLaneVisibilityRegistry,
  type LaneVisibilityRegistry,
} from './laneVisibilityRegistry';
import type { Axis, CardVariant } from './types';
import { laneSlotKey, laneVisibilityRootMargin } from './visibilityGeometry';

/** Floor so cards stay legible even on very short panels. */
const MIN_FIT_ZOOM = 0.5;

/** Slots register through context so the observer (created in the lane's
 *  effect, after the scroll root exists) can be wired up after child mount. */
const LaneVisibilityContext = createContext<LaneVisibilityRegistry | null>(null);

/** Module-scope (stable identity) scroll handler: pauses feed application
 *  for the trailing window AND marks the lane so `discover.css` pins hover
 *  chrome to its idle values while cards sweep under the cursor. */
function onLaneScroll(e: UIEvent<HTMLDivElement>): void {
  noteFeedScrollActivity();
  noteLaneScrollActivity(e.currentTarget);
  // A HoverCard delay begun before scrolling is not cancelled merely by
  // changing hit-testing under a stationary pointer. Leave the actual trigger
  // now; TokenImagePreview rejects new enters while the guard is active.
  if (e.target instanceof Element) {
    e.target
      .closest('.token-preview-trigger')
      ?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
  }
}

/** Mark visual scroll intent before the browser applies a native vertical
 * wheel step. `scroll` remains the fallback for keyboard/touch/programmatic
 * movement, but it arrives after the first frame has already moved. */
function onLaneWheelCapture(e: WheelEvent<HTMLDivElement>, cardFlow: Axis): void {
  if (!laneWillConsumeWheel(e.currentTarget, cardFlow, e)) return;
  noteFeedScrollActivity();
  noteLaneScrollActivity(e.currentTarget);
}

interface CardLaneProps<T> {
  /** Card flow axis (perpendicular to the stack). */
  cardFlow: Axis;
  variant: CardVariant;
  /** Card-row tracks (1 or 2). 2 only applies to horizontal flow. */
  tracks: number;
  /** Fill the panel height (flex sections) vs natural height. */
  fill: boolean;
  /** Max card zoom (the active size preset). HORIZONTAL flow only: cards scale
   *  to fit a single row but never exceed this. Column cards instead take the
   *  preset zoom directly (cascaded via `data-card-size` -> `--card-zoom`). */
  maxZoom: number;
  /** Unzoomed card height for this variant (regular 112 / alpha 192). */
  cardBaseHeight: number;
  items: T[];
  getKey: (item: T, index: number) => string;
  renderCard: (item: T, index: number) => ReactNode;
}

/**
 * Lays cards out perpendicular to the stack axis, `tracks` deep, and scrolls
 * internally along the flow. Horizontal flow = a carousel (wheel-to-scroll);
 * vertical flow = an internally-scrolling column. Slot width policy follows
 * the flow + variant. The card itself is dumb.
 *
 * Memoized (see export below): DiscoverPage re-renders on every committed
 * feed tick, but a content-only tick keeps `items` (the stable row-key
 * order slice), `getKey`, and `renderCard` reference-identical — so the
 * whole 50-slot lane skips its render AND React's child reconciliation.
 * Changed cards still repaint through their own `useDiscoverCoin`
 * subscription. The lane re-renders only when the row order/membership
 * changes or a flash set swaps `renderCard`.
 */
function CardLaneImpl<T>({
  cardFlow,
  variant,
  tracks,
  fill,
  maxZoom,
  cardBaseHeight,
  items,
  getKey,
  renderCard,
}: CardLaneProps<T>) {
  const flowHorizontal = cardFlow === 'horizontal';
  const scrollRef = useHorizontalWheel<HTMLDivElement>(flowHorizontal);
  const twoRow = flowHorizontal && tracks >= 2;

  // One IntersectionObserver per lane, rooted at the scroll container so that
  // cards scrolled out of a HORIZONTAL carousel (still within the page
  // viewport) are correctly detected as off-screen. The pure registry handles
  // the element->callback bookkeeping and queues slots that register before the
  // observer is attached (children mount before this effect runs).
  const registryRef = useRef<LaneVisibilityRegistry | null>(null);
  if (registryRef.current === null) registryRef.current = createLaneVisibilityRegistry();
  const registry = registryRef.current;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => registry.handleEntries(entries), {
      root,
      rootMargin: laneVisibilityRootMargin(cardFlow),
    });
    registry.setObserver(observer);
    return () => {
      observer.disconnect();
      registry.setObserver(null);
    };
  }, [cardFlow, scrollRef, registry]);

  /* Fluid fit (horizontal carousels only): scale the cards so a single row
     exactly fits the lane height, capped at `maxZoom`. Small panels -> smaller
     cards (everything stays visible, never clipped); larger panels -> cards
     grow up to the cap. */
  const fluid = flowHorizontal && !twoRow;
  /* Column cards take the preset zoom directly, but CAPPED AT 1: a column card
     already spans the full column width, so it can only ever scale DOWN (and
     centers) — never wider than the column, so the full card is always shown,
     never clipped. The size preset therefore only thins the column (compact =
     smaller cards / more rows); it can't blow them past the column edge. */
  const columnZoom = flowHorizontal ? null : Math.min(maxZoom, 1);
  const [fitZoom, setFitZoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!fluid) {
      setFitZoom(null);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      if (h <= 0) return;
      const z = Math.min(maxZoom, (h - 6) / cardBaseHeight);
      let clamped = Math.max(MIN_FIT_ZOOM, Math.round(z * 100) / 100);
      // Snap just-above-1 fits DOWN to exactly 1: a fractional zoom like 1.04
      // puts every glyph and the token thumbnail on a fractional pixel grid,
      // which visibly softens cards on 1x (non-Retina) displays for no real
      // gain in size. Shrink-only, so the fit guarantee (never clip) holds;
      // sub-1 fits stay fractional because rounding them up would clip.
      if (clamped > 1 && clamped <= 1.05) clamped = 1;
      setFitZoom((prev) => (prev === clamped ? prev : clamped));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fluid, maxZoom, cardBaseHeight, scrollRef]);
  const slotClass = cn(
    'shrink-0',
    flowHorizontal
      ? variant === 'alpha'
        ? 'discover-card-zoom w-[var(--card-min-alpha)]'
        : 'discover-card-zoom w-[var(--card-min)]'
      : // Column slot: full-width, zoom-scaled (no width compensation, so it is
        // never laid out wider than the column and can't be clipped).
        'discover-card-zoom w-full',
  );

  return (
    <LaneVisibilityContext.Provider value={registry}>
      <div
        ref={scrollRef}
        // Active scrolling pauses feed APPLICATION (store ingest + card
        // re-renders were the dominant scroll frame-drop source); frames
        // keep patching the delta base and a trailing flush catches up
        // ~250ms after the last scroll event. It also damps hover chrome
        // for the same window (laneScrollDamper). React's scroll listener
        // is passive, so this adds nothing to the scroll's critical path.
        onScroll={onLaneScroll}
        onWheelCapture={(event) => onLaneWheelCapture(event, cardFlow)}
        className={cn(
          'scroll-hide relative z-[1] -mx-1 flex items-center px-1 pb-[4px]',
          fill && 'min-h-0 flex-1',
          // Lanes read as one continuous grid (Axiom-style): cards nearly
          // touch on a 2px seam in BOTH flows — row carousels dropped their
          // 8px gap to match the column treatment (the freed width feeds
          // the cards). Alpha keeps a slightly wider 4px seam: its cards
          // are bigger, and a 2px seam between them reads as a rendering
          // glitch rather than a gutter. In 2-row mode the same gap is the
          // grid's row gap, so the two carousel rows tighten in step.
          flowHorizontal ? (variant === 'alpha' ? 'gap-[4px]' : 'gap-[2px]') : 'gap-[2px]',
          flowHorizontal
            ? 'discover-card-lane--horizontal flex-row overflow-x-auto overflow-y-hidden'
            : 'discover-card-lane--vertical flex-col overflow-y-auto overflow-x-hidden',
          twoRow && 'discover-feed-scroller--2row',
        )}
        // Horizontal lanes fluid-fit (fitZoom); column lanes take the capped
        // preset zoom. Either overrides the cascaded `data-card-size` zoom.
        style={
          (fitZoom ?? columnZoom) != null
            ? ({ '--card-zoom': fitZoom ?? columnZoom } as CSSProperties)
            : undefined
        }
      >
        {items.map((item, i) => (
          <LaneSlot
            key={laneSlotKey(cardFlow, getKey(item, i))}
            className={cn(
              slotClass,
              'discover-card-slot',
              variant === 'alpha' && 'discover-card-slot--alpha',
            )}
          >
            {renderCard(item, i)}
          </LaneSlot>
        ))}
      </div>
    </LaneVisibilityContext.Provider>
  );
}

// `memo` on a generic component erases the type parameter; the cast keeps
// the generic call signature for consumers.
export const CardLane = memo(CardLaneImpl) as typeof CardLaneImpl;

/**
 * A single card slot. Observes its own viewport visibility via the lane's
 * shared observer and provides it to the card subtree through
 * `CardVisibilityContext`. The slot element itself is never unmounted or
 * hidden (so scrolling stays smooth and `content-visibility` reserves its
 * space); only the card's feed subscription pauses while off-screen.
 */
function LaneSlot({ className, children }: { className: string; children: ReactNode }) {
  const registry = useContext(LaneVisibilityContext);
  const ref = useRef<HTMLDivElement>(null);
  // Default live: a card is never frozen before the observer has reported, so
  // the first paint is correct and there is no flash.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !registry) return;
    return registry.register(el, setVisible);
  }, [registry]);
  return (
    <div ref={ref} className={className}>
      <CardVisibilityContext.Provider value={visible}>{children}</CardVisibilityContext.Provider>
    </div>
  );
}
