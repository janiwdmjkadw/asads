'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fetchHotTradePoll, isTradingApiConfigured } from '@/lib/api/trading';
import { buildTokenBalanceUrl } from './useTradeStream';
import {
  mergeDisplayBalance,
  readOptimisticBalance,
  useTradeActivityStore,
  type OptimisticBalanceEntry,
} from '@/lib/state/trade-activity-store';
import {
  acquireWalletBalanceStream,
  mintStreamState,
  streamedTokenBalance,
  walletStreamState,
} from '@/lib/state/wallet-balance-stream';

/**
 * Slice "Multi-wallet split buy/sell orders" (trade UI revision):
 * aggregate token (base-units) balance across the selected wallets
 * for the Buy/Sell sell-percent previews and the Instant Trade Box.
 *
 * Why a separate hook (instead of extending `useTradeStream`)?
 * `useTradeStream` is per-mint and polls a SINGLE wallet's token
 * balance at ~33ms via a hand-rolled `setInterval`. Bolting N
 * parallel polls onto it would muddy its single-purpose hot path.
 * This hook runs ONE shared timer that fires N parallel
 * `/api/v1/trade/token-balance` requests per tick, sums them, and
 * exposes the aggregate. The cadence is slowed to 250ms per tick
 * (vs the 33ms single-wallet hot poll) so the per-second request
 * rate stays sane as the user adds more wallets.
 *
 * The hook is a no-op (returns 0n base-units) whenever the multi
 * set is empty or has only 1 entry — in those cases the existing
 * single-wallet `stream.tokenBalance` is already correct.
 */

const POLL_MS = 250;
// Held-but-quiet mints go STALE ~1.5s after their last frame (finding #16).
// Re-polling them on every 250ms tick would re-open a hot poll for every held
// mint, so the stale-row refresh runs on this slower cadence — correctness of
// sell sizing wins, but the poll volume stays bounded.
const STALE_ROW_POLL_MS = 1_500;
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PerWalletEntry {
  /** Base-units (token decimals applied) string, "0" when unknown. */
  readonly tokens: string;
  /** Whether the backend reported a known position (vs missing/zero). */
  readonly known: boolean;
}

export interface MultiWalletTokenBalance {
  /**
   * Sum of per-wallet token base units across the multi set, as a
   * `bigint`. Returns `0n` while the first tick is in flight or
   * when fewer than 2 wallets are selected (caller should fall back
   * to the single-wallet `stream.tokenBalance` in that case).
   */
  readonly totalBaseUnits: bigint;
  /** Per-wallet last-known balance keyed by `wallet_account_id`. */
  readonly perWallet: ReadonlyMap<string, PerWalletEntry>;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
}

const EMPTY: MultiWalletTokenBalance = Object.freeze({
  totalBaseUnits: 0n,
  perWallet: new Map<string, PerWalletEntry>(),
  status: 'idle',
});

/**
 * Pure sum helper exported for unit tests. Sums every entry's
 * `tokens` (decimal base-units string) via BigInt arithmetic.
 * Malformed entries silently contribute `0n`.
 */
export function sumTokenBaseUnits(
  perWallet: ReadonlyMap<string, { tokens: string }>,
): bigint {
  let total = 0n;
  for (const entry of perWallet.values()) {
    try {
      const v = BigInt(entry.tokens);
      if (v < 0n) continue;
      total += v;
    } catch {
      // skip malformed
    }
  }
  return total;
}

const POSITIVE_INT_REGEX = /^[1-9][0-9]*$/;

/**
 * Project the per-wallet balance snapshot into a `wallet_account_id ->
 * base-units` map suitable for a batch sell's `sellTokenBalanceHints`.
 *
 * Why this exists: batch sells used to forward NO balance hint, so each
 * child had to resolve its balance from a cold per-wallet index or a
 * fail-closed concurrent chain read — when that came back 0 the child
 * cancelled with `no sellable balance`/`sell balance pending` and the
 * sell silently never went through. Forwarding the same hint the
 * single-wallet path already relies on makes the engine take its robust
 * `sellTokenStateFromBalanceHint` short-circuit per child.
 *
 * Only `known`, strictly-positive integer balances are forwarded. `"0"`,
 * unknown, or malformed entries are omitted so the engine falls back to
 * its chain read for those wallets (current behaviour, no regression).
 * Pure + exported for unit tests.
 */
export function pickSellTokenBalanceHints(
  perWallet: ReadonlyMap<string, PerWalletEntry>,
  walletIds: ReadonlyArray<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of walletIds) {
    const entry = perWallet.get(id);
    if (!entry || !entry.known) continue;
    if (!POSITIVE_INT_REGEX.test(entry.tokens)) continue;
    out[id] = entry.tokens;
  }
  return out;
}

