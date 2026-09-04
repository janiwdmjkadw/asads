import { create } from 'zustand';

/**
 * Trade-page layout: the drag-resizable vertical split between the chart
 * and the trades table (the left column). The right rail — trade panel +
 * analytics — is fixed and not part of this split. Mirrors the
 * persistence pattern of `discover-store.ts` exactly — one versioned
 * object in localStorage, hydrated client-side post-mount so SSR and the
 * first client render agree. The `PanelStack` engine owns the live drag;
 * this store owns the persisted weights.
 *
 * Sizes are keyed by panel id (NOT array index) so the saved split is
 * stable even if the panel set ever changes.
 */
export type TradePanelId = 'chart' | 'table';

export interface TradeLayout {
  /** Resize weights by panel id (percentages summing to ~100 once dragged;
   *  empty until the user drags, when the engine falls back to defaults). */
  sizes: Partial<Record<TradePanelId, number>>;
}

const LAYOUT_KEY = 'trade:layout:v1';

export type TradeLayoutScope = 'solana' | 'evm:bsc' | 'evm:robinhood_chain';

interface LayoutStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function tradeLayoutStorageKey(scope: TradeLayoutScope = 'solana'): string {
  return scope === 'solana' ? LAYOUT_KEY : `${LAYOUT_KEY}:${scope}`;
}

function defaultLayout(): TradeLayout {
  return { sizes: {} };
}

function sanitize(raw: Partial<TradeLayout>, base: TradeLayout): TradeLayout {
  const rawSizes = raw.sizes;
  if (rawSizes === null || typeof rawSizes !== 'object') return base;
  const sizes: Partial<Record<TradePanelId, number>> = {};
  for (const id of ['chart', 'table'] as const) {
    const v = (rawSizes as Record<string, unknown>)[id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100) sizes[id] = v;
  }
  return { sizes };
}

/** Reads the persisted layout. Returns defaults on the server / parse
 *  failure so SSR and the first client render agree (hydrated post-mount). */
export function readTradeLayout(
  scope: TradeLayoutScope = 'solana',
  storage?: LayoutStorage,
): TradeLayout {
  const base = defaultLayout();
  const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
  if (target === null) return base;
  try {
    const raw = target.getItem(tradeLayoutStorageKey(scope));
    if (!raw) return base;
    return sanitize(JSON.parse(raw) as Partial<TradeLayout>, base);
  } catch {
    return base;
  }
}

export function writeTradeLayout(
  layout: TradeLayout,
  scope: TradeLayoutScope = 'solana',
  storage?: LayoutStorage,
): void {
  const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
  if (target === null) return;
  try {
    const safe = sanitize(layout, defaultLayout());
    target.setItem(tradeLayoutStorageKey(scope), JSON.stringify(safe));
  } catch {
    // Local preference only.
  }
}

interface TradeLayoutState {
  layout: TradeLayout;
  /** Replace the layout from persisted storage (client-side, post-mount). */
  hydrateLayout: () => void;
  /** Persist a new split (called on every drag commit). */
  setSizes: (sizes: Partial<Record<TradePanelId, number>>) => void;
  /** Reset the dragged split back to the engine defaults. */
  resetSizes: () => void;
}

export const useTradeLayoutStore = create<TradeLayoutState>((set) => {
  const commit = (layout: TradeLayout) => {
    writeTradeLayout(layout);
    set({ layout });
  };
  return {
    // Default to the empty (defaults) layout so the server and the first
    // client render agree; the page hydrates the persisted value in a
    // layout effect (same pattern as discover-store).
    layout: defaultLayout(),
    hydrateLayout: () => set({ layout: readTradeLayout() }),
    setSizes: (sizes) => commit({ sizes }),
    resetSizes: () => commit(defaultLayout()),
  };
});
