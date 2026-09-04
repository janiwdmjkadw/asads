'use client';

import { create } from 'zustand';

// Global activity store for orders the user initiates on this tab.
// `<TradeActivityProvider />` opens a single SSE subscription to
// `/api/v1/trade/stream`, and pipes events through `applyEvent` so any
// caller that pushed a pending toast (e.g. CoinCard Quickbuy) gets
// the full lifecycle visualised at the top of the screen.
//
// Design points:
//   - we ONLY track orders that THIS tab initiated. The SSE feed is
//     not user-scoped (it's open behind the edge), so unrelated events
//     are filtered out by clientOrderId.
//   - the renderer is mounted globally in `<TerminalShell />`, so
//     Discover quickbuys still show progress after the user
//     navigates to a Trade page mid-flight.
//   - state is a flat array of toasts keyed by clientOrderId; a
//     secondary `keyToClientId` index translates engine-side
//     `OrderKey` (the only handle non-accepted events carry) back
//     to our pending toast.

export type TradeActivityPhase =
  | 'pending'      // we called submitOrder, waiting on api/ ACK + engine accepted SSE
  | 'submitted'    // tx hit the wire (engine emitted 'submitted')
  | 'confirmed'    // landed on a slot on-chain — terminal user-facing success
  | 'error';
//
// NOTE: there is intentionally no user-facing `filled` phase. The engine
// still emits `fill_pending` / `filled` / `partial`, but those represent
// internal fill-parse + balance/DB bookkeeping the user doesn't need to
// see. We process them (for the optimistic balance floor) yet never
// advance the toast past `confirmed`.

export type TradeActivitySide = 'buy' | 'sell';

/**
 * Server-originated advanced-order suborders (DCA/limit engine) carry
 * `adv-`-prefixed client_order_ids (manual UI orders use `ui-`, advanced
 * order CREATION idempotency keys use `advc-`). The `adv:` variant is
 * accepted defensively — the plan's deterministic leg-id derivation uses
 * that spelling as the hash input.
 */
export function isAdvancedClientOrderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && (id.startsWith('adv-') || id.startsWith('adv:'));
}

