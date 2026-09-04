'use client';

import { create } from 'zustand';

// Snap/dock state for the wallet-activity + tweet-tracker panels, keyed by
// ROUTE CONTEXT: 'discover' and 'trade' each remember their own layout.
// Clicking into a coin therefore lands with the TRADE context (floating
// bottom-right by default — an instant handoff, nothing recomputed), while
// the Discover snap survives untouched for the return trip. Snapping on
// the trade page persists in ITS context until removed, exactly like
// Discover. Two panels can never hold the same side within one context.
// Each page consumes its own CSS vars (--dock-left-w-<ctx>) so both
// contexts can be written unconditionally without cross-route bleed.

export type DockPanelId = 'wallet' | 'tweets';
export type DockSide = 'left' | 'right';
export type DockContext = 'discover' | 'trade';

const STORAGE_KEY = 'discover:dock:v2';
const LEGACY_KEY = 'discover:dock:v1';

export const DOCK_MIN_WIDTH = 280;
/** Per-panel width ceiling — both panels snapped must leave the page a
 *  usable center column (clamped again against the viewport at read time). */
export const DOCK_MAX_WIDTH = 480;

interface PanelDock {
  side: DockSide | null;
  width: number;
  open: boolean;
}

type ContextPanels = Record<DockPanelId, PanelDock>;
type AllPanels = Record<DockContext, ContextPanels>;

interface DockStore {
  contexts: AllPanels;
  snap: (ctx: DockContext, panel: DockPanelId, side: DockSide) => boolean;
  unsnap: (ctx: DockContext, panel: DockPanelId) => void;
  setWidth: (ctx: DockContext, panel: DockPanelId, width: number) => void;
  setOpen: (ctx: DockContext, panel: DockPanelId, open: boolean) => void;
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return 340;
  const viewportCap =
    typeof window !== 'undefined' ? Math.max(DOCK_MIN_WIDTH, Math.floor(window.innerWidth * 0.32)) : DOCK_MAX_WIDTH;
  return Math.min(DOCK_MAX_WIDTH, viewportCap, Math.max(DOCK_MIN_WIDTH, Math.round(width)));
}

function defaultContext(walletOpen: boolean): ContextPanels {
  return {
    // 400 (was 340) so the ledger's MC column is present by default —
    // below ~340 the row drops it to protect the ticker. Only NEW users
    // see this; a persisted width always wins in `sanitize`.
    wallet: { side: null, width: 400, open: walletOpen },
    tweets: { side: null, width: 360, open: false },
  };
}

function sanitize(raw: unknown, fallback: ContextPanels): ContextPanels {
  const parsed = (raw ?? {}) as Partial<Record<DockPanelId, Partial<PanelDock>>>;
  const load = (id: DockPanelId): PanelDock => ({
    side: parsed[id]?.side === 'left' || parsed[id]?.side === 'right' ? (parsed[id]!.side as DockSide) : null,
    width: clampWidth(typeof parsed[id]?.width === 'number' ? (parsed[id]!.width as number) : fallback[id].width),
    open: typeof parsed[id]?.open === 'boolean' ? (parsed[id]!.open as boolean) : fallback[id].open,
  });
  const panels = { wallet: load('wallet'), tweets: load('tweets') };
  if (panels.wallet.side !== null && panels.wallet.side === panels.tweets.side) {
    panels.tweets.side = null;
  }
  return panels;
}

function readPersisted(): AllPanels {
  const fallback: AllPanels = {
    /*
     * CLOSED BY DEFAULT. The wallet activity dock used to open itself on
     * both pages for every new user, covering the left third of the board
     * before anyone asked for it — and on a fresh account it opens onto
     * "No entries", since nothing is tracked yet.
     *
     * The footer's Activity toggle is one click away, and a persisted
     * `open` always wins in `sanitize`, so anyone who has already opened
     * it keeps it open.
     */
    discover: defaultContext(false),
    trade: defaultContext(false),
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<DockContext, unknown>>;
      return {
        discover: sanitize(parsed.discover, fallback.discover),
        trade: sanitize(parsed.trade, fallback.trade),
      };
    }
    // v1 (pre-context) becomes the Discover layout.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      return {
        discover: sanitize(JSON.parse(legacy), fallback.discover),
        trade: fallback.trade,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function persist(contexts: AllPanels): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(contexts));
  } catch {
    // Best-effort persistence only.
  }
}

function update(
  contexts: AllPanels,
  ctx: DockContext,
  panel: DockPanelId,
  patch: Partial<PanelDock>,
): AllPanels {
  return {
    ...contexts,
    [ctx]: { ...contexts[ctx], [panel]: { ...contexts[ctx][panel], ...patch } },
  };
}

export const useDockStore = create<DockStore>((set, get) => ({
  contexts: readPersisted(),
  snap: (ctx, panel, side) => {
    const { contexts } = get();
    const other: DockPanelId = panel === 'wallet' ? 'tweets' : 'wallet';
    if (contexts[ctx][other].side === side && contexts[ctx][other].open) return false;
    const next = update(contexts, ctx, panel, { side, open: true });
    set({ contexts: next });
    persist(next);
    return true;
  },
  unsnap: (ctx, panel) => {
    const next = update(get().contexts, ctx, panel, { side: null });
    set({ contexts: next });
    persist(next);
  },
  setWidth: (ctx, panel, width) => {
    const next = update(get().contexts, ctx, panel, { width: clampWidth(width) });
    set({ contexts: next });
    persist(next);
  },
  setOpen: (ctx, panel, open) => {
    const { contexts } = get();
    const other: DockPanelId = panel === 'wallet' ? 'tweets' : 'wallet';
    const mine = contexts[ctx][panel];
    const theirs = contexts[ctx][other];
    // Reopen collision: this panel remembers a side the OTHER panel took
    // while it was closed. Snapping over it would stack two docks on one
    // edge — auto-relocate to the free side instead (only two panels
    // exist, so the opposite side is free by construction).
    const patch: Partial<PanelDock> =
      open && mine.side !== null && theirs.side === mine.side && theirs.open
        ? { open, side: mine.side === 'left' ? 'right' : 'left' }
        : { open };
    const next = update(contexts, ctx, panel, patch);
    set({ contexts: next });
    persist(next);
  },
}));
