import type { TradeLedger } from '@/lib/api/trade-ledger';
import {
  PENDING_LEDGER_TTL_MS,
  type PendingLedgerFill,
} from '@/lib/state/trade-activity-store';

/**
 * Optimistic PnL-strip ledger math. The server persists fills into
 * `trading.fills` asynchronously, so a refetch fired on the SSE fill event
 * can race the DB commit and briefly regress BOUGHT/SOLD. `useTradeLedger`
 * overlays the pending fill deltas (parked in the trade-activity store)
 * over the last server view until the server reflects them, then drops
 * them. Pure + framework-free so the merge/threshold semantics are
 * bun-testable without React.
 *
 * Display-only by construction: nothing here feeds sell sizing, balance
 * hints, or order payloads.
 */

export interface PendingLedgerSum {
  /** Positive lamports the pending buys spent (all-in). */
  readonly buyLamports: bigint;
  /** Positive lamports the pending sells received (all-in). */
  readonly sellLamports: bigint;
  /** Signed base-unit token delta across the pending fills. */
  readonly netTokens: bigint;
  /** Store keys of the fills that contributed (for reconcile/clear). */
  readonly keys: string[];
}

const EMPTY_LEDGER: TradeLedger = {
  boughtLamports: 0n,
  soldLamports: 0n,
  netTokens: 0n,
};

/**
 * Sum the pending fill deltas relevant to the current view: wallet must be
 * one of the EXPLICIT selected ids (a null-wallet fill converges via the
 * normal refetch instead), mint must match, and the fill must be within
 * TTL. Buys carry a negative `solDelta` (SOL left the wallet) — negated
 * into a positive BOUGHT contribution; sells contribute their positive
 * `solDelta` to SOLD.
 */
export function sumPendingLedgerFills(
  fills: ReadonlyMap<string, PendingLedgerFill>,
  walletIds: ReadonlyArray<string>,
  mint: string,
  now: number,
): PendingLedgerSum {
  let buyLamports = 0n;
  let sellLamports = 0n;
  let netTokens = 0n;
  const keys: string[] = [];
  if (mint.length > 0 && walletIds.length > 0 && fills.size > 0) {
    const walletSet = new Set(walletIds);
    for (const [key, fill] of fills) {
      if (fill.mint !== mint) continue;
      if (fill.walletAccountId === null || !walletSet.has(fill.walletAccountId)) continue;
      if (now - fill.receivedAtMs >= PENDING_LEDGER_TTL_MS) continue;
      let solDelta: bigint;
      let tokenDelta: bigint;
      try {
        solDelta = BigInt(fill.solDeltaLamports);
        tokenDelta = BigInt(fill.tokenDelta);
      } catch {
        continue; // malformed deltas contribute nothing
      }
      if (fill.side === 'buy') buyLamports += -solDelta;
      else sellLamports += solDelta;
      netTokens += tokenDelta;
      keys.push(key);
    }
  }
  return { buyLamports, sellLamports, netTokens, keys };
}

/**
 * Has the server ledger caught up to the pending deltas? BOUGHT/SOLD are
 * cumulative and monotonic, so `server >= baseline + pending` on both is a
 * safe threshold. `netTokens` is deliberately NOT checked — it is not
 * monotonic (a sell-all → rebuy passes through the same value twice).
 */
export function isReflected(
  server: TradeLedger | null,
  baseline: TradeLedger | null,
  pending: PendingLedgerSum,
): boolean {
  if (server === null) return false;
  const base = baseline ?? EMPTY_LEDGER;
  return (
    server.boughtLamports >= base.boughtLamports + pending.buyLamports &&
    server.soldLamports >= base.soldLamports + pending.sellLamports
  );
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a >= b ? a : b;
}

/**
 * Overlay the pending deltas on the server view. `max()` on the monotonic
 * BOUGHT/SOLD lets a partially-caught-up server row win the moment it is
 * ahead, while the (baseline + pending) floor holds the strip steady while
 * the server lags. `netTokens` follows the server only once BOTH cumulative
 * sums are reflected. Returns null when there is nothing at all to show
 * (preserves the caller's "never traded" mock fallback).
 */
