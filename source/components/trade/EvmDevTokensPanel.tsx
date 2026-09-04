'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import {
  fetchEvmCreatorTokens,
  mergeEvmCreatorTokens,
} from '@/lib/evm/creatorTokensApi';
import type { EvmDiscoverCard } from '@/lib/evm/discoverAdapter';
import { tradePageHref } from '@/lib/evm/chains';
import { formatAge } from '@/lib/evm/money';

const EVM_INGEST_BASE = process.env.NEXT_PUBLIC_EVM_INGEST_BASE ?? '';
const GRID_STYLE: CSSProperties = {
  gridTemplateColumns: 'minmax(180px, 1.6fr) 76px 100px minmax(130px, 0.8fr)',
  columnGap: 18,
};

type PanelState =
  | { kind: 'loading'; items: readonly EvmDiscoverCard[] }
  | { kind: 'loaded'; items: readonly EvmDiscoverCard[]; nextCursor: string | null }
  | { kind: 'unavailable'; items: readonly EvmDiscoverCard[] }
  | { kind: 'error'; items: readonly EvmDiscoverCard[]; status: number | null };

export interface EvmDevTokensPanelProps {
  chain: string;
  creator: string;
  refreshKey: number;
  fetchImpl?: typeof fetch;
}

/** Canonical, paginated token catalog for the loaded token's creator. */
export function EvmDevTokensPanel({
  chain,
  creator,
  refreshKey,
  fetchImpl,
}: EvmDevTokensPanelProps) {
  const [retryKey, setRetryKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<PanelState>({ kind: 'loading', items: [] });
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setLoadingMore(false);
    setState({ kind: 'loading', items: [] });
    void fetchEvmCreatorTokens({
      apiBase: EVM_INGEST_BASE,
      chain,
      creator,
      signal: controller.signal,
      fetchImpl,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === 'ok') {
        setState({ kind: 'loaded', items: result.page.items, nextCursor: result.page.nextCursor });
      } else if (result.kind === 'unavailable') {
        setState({ kind: 'unavailable', items: [] });
      } else {
        setState({ kind: 'error', items: [], status: result.status });
      }
    });
    return () => controller.abort();
  }, [chain, creator, fetchImpl, refreshKey, retryKey]);

  const loadMore = useCallback(() => {
    if (state.kind !== 'loaded' || state.nextCursor === null || loadingMore) return;
    const cursor = state.nextCursor;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setLoadingMore(true);
    void fetchEvmCreatorTokens({
      apiBase: EVM_INGEST_BASE,
      chain,
      creator,
      cursor,
      signal: controller.signal,
      fetchImpl,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === 'ok') {
        setState((current) => current.kind === 'loaded'
          ? {
              kind: 'loaded',
              items: mergeEvmCreatorTokens(current.items, result.page.items, 'append'),
              nextCursor: result.page.nextCursor,
            }
          : current);
      } else if (result.kind === 'unavailable') {
        setState((current) => ({ kind: 'unavailable', items: current.items }));
      } else {
        setState((current) => ({ kind: 'error', items: current.items, status: result.status }));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingMore(false);
    });
  }, [chain, creator, fetchImpl, loadingMore, state]);

  useEffect(() => () => moreController.current?.abort(), []);

  const nowMs = Date.now();
  const message = state.kind === 'loading'
    ? 'Loading canonical creator tokens…'
    : state.kind === 'unavailable'
      ? 'Creator token catalog unavailable; this is not an empty launch history.'
      : state.kind === 'error'
        ? `Creator token catalog could not be read${state.status === null ? '' : ` (HTTP ${state.status})`}.`
        : state.items.length === 0
          ? 'No active canonical tokens found for this creator.'
          : null;

  return (
    <section className="flex min-h-full flex-col" data-testid="evm-dev-tokens">
      <div className="trow trow--head sticky top-0 z-10" style={GRID_STYLE}>
        <span>Token</span>
        <span>Age</span>
        <span>Stage</span>
        <span>Address</span>
      </div>
      {state.items.map((token) => {
        const symbol = token.symbol?.trim() || `${token.address.slice(0, 6)}…${token.address.slice(-4)}`;
        return (
          <Link
            key={`${token.chain}:${token.address}`}
            href={tradePageHref(token.address, token.chain)}
            className="trow"
            style={GRID_STYLE}
            data-testid="evm-dev-token-row"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold" style={{ color: 'var(--ink-0)' }}>{symbol}</span>
              <span className="block truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>{token.name?.trim() || 'Name unavailable'}</span>
            </span>
            <span style={{ color: 'var(--ink-2)' }}>{formatAge(token.firstSeenSec == null ? null : token.firstSeenSec * 1_000, nowMs) ?? '—'}</span>
            <span style={{ color: token.stage === 'graduated' ? 'var(--hold)' : 'var(--ink-2)' }}>{token.stage}</span>
            <span className="truncate font-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>{token.address}</span>
          </Link>
        );
      })}
      {message !== null ? (
        <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground" data-testid={`evm-dev-tokens-${state.kind}`}>
          <span>{message}</span>
          {(state.kind === 'error' || state.kind === 'unavailable') ? (
            <button type="button" className="rounded border px-3 py-1" onClick={() => setRetryKey((key) => key + 1)}>Retry</button>
          ) : null}
        </div>
      ) : null}
      {state.kind === 'loaded' && state.nextCursor !== null ? (
        <button type="button" className="m-4 self-center rounded border px-3 py-1 text-xs" onClick={loadMore} disabled={loadingMore} data-testid="evm-dev-tokens-more">
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
