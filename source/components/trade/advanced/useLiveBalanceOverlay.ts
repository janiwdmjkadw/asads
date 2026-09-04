'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fetchHotTradePoll, isTradingApiConfigured } from '@/lib/api/trading';
import { buildTokenBalanceUrl } from '../useTradeStream';
import { SOL_MINT } from './math';
import type { TokenOption } from './useSpotHoldings';

/**
 * Live per-mint balance overlay for the Allocate/Pay pickers.
 *
 * The picker's base feed is `/portfolio/spot` (DAS-backed, 15s poll) —
 * authoritative for the LIST of holdings, but the slowest balance source
 * in the app. The canonical DCA flow ("buy a coin, then DCA out of it")
 * used to show a dash for the coin you just bought until DAS caught up,
 * which also killed MAX, flip, and affordability validation. This hook
 * reads the sizing-critical mints (the page mint + the currently selected
 * legs) through `/api/v1/trade/token-balance` — the same
 * the chain stream-fresh source the trade panel's sell sizing uses — and the
 * tabs lay it over the spot options (`overlayOptionBalances`). A couple
 * of mints on a 5s tick while the tab is open; never the whole list.
 */
const POLL_MS = 5_000;

const EMPTY: ReadonlyMap<string, bigint> = new Map();

export function useLiveBalanceOverlay(
  walletAccountId: string | null,
  mints: readonly (string | null | undefined)[],
): ReadonlyMap<string, bigint> {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [balances, setBalances] = useState<ReadonlyMap<string, bigint>>(EMPTY);
  const inFlight = useRef(false);
  // Key on membership, not array identity — parents re-derive per render.
  const mintsKey = useMemo(() => {
    const set = new Set<string>();
    for (const mint of mints) {
      // SOL rides the wallet-balance path, not token accounts.
      if (mint && mint !== SOL_MINT) set.add(mint);
    }
    return [...set].sort().join(',');
  }, [mints]);

  useEffect(() => {
    const mintList = mintsKey.length > 0 ? mintsKey.split(',') : [];
    const keep = new Set(mintList);
    setBalances((prev) => {
      if (![...prev.keys()].some((mint) => !keep.has(mint))) return prev;
      const next = new Map<string, bigint>();
      for (const [mint, value] of prev) {
        if (keep.has(mint)) next.set(mint, value);
      }
      return next;
    });
    if (
      walletAccountId === null
      || mintList.length === 0
      || !isTradingApiConfigured()
      || !isLoaded
      || isSignedIn !== true
    ) {
      return undefined;
    }
    let cancelled = false;
    const tick = async (): Promise<void> => {
      if (inFlight.current || document.visibilityState === 'hidden') return;
      inFlight.current = true;
      try {
        // getToken can reject (FAPI blip on token expiry) — a failed tick
        // must skip quietly, never surface an unhandled rejection every 5s.
        let token: string | null;
        try {
          token = await getToken();
        } catch {
          return;
        }
        const entries = await Promise.all(
          mintList.map(async (mint): Promise<[string, bigint] | null> => {
            const url = buildTokenBalanceUrl(mint, walletAccountId);
            if (url === null) return null;
            try {
              const res = await fetchHotTradePoll(url, { authToken: token });
              if (!res.ok) {
                void res.body?.cancel().catch(() => undefined);
                return null;
              }
              const body = (await res.json()) as { tokens?: string; known?: boolean };
              // `known:false` is the route's "we could not read it" shape
              // (no usable wallet row, or neither candidate ATA verified —
              // the read is ATA-only by design). Its `tokens:'0'` is NOT a
              // zero balance; overlaying it would stamp a confident wrong
              // 0 over a correct DAS figure (same rule as useTradeStream).
              if (body.known === false) return null;
              if (typeof body.tokens !== 'string' || !/^[0-9]+$/.test(body.tokens)) return null;
              return [mint, BigInt(body.tokens)];
            } catch {
              // Best-effort: a failed mint keeps its previous value (or the
              // spot figure) until the next tick.
              return null;
            }
          }),
        );
        if (cancelled) return;
        setBalances((prev) => {
          let changed = false;
          const next = new Map(prev);
          for (const entry of entries) {
            if (entry === null) continue;
            const [mint, value] = entry;
            if (prev.get(mint) !== value) {
              next.set(mint, value);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } finally {
        inFlight.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mintsKey, walletAccountId, isLoaded, isSignedIn, getToken]);

  return balances;
}

/**
 * Lay live balances over the spot-derived options. The live read wins
 * whenever present (750ms-TTL the chain stream/RPC vs a 15s DAS poll); UI and
 * USD figures are re-derived with the option's own decimals/price so
 * every consumer (MAX, validation, the picker row) agrees.
 *
 * `trustedDecimalsMints` = mints whose option decimals are AUTHORITATIVE
 * (DAS holdings rows). The synthetic page-mint option assumes the pump
 * standard (6), so a NON-ZERO overlay onto it would render every figure
 * 1000x off for a 9-decimal mint (MAX would show 5,000 for 5 tokens).
 * Zero is decimals-independent, so "you don't hold this" still applies.
 */
export function overlayOptionBalances(
  options: ReadonlyArray<TokenOption>,
  overlay: ReadonlyMap<string, bigint>,
  trustedDecimalsMints: ReadonlySet<string>,
): TokenOption[] {
  if (overlay.size === 0) return [...options];
  return options.map((option) => {
    const live = overlay.get(option.mint);
    if (live == null) return option;
    if (live !== 0n && !trustedDecimalsMints.has(option.mint)) return option;
    const baseUnits = live.toString();
    if (option.balanceBaseUnits === baseUnits) return option;
    const ui = Number(live) / 10 ** option.decimals;
    return {
      ...option,
      balanceBaseUnits: baseUnits,
      balanceUi: Number.isFinite(ui) ? ui : option.balanceUi,
      valueUsd:
        option.priceUsd != null && Number.isFinite(ui) ? ui * option.priceUsd : option.valueUsd,
    };
  });
}