/**
 * Per-wallet sell hints that fold each wallet's optimistic balance floor
 * (written on a CONFIRMED buy fill, keyed `${walletAccountId}|${mint}`)
 * into the chain-poll balance, so a confirmed buy instantly raises the
 * sell hint each child forwards — multi-wallet aware, no wait for the
 * next balance poll. The floor only ever RAISES the hint (`max`): it
 * reflects tokens already landed on-chain by the confirmed buy, and is
 * cleared by a sell, the 60s TTL, or chain catch-up (`reconcileOptimisticBalance`).
 * A wallet with only a floor (chain not yet known) is still forwarded.
 * Pure + exported for unit tests.
 */
export function mergeSellHintsWithFloors(
  perWallet: ReadonlyMap<string, PerWalletEntry>,
  floors: ReadonlyMap<string, OptimisticBalanceEntry>,
  mint: string,
  walletIds: ReadonlyArray<string>,
  now: number = Date.now(),
): Record<string, string> {
  const merged = new Map<string, PerWalletEntry>();
  for (const id of walletIds) {
    const chain = perWallet.get(id);
    const floor = readOptimisticBalance(floors, id, mint, now);
    const chainTokens = chain?.known === true ? chain.tokens : null;
    const tokens = mergeDisplayBalance(chainTokens, floor);
    const known = chain?.known === true || floor !== null;
    merged.set(id, { tokens, known });
  }
  return pickSellTokenBalanceHints(merged, walletIds);
}

/**
 * Wallets worth including in a percentage-sell fan-out: drops wallets
 * KNOWN to hold zero of the mint (e.g. just aggregated away), keeps
 * unknown ones (fail-open — the engine's authoritative balance read
 * decides). Without this, a sell after aggregate fires doomed children
 * from every drained wallet. Pure + exported for unit tests.
 */
export function filterSellableWalletIds(
  perWallet: ReadonlyMap<string, PerWalletEntry>,
  floors: ReadonlyMap<string, OptimisticBalanceEntry>,
  mint: string,
  walletIds: ReadonlyArray<string>,
  now: number = Date.now(),
): string[] {
  return walletIds.filter((id) => {
    const chain = perWallet.get(id);
    const floor = readOptimisticBalance(floors, id, mint, now);
    const known = chain?.known === true || floor !== null;
    if (!known) return true;
    const chainTokens = chain?.known === true ? chain.tokens : null;
    return POSITIVE_INT_REGEX.test(mergeDisplayBalance(chainTokens, floor));
  });
}

/**
 * Per-wallet hot poll of `/api/v1/trade/token-balance` (the same
 * endpoint `useTradeStream` consumes for the single-wallet case),
 * fan-out N requests per tick. Returns the BigInt sum + per-wallet
 * snapshot for callers that want to display per-wallet breakdowns.
 */