export interface TradeActivityItem {
  readonly id: string;        // clientOrderId (canonical key)
  readonly mint: string;
  readonly ticker: string;
  readonly side: TradeActivitySide;
  readonly solAmount: number | null;
  readonly phase: TradeActivityPhase;
  /**
   * Present on toasts for AUTOMATED suborder fills (advanced orders).
   * These are born in `confirmed` — never pending/submitted — and render
   * as "DCA buy confirmed — 0.98 SOL → 1.2M SYM".
   */
  readonly automated?: { readonly kindLabel: string; readonly amountsLabel: string } | undefined;
  readonly signature?: string | undefined;
  readonly error?: string | undefined;
  readonly orderKey?: string | undefined; // "seq:tsMs"
  readonly walletAccountId?: string | null;
  /**
   * Cold-load fallback flag: set when the toast has sat in `pending`
   * well past the normal ack window with no order SSE event attributed
   * to it (stream not connected / connected late) and the one-shot
   * status reconciliation couldn't resolve a terminal state either.
   * The renderer escalates the copy to "still working — check
   * positions"; the toast stays dismissible as always.
   */
  readonly stalled?: boolean;
  /** EVM receipt inclusion is useful progress, but not canonical finality. */
  readonly evmFinality?: 'finalizing' | 'reorged';
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TradeOrderKey {
  readonly seq: string;
  readonly tsMs: number;
}

// Minimal projection of `TradeOrderEvent` from useTradeStream.ts. We
// duplicate the shape here so the store doesn't pull a UI component
// import path; the SSE provider does the field extraction.
export interface IncomingOrderEvent {
  readonly kind:
    | 'accepted'
    | 'resolved'
    | 'submitted'
    | 'confirmed'
    | 'fill_pending'
    | 'filled'
    | 'partial'
    | 'fill_committed'
    | 'failed'
    | 'cancelled';
  readonly key: TradeOrderKey;
  readonly clientOrderId?: string;
  readonly signature?: string;
  readonly errorKind?: string;
  readonly cancelReason?: string;
  /** Present on `fill_committed`: the fill's mint (no `fill` payload). */
  readonly mint?: string;
  /** Present on `filled`/`partial`: the exact on-chain delta. */
  readonly fill?: {
    readonly mint: string;
    readonly tokenDelta: string; // signed decimal base units
    readonly solDelta: string; // signed decimal lamports, all-in
    readonly signature: string;
    readonly side: TradeActivitySide;
  };
  /**
   * Pre-rendered display strings for an automated (advanced-order) fill
   * toast, computed by the SSE provider (which owns symbol resolution)
   * so this store stays dependency-free. Only consumed when the order's
   * client id is `adv-`-prefixed.
   */
  readonly fillDisplay?: {
    readonly kindLabel: string;
    readonly amountsLabel: string;
    readonly ticker: string;
  };
  /** Full wire event, preserved for TradePanel/useTradeStream consumers. */
  readonly raw?: unknown;
}

interface PushPendingInput {
  id: string;
  mint: string;
  ticker: string;
  side: TradeActivitySide;
  solAmount: number | null;
  walletAccountId?: string | null;
}

/**
 * Shared, wallet-scoped optimistic token-balance floor. A confirmed
 * BUY fill writes the bought base units here keyed by
 * `${walletAccountId}|${mint}`, so a page that mounts cold (e.g. the
 * trade page opened right after a Discover quickbuy) can show the
 * just-bought tokens immediately instead of `0` while the chain
 * balance poll catches up. Consumers: display balances
 * (`mergeDisplayBalance`), and the multi-wallet SELL HINT path
 * (`mergeSellHintsWithFloors` / `filterSellableWalletIds`) — the hint is
 * safe to raise because a floor only ever reflects tokens a CONFIRMED
 * fill already landed on-chain, and the engine's own authoritative
 * balance read still bounds actual sell sizing, so an optimistic floor
 * can never cause an oversell.
 */
export interface OptimisticBalanceEntry {
  readonly tokens: string; // decimal base units
  readonly updatedAt: number;
}

const OPTIMISTIC_TTL_MS = 60_000;

/**
 * Optimistic ledger deltas: the SSE `filled`/`partial` events carry the
 * exact all-in fill (`solDelta` lamports, `tokenDelta` base units) that the
 * server later persists into `trading.fills`. That persist is async, so a
 * ledger refetch fired on the fill event can race the DB commit and show a
 * stale BOUGHT/SOLD strip. Each fill is parked here (keyed
 * `${seq}:${tsMs}:${signature}` — one entry per on-chain fill, so a
 * partial→filled overwrite is idempotent) until the server ledger reflects
 * it, letting `useTradeLedger` overlay the delta in the meantime.
 * Display-only — sell sizing never reads this.
 */
export interface PendingLedgerFill {
  readonly walletAccountId: string | null;
  readonly mint: string;
  readonly side: TradeActivitySide;
  readonly solDeltaLamports: string; // signed decimal lamports (buys negative)
  readonly tokenDelta: string; // signed decimal base units
  readonly receivedAtMs: number;
}

export const PENDING_LEDGER_TTL_MS = 30_000;

export function optimisticBalanceKey(walletAccountId: string | null | undefined, mint: string): string {
  return `${walletAccountId ?? 'primary'}|${mint}`;
}

/**
 * Pure reader: returns the optimistic floor base units for
 * `(walletAccountId, mint)` when present and within TTL, else null.
 * Exported so components can subscribe to the map and derive without
 * an imperative store call.
 */
export function readOptimisticBalance(
  map: ReadonlyMap<string, OptimisticBalanceEntry>,
  walletAccountId: string | null | undefined,
  mint: string,
  now: number = Date.now(),
): string | null {
  const entry = map.get(optimisticBalanceKey(walletAccountId, mint));
  if (!entry) return null;
  if (now - entry.updatedAt > OPTIMISTIC_TTL_MS) return null;
  return entry.tokens;
}

function maxDecimal(a: string, b: string): string {
  try {
    return BigInt(a) >= BigInt(b) ? a : b;
  } catch {
    return a;
  }
}

function addDecimal(a: string, b: string): string {
  try {
    const sum = BigInt(a) + BigInt(b);
    return (sum > 0n ? sum : 0n).toString(10);
  } catch {
    return a;
  }
}

interface State {
  toasts: TradeActivityItem[];
  /** Raw order events for this tab's orders, newest retained to a bounded ring. */
  orderEvents: unknown[];
  lastOrderEvent: unknown | null;
  streamConnected: boolean;
  /**
   * Bumped once per SSE event attributed to an ADVANCED order (`adv-`
   * client ids): accepted / filled / partial / fill_committed / failed /
   * cancelled. The Orders-tab hook subscribes and refetches the list so
   * progress updates land instantly after each automated fill instead of
   * waiting for the 5s poll.
   */
  advancedActivityVersion: number;
  /** clientOrderId → most recent server-side OrderKey ("seq:tsMs"). */
  keyToClientId: Map<string, string>;
  /** clientOrderId → submit-time context for fill attribution. */
  orderContext: Map<string, { walletAccountId: string | null; mint: string }>;
  /** `${walletAccountId}|${mint}` → optimistic balance floor. */
  optimisticBalances: Map<string, OptimisticBalanceEntry>;
  /** `${seq}:${tsMs}:${signature}` → fill delta awaiting the server ledger. */
  pendingLedgerFills: Map<string, PendingLedgerFill>;
  pushPending(input: PushPendingInput): void;
  /**
   * Register an order's wallet+mint without creating a visible toast.
   * Used by trade-page submit sites (which manage their own status UI)
   * so a later `filled` SSE event can be attributed to the right
   * wallet for the optimistic balance floor.
   */
  registerOrderContext(clientOrderId: string, walletAccountId: string | null, mint: string): void;
  /**
   * Register the engine OrderKey → clientOrderId mapping from the submit
   * POST's ack (which returns `order_seq`/`ts_ms` synchronously). Without
   * this, correlation depended entirely on the SSE `accepted` frame — if
   * that frame landed in a reconnect gap (or the stream connected just
   * after it fired), every later `submitted`/`confirmed`/`failed` event
   * was dropped and the toast sat on "sending…" forever.
   */
  registerOrderKey(clientOrderId: string, key: TradeOrderKey): void;
  markError(clientOrderId: string, error: string): void;
  /**
   * Advance a toast to the terminal `confirmed` phase from a source
   * OTHER than the order SSE — the one-shot status reconciliation a
   * stuck `pending` toast fires when the stream connected too late
   * (cold load) to deliver the order's lifecycle events. Only
   * in-flight toasts advance; an already-terminal toast is left
   * untouched so a late SSE replay can't regress it.
   */
  markConfirmed(clientOrderId: string, signature?: string): void;
  /** Mark an EVM receipt included while retaining duplicate suppression/recovery. */
  markEvmFinalizing(clientOrderId: string): void;
  /** The included receipt was retracted; reconciliation remains live. */
  markEvmReorged(clientOrderId: string): void;
  /** Escalate a still-`pending` toast's copy after the stall window. No-op otherwise. */
  markStalled(clientOrderId: string): void;
  applyOrderEvent(event: IncomingOrderEvent): void;
  setStreamConnected(connected: boolean): void;
  /**
   * Drop the optimistic floor once the chain-backed balance has caught
   * up to (or exceeded) it. Called by the balance poll consumers.
   */
  reconcileOptimisticBalance(
    walletAccountId: string | null,
    mint: string,
    chainTokens: string | null,
  ): void;
  /**
   * Stamp balance floors after a CONFIRMED wallet-to-wallet token
   * transfer (split/aggregate). Receivers get their exact post-transfer
   * balance as a floor (tokens are on-chain; the poll just hasn't
   * caught up); senders get their stale buy floor DELETED so a drained
   * wallet can't keep advertising a balance it no longer holds.
   * `floorTokens: null` deletes the entry.
   */
  applyTransferBalanceFloors(
    entries: ReadonlyArray<{
      walletAccountId: string;
      mint: string;
      floorTokens: string | null;
    }>,
  ): void;
  /**
   * Drop pending ledger deltas once the server ledger reflects them
   * (called by `useTradeLedger`'s reconcile effect).
   */
  clearPendingLedgerFills(keys: ReadonlyArray<string>): void;
  dismiss(clientOrderId: string): void;
}

const MAX_TOASTS = 24;
const MAX_ORDER_EVENTS = 250;
/**
 * FIFO cap on the order-correlation maps. Late events (`resolved` after
 * `filled`, duplicate terminal events on reconnect) can still reference an
 * order after its terminal phase, so instead of deleting on terminal we
 * retain the most recent N entries — a session would need 500+ in-flight
 * orders before evicting anything still useful.
 */
const MAX_TRACKED_ORDERS = 500;

function keyId(key: TradeOrderKey): string {
  return `${key.seq}:${key.tsMs}`;
}

function capInsertionOrder<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function withoutExpiredBalances(
  map: ReadonlyMap<string, OptimisticBalanceEntry>,
  now: number,
): Map<string, OptimisticBalanceEntry> {
  const next = new Map(map);
  for (const [key, entry] of next) {
    if (now - entry.updatedAt > OPTIMISTIC_TTL_MS) next.delete(key);
  }
  return next;
}

function withoutExpiredPendingFills(
  map: ReadonlyMap<string, PendingLedgerFill>,
  now: number,
): Map<string, PendingLedgerFill> {
  const next = new Map(map);
  for (const [key, entry] of next) {
    if (now - entry.receivedAtMs > PENDING_LEDGER_TTL_MS) next.delete(key);
  }
  return next;
}

export const useTradeActivityStore = create<State>((set, get) => ({
  toasts: [],
  orderEvents: [],
  lastOrderEvent: null,
  streamConnected: false,
  advancedActivityVersion: 0,
  keyToClientId: new Map<string, string>(),
  orderContext: new Map<string, { walletAccountId: string | null; mint: string }>(),
  optimisticBalances: new Map<string, OptimisticBalanceEntry>(),
  pendingLedgerFills: new Map<string, PendingLedgerFill>(),

  pushPending: (input) => {
    const now = Date.now();
    set((state) => {
      // Replace any existing toast with the same id (rare — clientOrderId
      // is per-click — but defensive).
      const filtered = state.toasts.filter((t) => t.id !== input.id);
      const next: TradeActivityItem = {
        id: input.id,
        mint: input.mint,
        ticker: input.ticker,
        side: input.side,
        solAmount: input.solAmount,
        phase: 'pending',
        walletAccountId: input.walletAccountId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      const orderContext = new Map(state.orderContext);
      orderContext.set(input.id, { walletAccountId: input.walletAccountId ?? null, mint: input.mint });
      capInsertionOrder(orderContext, MAX_TRACKED_ORDERS);
      return { toasts: [...filtered, next].slice(-MAX_TOASTS), orderContext };
    });
  },

  registerOrderContext: (clientOrderId, walletAccountId, mint) => {
    set((state) => {
      const orderContext = new Map(state.orderContext);
      orderContext.set(clientOrderId, { walletAccountId, mint });
      capInsertionOrder(orderContext, MAX_TRACKED_ORDERS);
      return { orderContext };
    });
  },

  registerOrderKey: (clientOrderId, key) => {
    const koId = keyId(key);
    set((state) => {
      // Ack-time mapping is authoritative for our own POST; the SSE
      // `accepted` frame (if it arrives) writes the same pair.
      const map = new Map(state.keyToClientId);
      map.set(koId, clientOrderId);
      capInsertionOrder(map, MAX_TRACKED_ORDERS);
      return {
        keyToClientId: map,
        toasts: state.toasts.map((t) =>
          t.id === clientOrderId && t.orderKey === undefined
            ? { ...t, orderKey: koId, updatedAt: Date.now() }
            : t,
        ),
      };
    });
  },

  markError: (clientOrderId, error) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === clientOrderId
          ? {
              ...t,
              phase: 'error' as const,
              error,
              evmFinality: undefined,
              updatedAt: Date.now(),
            }
          : t,
      ),
    }));
  },

  markConfirmed: (clientOrderId, signature) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === clientOrderId && (t.phase === 'pending' || t.phase === 'submitted')
          ? {
              ...t,
              phase: 'confirmed' as const,
              signature: signature ?? t.signature,
              stalled: false,
              evmFinality: undefined,
              updatedAt: Date.now(),
            }
          : t,
      ),
    }));
  },

  markEvmFinalizing: (clientOrderId) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === clientOrderId && (t.phase === 'pending' || t.phase === 'submitted')
          ? {
              ...t,
              phase: 'submitted' as const,
              evmFinality: 'finalizing' as const,
              stalled: false,
              updatedAt: Date.now(),
            }
          : t,
      ),
    }));
  },

  markEvmReorged: (clientOrderId) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === clientOrderId && (t.phase === 'pending' || t.phase === 'submitted')
          ? {
              ...t,
              phase: 'submitted' as const,
              evmFinality: 'reorged' as const,
              stalled: false,
              updatedAt: Date.now(),
            }
          : t,
      ),
    }));
  },

  markStalled: (clientOrderId) => {
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === clientOrderId && t.phase === 'pending' && t.stalled !== true
          ? { ...t, stalled: true, updatedAt: Date.now() }
          : t,
      ),
    }));
  },

  setStreamConnected: (connected) => {
    set({ streamConnected: connected });
  },

  applyOrderEvent: (event) => {
    const state = get();
    const koId = keyId(event.key);

    // For `accepted` we have the clientOrderId in the intent; for
    // every other event we only have OrderKey, so we have to look
    // up the clientOrderId via the map populated on `accepted`.
    let clientOrderId: string | undefined;
    if (event.kind === 'accepted') {
      clientOrderId = event.clientOrderId;
      if (!clientOrderId) return;
      // Track the order if THIS tab initiated it — either via a visible
      // toast (quickbuy) or a silent context registration (trade-page
      // submit). Either is sufficient to attribute a later fill.
      // ADVANCED suborders (`adv-`) are server-originated — no tab ever
      // submits them, so there is no local registration to match. The
      // stream is user-scoped, so an adv event on our socket IS ours.
      const isAdvancedAccepted = isAdvancedClientOrderId(clientOrderId);
      const isOurs =
        isAdvancedAccepted ||
        state.toasts.some((t) => t.id === clientOrderId) ||
        state.orderContext.has(clientOrderId);
      if (!isOurs) return;
      const map = new Map(state.keyToClientId);
      map.set(koId, clientOrderId);
      capInsertionOrder(map, MAX_TRACKED_ORDERS);
      set({ keyToClientId: map });
      if (isAdvancedAccepted) {
        set((s) => ({ advancedActivityVersion: s.advancedActivityVersion + 1 }));
      }
      if (event.raw !== undefined) {
        set((s) => ({
          lastOrderEvent: event.raw,
          orderEvents: [...s.orderEvents, event.raw].slice(-MAX_ORDER_EVENTS),
        }));
      }
      // Don't visually advance on `accepted` alone — `pending` already
      // covers it and avoids one render flash. Stamp the orderKey on
      // the toast so callers can correlate.
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.id === clientOrderId
            ? { ...t, orderKey: koId, updatedAt: Date.now() }
            : t,
        ),
      }));
      return;
    }

    clientOrderId = state.keyToClientId.get(koId);
    const eventClientId = event.clientOrderId;
    if (
      clientOrderId === undefined &&
      eventClientId !== undefined &&
      isAdvancedClientOrderId(eventClientId)
    ) {
      // Late-attribution fallback: an advanced suborder whose `accepted`
      // we missed (SSE connected after the worker dispatched it). When
      // the api stamps the client id on the event itself, trust it — the
      // stream is user-scoped and `adv-` ids are server-minted.
      clientOrderId = eventClientId;
      const map = new Map(state.keyToClientId);
      map.set(koId, eventClientId);
      capInsertionOrder(map, MAX_TRACKED_ORDERS);
      set({ keyToClientId: map });
    }
    if (!clientOrderId) return; // not one of ours
    const isAdvanced = isAdvancedClientOrderId(clientOrderId);

    // `fill_committed` is the server's post-DB-commit marker: the ledger
    // row for this fill is now readable. It carries no toast/phase/floor
    // semantics — bumping `lastOrderEvent` is all it does, which drives
    // the ledger invalidation effect in `useTradeLedger`.
    if (event.kind === 'fill_committed') {
      if (event.raw !== undefined) set({ lastOrderEvent: event.raw });
      if (isAdvanced) set((s) => ({ advancedActivityVersion: s.advancedActivityVersion + 1 }));
      return;
    }

    const now = Date.now();
    if (event.raw !== undefined) {
      set((s) => ({
        lastOrderEvent: event.raw,
        orderEvents: [...s.orderEvents, event.raw].slice(-MAX_ORDER_EVENTS),
      }));
    }

    // Optimistic balance floor: a confirmed fill carries the exact
    // on-chain `tokenDelta`. Attribute it to the order's wallet (from
    // submit-time context) so a cold-mounted trade page reflects the
    // just-bought tokens before the chain poll catches up. Buys raise
    // the floor; sells reset it (let the chain-backed balance lead the
    // reduction — we never speculatively under-report holdings).
    if (event.kind === 'filled' || event.kind === 'partial') {
      const ctx = state.orderContext.get(clientOrderId);
      const fill = event.fill;
      if (ctx && fill && fill.tokenDelta) {
        const key = optimisticBalanceKey(ctx.walletAccountId, fill.mint);
        const optimisticBalances = withoutExpiredBalances(state.optimisticBalances, now);
        if (fill.side === 'buy') {
          const prev = optimisticBalances.get(key)?.tokens ?? '0';
          const delta = fill.tokenDelta.startsWith('-') ? fill.tokenDelta.slice(1) : fill.tokenDelta;
          optimisticBalances.set(key, { tokens: addDecimal(prev, delta), updatedAt: now });
        } else {
          optimisticBalances.delete(key);
        }
        set({ optimisticBalances });
      }
      // Ledger optimistic delta: park the exact fill so the PnL strip
      // can reflect it before the server's async DB commit is readable.
      // Keyed per on-chain fill (`orderKey:signature`), so a `partial`
      // followed by the terminal `filled` for the same tx overwrites in
      // place instead of double-counting. A missing wallet context still
      // stores (null wallet) — the sum's explicit wallet filter excludes
      // it and the normal refetch converges the strip.
      if (fill && fill.signature) {
        const pendingLedgerFills = withoutExpiredPendingFills(state.pendingLedgerFills, now);
        pendingLedgerFills.set(`${koId}:${fill.signature}`, {
          walletAccountId: ctx?.walletAccountId ?? null,
          mint: fill.mint,
          side: fill.side,
          solDeltaLamports: fill.solDelta,
          tokenDelta: fill.tokenDelta,
          receivedAtMs: now,
        });
        set({ pendingLedgerFills });
      }
    }

    // ── Advanced (automated) suborders: confirmed-only toasts ─────────
    // No pending/submitted/accepted phase ever renders for `adv-` orders
    // (user requirement): `submitted`/`confirmed`/`fill_pending` are
    // swallowed here, and the first `filled`/`partial` births a toast
    // DIRECTLY in the terminal `confirmed` phase (which also rings the
    // success chime in TradeActivityToasts). Failures don't toast — the
    // Orders tab surfaces them as status chips.
    if (isAdvanced) {
      set((s) => ({ advancedActivityVersion: s.advancedActivityVersion + 1 }));
      if (event.kind === 'filled' || event.kind === 'partial') {
        const fill = event.fill;
        const display = event.fillDisplay;
        const advId = clientOrderId;
        set((s) => {
          const existing = s.toasts.find((t) => t.id === advId);
          const item: TradeActivityItem = {
            id: advId,
            mint: fill?.mint ?? existing?.mint ?? '',
            ticker: display?.ticker ?? existing?.ticker ?? (fill ? fill.mint.slice(0, 4) : '—'),
            side: fill?.side ?? existing?.side ?? 'buy',
            solAmount: null,
            phase: 'confirmed',
            signature: event.signature ?? fill?.signature ?? existing?.signature,
            automated: {
              kindLabel: display?.kindLabel ?? existing?.automated?.kindLabel ?? 'DCA',
              amountsLabel: display?.amountsLabel ?? existing?.automated?.amountsLabel ?? '',
            },
            walletAccountId: null,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          // Upsert keyed by the suborder's client id: a `partial` followed
          // by the terminal `filled` for the same leg updates in place.
          const rest = s.toasts.filter((t) => t.id !== advId);
          return { toasts: [...rest, item].slice(-MAX_TOASTS) };
        });
      }
      return;
    }

    set((s) => ({
      toasts: s.toasts.map((t) => {
        if (t.id !== clientOrderId) return t;
        // Skip-if-already-terminal (mirrors `markConfirmed`): a late SSE
        // event — replayed after a reconnect gap, or arriving after the
        // cold-load reconciliation already resolved the toast — must not
        // overwrite a terminal phase (confirmed/error).
        if (t.phase === 'confirmed' || t.phase === 'error') return t;
        switch (event.kind) {
          case 'submitted':
            return { ...t, phase: 'submitted' as const, signature: event.signature, updatedAt: now };
          case 'confirmed':
            return { ...t, phase: 'confirmed' as const, signature: event.signature ?? t.signature, updatedAt: now };
          case 'fill_pending':
            return { ...t, phase: 'confirmed' as const, signature: event.signature ?? t.signature, updatedAt: now };
          case 'filled':
          case 'partial':
            // `confirmed` is the terminal user-facing phase. The fill /
            // balance sync (handled above via the optimistic floor) is a
            // background DB concern — we never advance the toast past
            // confirmed, so the user only sees the tx land on a slot.
            return { ...t, phase: 'confirmed' as const, signature: event.signature ?? t.signature, updatedAt: now };
          case 'failed':
            return { ...t, phase: 'error' as const, error: event.errorKind ?? 'failed', updatedAt: now };
          case 'cancelled':
            return { ...t, phase: 'error' as const, error: event.cancelReason ?? 'cancelled', updatedAt: now };
          case 'resolved':
            return t;
          default:
            return t;
        }
      }),
    }));
  },

  reconcileOptimisticBalance: (walletAccountId, mint, chainTokens) => {
    if (chainTokens === null) return;
    const key = optimisticBalanceKey(walletAccountId, mint);
    const entry = get().optimisticBalances.get(key);
    if (!entry) return;
    // Chain has caught up to (or passed) the optimistic floor — drop it
    // so the live chain balance is the sole source of truth again.
    let caughtUp = false;
    try {
      caughtUp = BigInt(chainTokens) >= BigInt(entry.tokens);
    } catch {
      caughtUp = false;
    }
    if (!caughtUp) return;
    set((state) => {
      const optimisticBalances = new Map(state.optimisticBalances);
      optimisticBalances.delete(key);
      return { optimisticBalances };
    });
  },

  applyTransferBalanceFloors: (entries) => {
    if (entries.length === 0) return;
    const now = Date.now();
    set((state) => {
      const optimisticBalances = withoutExpiredBalances(state.optimisticBalances, now);
      for (const entry of entries) {
        const key = optimisticBalanceKey(entry.walletAccountId, entry.mint);
        if (entry.floorTokens === null) optimisticBalances.delete(key);
        else optimisticBalances.set(key, { tokens: entry.floorTokens, updatedAt: now });
      }
      return { optimisticBalances };
    });
  },

  clearPendingLedgerFills: (keys) => {
    if (keys.length === 0) return;
    set((state) => {
      const pendingLedgerFills = new Map(state.pendingLedgerFills);
      let changed = false;
      for (const key of keys) {
        if (pendingLedgerFills.delete(key)) changed = true;
      }
      return changed ? { pendingLedgerFills } : {};
    });
  },

  dismiss: (clientOrderId) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== clientOrderId) }));
  },
}));

/**
 * Merge the chain-backed balance with the optimistic floor for display.
 * `max` is intentional: the floor only ever raises the shown balance to
 * reflect a confirmed buy, never lowers it speculatively, so sell sizing
 * (which reads the chain balance) is unaffected.
 */
export function mergeDisplayBalance(
  chainTokens: string | null,
  optimisticFloor: string | null,
): string {
  const chain = chainTokens ?? '0';
  if (optimisticFloor === null) return chain;
  return maxDecimal(chain, optimisticFloor);
}

/** Test-only: clears the store between tests. */
export function _resetTradeActivityStoreForTests(): void {
  useTradeActivityStore.setState({
    toasts: [],
    lastOrderEvent: null,
    advancedActivityVersion: 0,
    keyToClientId: new Map(),
    orderContext: new Map(),
    optimisticBalances: new Map(),
    pendingLedgerFills: new Map(),
  });
}