export function mergeLedgerWithPending(
  server: TradeLedger | null,
  baseline: TradeLedger | null,
  pending: PendingLedgerSum,
): TradeLedger | null {
  const hasPending = pending.keys.length > 0;
  if (server === null && baseline === null && !hasPending) return null;
  const base = baseline ?? server ?? EMPTY_LEDGER;
  return {
    boughtLamports: maxBigInt(
      server?.boughtLamports ?? 0n,
      base.boughtLamports + pending.buyLamports,
    ),
    soldLamports: maxBigInt(
      server?.soldLamports ?? 0n,
      base.soldLamports + pending.sellLamports,
    ),
    netTokens:
      server !== null && isReflected(server, baseline, pending)
        ? server.netTokens
        : base.netTokens + pending.netTokens,
  };
}

// ── Fallback-retry dedupe ────────────────────────────────────────────
// When `fill_committed` never arrives (server-side change not deployed,
// frame lost in a reconnect gap) the strip still converges via bounded
// retries: one invalidation at +1.5s and one at +4s after each fill.
// Module-level so the two `useTradeLedger` instances (TradePanel +
// InstantTradeBox) schedule at most one pair per fill between them.

const RETRY_DELAYS_MS: readonly number[] = [1_500, 4_000];
const retryTimersByFillKey = new Map<string, Array<ReturnType<typeof setTimeout>>>();

/**
 * Schedule the bounded fallback invalidations for one pending fill.
 * No-op (returns false) when the fill already has timers registered.
 */
export function registerLedgerRetryTimers(
  fillKey: string,
  receivedAtMs: number,
  fire: () => void,
  now: number = Date.now(),
): boolean {
  if (retryTimersByFillKey.has(fillKey)) return false;
  const lastDelay = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const timers = RETRY_DELAYS_MS.map((delayMs) =>
    setTimeout(() => {
      if (delayMs === lastDelay) retryTimersByFillKey.delete(fillKey);
      fire();
    }, Math.max(0, receivedAtMs + delayMs - now)),
  );
  retryTimersByFillKey.set(fillKey, timers);
  return true;
}

/** Cancel any unfired fallback timers for the given fills (reconciled). */
export function clearLedgerRetryTimers(keys: Iterable<string>): void {
  for (const key of keys) {
    const timers = retryTimersByFillKey.get(key);
    if (!timers) continue;
    for (const timer of timers) clearTimeout(timer);
    retryTimersByFillKey.delete(key);
  }
}

// ── Session ledger cache ─────────────────────────────────────────────
// Last successful server view per `${sig}|${mint}`, used as react-query
// `placeholderData` so a remount paints the strip instantly instead of
// zeros while the first fetch is in flight. Injectable storage so the
// read/write path is bun-testable (no `window` in the test env).

export interface LedgerCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LEDGER_CACHE_PREFIX = 'trade:ledger-cache:';

function defaultLedgerCacheStorage(): LedgerCacheStorage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function readCachedLedger(
  key: string,
  storage: LedgerCacheStorage | null = defaultLedgerCacheStorage(),
): TradeLedger | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(LEDGER_CACHE_PREFIX + key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { bought?: unknown; sold?: unknown; net?: unknown };
    if (
      typeof parsed.bought !== 'string' ||
      typeof parsed.sold !== 'string' ||
      typeof parsed.net !== 'string'
    ) {
      return null;
    }
    return {
      boughtLamports: BigInt(parsed.bought),
      soldLamports: BigInt(parsed.sold),
      netTokens: BigInt(parsed.net),
    };
  } catch {
    return null; // corrupt entry / storage denied — placeholder is best-effort
  }
}

export function writeCachedLedger(
  key: string,
  view: TradeLedger,
  storage: LedgerCacheStorage | null = defaultLedgerCacheStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      LEDGER_CACHE_PREFIX + key,
      JSON.stringify({
        bought: view.boughtLamports.toString(10),
        sold: view.soldLamports.toString(10),
        net: view.netTokens.toString(10),
      }),
    );
  } catch {
    // Quota / privacy mode — the cache is best-effort.
  }
}

/** Test-only: cancels and clears every registered fallback timer. */
export function _resetLedgerRetryTimersForTests(): void {
  for (const timers of retryTimersByFillKey.values()) {
    for (const timer of timers) clearTimeout(timer);
  }
  retryTimersByFillKey.clear();
}

/** Test-only: number of fills with registered fallback timers. */
export function _ledgerRetryTimerCountForTests(): number {
  return retryTimersByFillKey.size;
}
