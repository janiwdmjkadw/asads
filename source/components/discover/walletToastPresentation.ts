import { compactAge } from '@/lib/format';
import type { WalletActivityEvent } from './useWalletActivity';

// Pure presentation logic for tracked-wallet trade toasts: hold-aware verb
// ("bought" / "bought more" / "sold some" / "sold all") and the at-trade
// market cap. Zero fetches — everything derives from the event itself plus
// a bounded session ledger for events that predate the postTokens wire
// field (persister backfill rows).

export type TradeVerb = 'bought' | 'bought more' | 'sold some' | 'sold all';

/** Pump standard supply in base units (1B tokens × 1e6 decimals). */
const PUMP_SUPPLY_BASE_UNITS = 1_000_000_000_000_000;
/** Below this the sol/token ratio is fee-dominated dust — hide the MC. */
const MIN_MC_SOL_LAMPORTS = 500_000n; // 0.0005 SOL
/** Sanity ceiling: a computed MC above this is a bad ratio, not a coin. */
const MAX_MC_USD = 1e12;
/** Floor for the server-computed MC: no real coin sits below this (pump
 *  launches start in the hundreds of dollars) — anything lower is a
 *  nearly-drained pool or a decode fault, not a market. */
const MIN_WIRE_MC_USD = 100;

const LEDGER_CAP = 2_000;

/** Session memory of net observed flow per `wallet:mint`, used only when
 *  an event carries no postTokens. Bounded, evict-oldest (Map insertion
 *  order). Never treated as authoritative — it can only widen "bought" to
 *  "bought more"; it never claims "sold all" without on-chain proof. */
export function createTradeLedger() {
  const net = new Map<string, bigint>();
  return {
    /** Returns the verb for the event AND records its flow. */
    classify(event: WalletActivityEvent): TradeVerb {
      const key = `${event.wallet}:${event.mint}`;
      let tokens = 0n;
      try {
        tokens = BigInt(event.tokens);
      } catch {
        tokens = 0n;
      }
      let post: bigint | null = null;
      if (typeof event.postTokens === 'string') {
        try {
          post = BigInt(event.postTokens);
        } catch {
          post = null;
        }
      }
      const prior = net.get(key);
      const nextNet = (prior ?? 0n) + (event.isBuy ? tokens : -tokens);
      // Re-insert so hot pairs stay away from the eviction front.
      net.delete(key);
      net.set(key, nextNet);
      if (net.size > LEDGER_CAP) {
        for (const oldest of net.keys()) {
          if (net.size <= LEDGER_CAP) break;
          net.delete(oldest);
        }
      }
      if (event.isBuy) {
        // Exact when the wire carries the post-trade balance: holding more
        // than this buy delivered means tokens were already held.
        if (post !== null) return post > tokens ? 'bought more' : 'bought';
        return prior !== undefined && prior > 0n ? 'bought more' : 'bought';
      }
      if (post !== null) return post === 0n ? 'sold all' : 'sold some';
      // Unknown balance: never claim a full exit without proof.
      return 'sold some';
    },
  };
}

/** Market cap (USD) at trade time. Preferred source is the server's
 *  `mcLamports` — the exact post-trade spot MC computed from the tx's own
 *  pool state (the backend service trade-mc.ts). When that field is ABSENT (rows
 *  persisted before it existed), fall back to the trade's own sol/token
 *  ratio at the pump standard 1B supply — approximate, because the
 *  wallet's SOL delta bundles fees/tips/rent. When the field is PRESENT
 *  but malformed or out of bounds, return null rather than falling back:
 *  the server computed something suspect, and showing the known-inflated
 *  ratio instead would mask exactly the regression class this field
 *  exists to fix. Null also when nothing can be computed honestly:
 *  unknown SOL price, dust-sized trades, zero amounts, out-of-bounds. */
export function tradeMarketCapUsd(
  event: Pick<WalletActivityEvent, 'solLamports' | 'tokens'> & Partial<Pick<WalletActivityEvent, 'mcLamports'>>,
  solUsd: number | null,
): number | null {
  if (solUsd === null || !Number.isFinite(solUsd) || solUsd <= 0) return null;
  if (typeof event.mcLamports === 'string' && event.mcLamports.length > 0) {
    // Number('junk') is NaN and lamport magnitudes sit well inside float
    // precision at the sanity bounds — no bigint round-trip needed.
    const mc = (Number(event.mcLamports) / 1e9) * solUsd;
    return Number.isFinite(mc) && mc >= MIN_WIRE_MC_USD && mc <= MAX_MC_USD ? mc : null;
  }
  let sol: bigint;
  let tokens: bigint;
  try {
    sol = BigInt(event.solLamports);
    tokens = BigInt(event.tokens);
  } catch {
    return null;
  }
  if (tokens <= 0n || sol < MIN_MC_SOL_LAMPORTS) return null;
  const mc = (Number(sol) / 1e9) * solUsd * (PUMP_SUPPLY_BASE_UNITS / Number(tokens));
  if (!Number.isFinite(mc) || mc <= 0 || mc > MAX_MC_USD) return null;
  return mc;
}

/** "$2.99K" / "$1.2M" — compact MC for the toast line. */
export function formatToastMc(mc: number): string {
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(2)}K`;
  return `$${mc.toFixed(0)}`;
}

// ── Coin-age registry ───────────────────────────────────────────────────
// Session memory of mint → createdAtMs, fed passively by surfaces that
// already receive it (every normalized snapshot, the toast ticker
// resolver's identity fetch). Lets the age badge render for OLD coins —
// anything ever seen by any surface this session — not just live-lane
// cards. Bounded, evict-oldest; age is computed AT TOAST TIME so a "6h"
// coin shows "6h" now and "7h" an hour later.
const CREATED_AT_CAP = 4_000;
const mintCreatedAt = new Map<string, number>();

export function rememberMintCreatedAt(mint: string, createdAtMs: number | null | undefined): void {
  if (!mint || typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs) || createdAtMs <= 0) return;
  mintCreatedAt.delete(mint);
  mintCreatedAt.set(mint, createdAtMs);
  if (mintCreatedAt.size > CREATED_AT_CAP) {
    for (const oldest of mintCreatedAt.keys()) {
      if (mintCreatedAt.size <= CREATED_AT_CAP) break;
      mintCreatedAt.delete(oldest);
    }
  }
}

export function ageLabelForMint(mint: string): string | null {
  const createdAtMs = mintCreatedAt.get(mint);
  if (createdAtMs === undefined) return null;
  const age = Date.now() - createdAtMs;
  return age >= 0 ? compactAge(age) : null;
}