export function useMultiWalletTokenBalance(
  mint: string | null,
  walletIds: ReadonlyArray<string>,
): MultiWalletTokenBalance {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [perWallet, setPerWallet] = useState<
    ReadonlyMap<string, PerWalletEntry>
  >(EMPTY.perWallet);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const inFlightRef = useRef(false);
  const lastSigRef = useRef('');
  // Per-wallet one-shot seed latch (wallets whose fresh stream has no row
  // for this mint = no position). Once seeded we stop polling them and
  // defer to the stream + optimistic floor. Reset on selection/mint
  // change and on order events.
  const seededRef = useRef<Set<string>>(new Set());
  // Lets the order-event effect fire an immediate re-read without
  // rebuilding the polling interval.
  const tickRef = useRef<(() => void) | null>(null);
  // Order activity can close a token account (sell-to-zero), which the
  // stream drops from its snapshot — re-seed so the sum never carries a
  // stale-high balance into the multi-wallet sell hint.
  const orderEventCount = useTradeActivityStore((s) => s.orderEvents.length);

  // Stable key for the wallet set so re-orderings don't churn the
  // effect. We pre-filter to valid UUIDs because the api/ rejects
  // anything else and we don't want to hit the network with garbage.
  const validIds = useMemo(
    () => walletIds.filter((id) => UUID_REGEX.test(id)),
    [walletIds],
  );
  const idsKey = validIds.slice().sort().join('|');

  // Join the shared the chain stream balance stream for every selected wallet
  // (ref-counted — shares connections with the single-wallet hook). The
  // tick below prefers streamed balances and only fetches the wallets
  // the stream hasn't observed yet.
  useEffect(() => {
    if (!isTradingApiConfigured() || !isLoaded || isSignedIn !== true) return;
    const releases = validIds.map((id) => acquireWalletBalanceStream(id));
    return () => {
      for (const release of releases) release();
    };
  }, [idsKey, isLoaded, isSignedIn, validIds]);

  useEffect(() => {
    if (
      !mint ||
      !isTradingApiConfigured() ||
      !isLoaded ||
      isSignedIn !== true ||
      validIds.length < 2
    ) {
      setPerWallet(EMPTY.perWallet);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setPerWallet(EMPTY.perWallet);
    lastSigRef.current = '';
    seededRef.current = new Set();
    let cancelled = false;
    // Carries values forward across ticks so a seeded (skipped) wallet
    // stays in the sum instead of dropping out.
    let lastMap = new Map<string, PerWalletEntry>();
    // Last authoritative poll of a seeded wallet whose mint row went stale —
    // throttles the held-but-quiet refresh to STALE_ROW_POLL_MS (#16).
    const staleRowPolledAt = new Map<string, number>();

    const tick = async (): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        // Per-wallet, branch on stream state (see `walletStreamState`):
        //   fresh + row  → serve streamed, zero HTTP.
        //   fresh + none → no position; seed ONCE then skip (carry fwd).
        //   stale / down → authoritative poll (the only steady HTTP).
        const next = new Map(lastMap);
        const toFetch: string[] = [];
        const seedFetch = new Set<string>();
        for (const id of validIds) {
          const state = walletStreamState(id);
          if (state === 'fresh') {
            const streamed = streamedTokenBalance(id, mint);
            if (streamed !== null) {
              next.set(id, { tokens: streamed, known: true });
              seededRef.current.add(id);
              continue;
            }
            // No FRESH row for this mint. Seed once if never observed; a STALE
            // row (held-but-quiet mint whose balance may have moved) polls
            // authoritatively, but on the slower STALE_ROW_POLL_MS cadence so
            // held mints do not re-open a hot poll (finding #16).
            if (!seededRef.current.has(id)) {
              toFetch.push(id);
              seedFetch.add(id);
            } else if (
              mintStreamState(id, mint) === 'stale'
              && Date.now() - (staleRowPolledAt.get(id) ?? 0) >= STALE_ROW_POLL_MS
            ) {
              staleRowPolledAt.set(id, Date.now());
              toFetch.push(id);
            }
          } else {
            toFetch.push(id);
          }
        }
        if (toFetch.length > 0) {
          const token = await getToken();
          const settled = await Promise.allSettled(
            toFetch.map(async (id) => {
              const url = buildTokenBalanceUrl(mint, id);
              if (url === null) {
                return { id, entry: { tokens: '0', known: false } };
              }
              const r = await fetchHotTradePoll(url, { authToken: token });
              if (!r.ok) return { id, entry: { tokens: '0', known: false } };
              const j = (await r.json()) as {
                tokens?: string;
                known?: boolean;
                reauth_required?: boolean;
              };
              if (j.reauth_required === true) {
                return { id, entry: { tokens: '0', known: false } };
              }
              const tokens = typeof j.tokens === 'string' ? j.tokens : '0';
              const known = j.known !== false;
              return { id, entry: { tokens, known } };
            }),
          );
          if (cancelled) return;
          for (const r of settled) {
            if (r.status === 'fulfilled') {
              next.set(r.value.id, r.value.entry);
              // Only latch wallets seeded while FRESH — stale/disconnected
              // wallets must keep polling until their stream recovers.
              if (seedFetch.has(r.value.id)) seededRef.current.add(r.value.id);
            }
          }
        }
        if (cancelled) return;
        // Drop wallets no longer selected so the sum stays scoped.
        for (const id of [...next.keys()]) {
          if (!validIds.includes(id)) next.delete(id);
        }
        // De-dupe: only push a new Map when a per-wallet balance actually
        // changed, so a steady (all-streamed/seeded) tick never re-renders.
        const sig = [...next.entries()]
          .map(([id, e]) => `${id}:${e.tokens}:${e.known ? '1' : '0'}`)
          .sort()
          .join('|');
        lastMap = next;
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setPerWallet(next);
        }
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        inFlightRef.current = false;
      }
    };

    tickRef.current = () => { void tick(); };
    void tick();
    // The interval re-evaluates stream state cheaply; it only hits the
    // network for wallets that are stale/disconnected or pending their
    // one-shot seed, so steady state is zero HTTP regardless of wallet
    // count — the property that keeps this scalable to many wallets/users.
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      tickRef.current = null;
      window.clearInterval(timer);
    };
  }, [mint, idsKey, isLoaded, isSignedIn, getToken, validIds]);

  useEffect(() => {
    seededRef.current = new Set();
    tickRef.current?.();
  }, [orderEventCount]);

  const totalBaseUnits = useMemo<bigint>(
    () => sumTokenBaseUnits(perWallet),
    [perWallet],
  );

  return useMemo<MultiWalletTokenBalance>(
    () => ({ totalBaseUnits, perWallet, status }),
    [totalBaseUnits, perWallet, status],
  );
}
