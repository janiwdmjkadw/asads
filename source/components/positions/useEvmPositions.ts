'use client';

import { useEffect, useState } from 'react';
import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import {
  fetchEvmPortfolio,
  EVM_PORTFOLIO_CHAINS,
  type EvmPortfolioChain,
} from '@/lib/api/evm-positions';
import { toEvmPositionRows, type EvmPositionRow } from './evmPositionView';

/**
 * Open EVM positions across every wave-1 chain, for the position strip.
 *
 * POLLED, NOT STREAMED, and the difference is worth stating: the Solana strip
 * rides `GET /api/v1/trade/positions/stream`, an SSE that pushes a
 * server-joined balance ⋈ basis ⋈ price frame. There is no EVM equivalent —
 * `api/src/routes/portfolio/evm.ts` is a plain GET, cached 5s per (user,
 * chain) — so this polls on a slow interval and says nothing about latency it
 * does not have.
 *
 * Both chains are fetched, not the "selected" one: the strip lives in the
 * global sub-header and a position on BSC does not stop existing because the
 * user is looking at Robinhood Chain. Two requests every {@link POLL_MS} is
 * cheap against a 5s server cache.
 *
 * Failures are SILENT here by design. This surface sits beside the Solana
 * strip and an EVM outage must not blank or error the Solana positions next to
 * it; the rows simply do not appear, and the underlying result kind is
 * surfaced through `lastError` for whoever wants to render it.
 */

const POLL_MS = 30_000;

export interface EvmPositionsSnapshot {
  readonly rows: ReadonlyArray<EvmPositionRow>;
  readonly isLoading: boolean;
  /** Per-chain failure kind, for surfaces that want to disclose it. */
  readonly errorsByChain: ReadonlyMap<EvmPortfolioChain, string>;
  readonly truncatedCountsByChain: ReadonlyMap<EvmPortfolioChain, number>;
}

const EMPTY: EvmPositionsSnapshot = {
  rows: [],
  isLoading: true,
  errorsByChain: new Map(),
  truncatedCountsByChain: new Map(),
};

export function useEvmPositions(enabled = true): EvmPositionsSnapshot {
  const { isLoaded, isSignedIn } = useSeededAuth();
  const active = enabled && isLoaded && isSignedIn === true;
  const [snapshot, setSnapshot] = useState<EvmPositionsSnapshot>(EMPTY);

  useEffect(() => {
    if (!active) {
      setSnapshot({
        rows: [],
        isLoading: false,
        errorsByChain: new Map(),
        truncatedCountsByChain: new Map(),
      });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      const results = await Promise.all(
        EVM_PORTFOLIO_CHAINS.map(async (chain) => ({
          chain,
          result: await fetchEvmPortfolio(chain, { signal: controller.signal }),
        })),
      );
      if (cancelled) return;
      const rows: EvmPositionRow[] = [];
      const errorsByChain = new Map<EvmPortfolioChain, string>();
      const truncatedCountsByChain = new Map<EvmPortfolioChain, number>();
      for (const { chain, result } of results) {
        if (result.kind === 'ok') {
          rows.push(...toEvmPositionRows({ chain, wallets: result.wallets }));
          truncatedCountsByChain.set(chain, result.holdingsTruncatedCount);
        } else {
          errorsByChain.set(chain, result.kind);
        }
      }
      /* Sorted by most recent fill, newest first, with never-filled rows last.
         A stable order matters more than the criterion: the strip re-renders
         every poll and a list that reshuffles under the cursor is unusable.
         The id tie-break makes it total. */
      rows.sort((left, right) => {
        const delta = (right.lastFillAtMs ?? 0) - (left.lastFillAtMs ?? 0);
        return delta !== 0 ? delta : left.id.localeCompare(right.id);
      });
      setSnapshot((previous) => {
        const retained = previous.rows.filter((row) => errorsByChain.has(row.chain));
        const merged = [...rows, ...retained];
        merged.sort((left, right) => {
          const delta = (right.lastFillAtMs ?? 0) - (left.lastFillAtMs ?? 0);
          return delta !== 0 ? delta : left.id.localeCompare(right.id);
        });
        for (const failedChain of errorsByChain.keys()) {
          const retainedCount = previous.truncatedCountsByChain.get(failedChain);
          if (retainedCount !== undefined) truncatedCountsByChain.set(failedChain, retainedCount);
        }
        return { rows: merged, isLoading: false, errorsByChain, truncatedCountsByChain };
      });
    };

    void load();
    const timer = globalThis.setInterval(() => void load(), POLL_MS);
    const onOrderTransition = () => void load();
    globalThis.addEventListener('listen:evm-order-transition', onOrderTransition);
    return () => {
      cancelled = true;
      controller.abort();
      globalThis.clearInterval(timer);
      globalThis.removeEventListener('listen:evm-order-transition', onOrderTransition);
    };
  }, [active]);

  return snapshot;
}
