import {
  MAX_NON_ALPHA_TRACKS,
  type CardSize,
  type DiscoverLayout,
  type SectionId,
} from '@/lib/state/discover-store';
import type { CardVariant, LayoutDescriptor, PanelSizing, ResolvedPanel } from './types';

/** Alpha's default height share relative to a row (rows mode only). */
const ALPHA_ROW_WEIGHT = 1.35;

/**
 * Card zoom for each density preset — the `maxZoom` every `Section` passes to
 * its lane.
 *
 * HERE rather than in `DiscoverPage` because the EVM board reads it too, and a
 * second copy is how one board's "compact" quietly stops matching the other's.
 */
export const CARD_ZOOM_BY_SIZE: Record<CardSize, number> = {
  compact: 0.9,
  default: 1,
  large: 1.18,
  fill: 1.36,
};

/*
 * The names on the column heads. Short, because the head is about 420px
 * wide and the name is the one thing in it that cannot shrink or
 * truncate without costing the reader which lane they are in.
 */
const SECTION_LABEL: Record<SectionId, string> = {
  alpha: 'Alpha',
  'new-pairs': 'New',
  'almost-graduated': 'Soon',
  graduated: 'Graduated',
};

interface ResolveOptions {
  /** Measured by the page: is there vertical room for one more card-row?
   *  Gates the auto second row so it never pushes a section off-screen. */
  extraRowAvailable: boolean;
}

/**
 * Pure: settings (+ a measured room flag) -> a LayoutDescriptor that the dumb
 * components consume. Owns the axis flip, visibility filtering, fixed/flex
 * sizing, the track budget, and the auto-second-row decision.
 */
export function resolveLayout(
  layout: DiscoverLayout,
  { extraRowAvailable }: ResolveOptions,
): LayoutDescriptor {
  const isRows = layout.mode === 'rows';
  const visibleIds = layout.order.filter((id) => layout.visible[id]);
  const nonAlphaCount = visibleIds.filter((id) => id !== 'alpha').length;

  const target = layout.secondRowTarget;
  const grantSecondRow =
    isRows && // the auto second row is a rows-mode behaviour
    layout.autoSecondRow &&
    extraRowAvailable &&
    target !== 'alpha' &&
    layout.visible[target] &&
    nonAlphaCount + 1 <= MAX_NON_ALPHA_TRACKS;

  const panels: ResolvedPanel[] = visibleIds.map((id) => {
    const isAlpha = id === 'alpha';
    // Alpha always renders its own (data-direct) card — its coins aren't in
    // the feed store, so the standard store-subscribed card would be empty.
    // Every section is a flex panel and fit-scales its cards, so Alpha shares
    // space with the rows (its cards scale to fit instead of pinning full and
    // squeezing the rows) and is itself resizable.
    const variant: CardVariant = isAlpha ? 'alpha' : 'standard';
    const sizing: PanelSizing = 'flex';
    const tracks = !isAlpha && grantSecondRow && id === target ? 2 : 1;
    // Default weights: rows mode gives Alpha a bit more height than the rows
    // (its card is richer); a 2-track panel defaults to ~2x; a user-dragged
    // size (stored by id) always wins.
    const base = isAlpha && isRows ? ALPHA_ROW_WEIGHT : 1;
    /*
     * ── COLUMNS ARE ALWAYS EQUAL ─────────────────────────────────────
     *
     * `layout.sizes` is only ever written by a drag on a resize handle,
     * and column mode no longer has one — `PanelStack` stopped rendering
     * handles on the horizontal axis. So any width stored under
     * `sizes.columns` is a leftover from before that, and reading it
     * means a browser that dragged the columns once keeps a lopsided
     * board forever with no way left to straighten it.
     *
     * Ignored outright here rather than migrated away in the store: the
     * value is harmless where it sits, rows mode still reads its own
     * half of the same map, and nothing has to be cleared for a user to
     * get even columns on the next paint.
     */
    const stored = isRows ? layout.sizes[layout.mode][id] : undefined;
    const weight = stored ?? base * tracks;
    return { id, label: SECTION_LABEL[id], variant, sizing, weight, tracks };
  });

  return {
    mode: layout.mode,
    axis: isRows ? 'vertical' : 'horizontal',
    cardFlow: isRows ? 'horizontal' : 'vertical',
    cardSize: layout.cardSize,
    panels,
  };
}
