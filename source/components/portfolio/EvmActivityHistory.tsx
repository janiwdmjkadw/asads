'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import Link from 'next/link';

import {
  fetchEvmFills,
  type EvmFillEntry,
  type EvmFillsResult,
} from '@/lib/evm/fillsApi';
import { explorerTxUrl, shortTxHash } from '@/lib/evm/explorer';
import { nativeSymbolForChain, tradePageHref } from '@/lib/evm/chains';
import { formatBigIntUnits, parseWireSigned } from '@/lib/evm/money';

export const EVM_ACTIVITY_CHAINS = ['bsc', 'robinhood_chain'] as const;
export type EvmActivityChain = (typeof EVM_ACTIVITY_CHAINS)[number];
const POLL_MS = 30_000;
const LIMIT_PER_CHAIN = 50;

const CHAIN_LABELS: Record<EvmActivityChain, string> = {
  bsc: 'BSC',
  robinhood_chain: 'Robinhood',
};

export interface EvmActivitySnapshot {
  readonly fills: ReadonlyArray<EvmFillEntry>;
  readonly failedChains: ReadonlyArray<string>;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly reauthRequired: boolean;
  readonly moreAvailable: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreFailedChains: ReadonlyArray<string>;
}

export interface EvmActivityChainPage {
  readonly fills: ReadonlyArray<EvmFillEntry>;
  readonly walletAccountIds: ReadonlyArray<string>;
  readonly nextCursor: string | null;
  readonly expanded: boolean;
}

export interface EvmActivityState {
  readonly pages: Readonly<Record<EvmActivityChain, EvmActivityChainPage>>;
  readonly failedChains: ReadonlyArray<EvmActivityChain>;
  readonly loadMoreFailedChains: ReadonlyArray<EvmActivityChain>;
  readonly loadingMoreChains: ReadonlyArray<EvmActivityChain>;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly reauthRequired: boolean;
}

type EvmActivityPageResult = {
  readonly chain: EvmActivityChain;
  readonly result: EvmFillsResult;
};

export type EvmActivityEvent =
  | { readonly type: 'refresh_started' }
  | { readonly type: 'refresh_finished'; readonly results: ReadonlyArray<EvmActivityPageResult> }
  | { readonly type: 'load_more_started'; readonly chains: ReadonlyArray<EvmActivityChain> }
  | {
      readonly type: 'load_more_finished';
      readonly chain: EvmActivityChain;
      readonly requestedCursor: string;
      readonly requestedAuthority: string;
      readonly result: EvmFillsResult;
    };

function emptyPage(): EvmActivityChainPage {
  return { fills: [], walletAccountIds: [], nextCursor: null, expanded: false };
}

export function createInitialEvmActivityState(): EvmActivityState {
  return {
    pages: { bsc: emptyPage(), robinhood_chain: emptyPage() },
    failedChains: [],
    loadMoreFailedChains: [],
    loadingMoreChains: [],
    loading: true,
    refreshing: false,
    reauthRequired: false,
  };
}

export function evmActivityAuthorityKey(ids: ReadonlyArray<string>): string {
  return [...ids].sort().join(',');
}

export function mergeEvmActivityFills(
  ...groups: ReadonlyArray<ReadonlyArray<EvmFillEntry>>
): ReadonlyArray<EvmFillEntry> {
  const byId = new Map<string, EvmFillEntry>();
  for (const group of groups) {
    for (const fill of group) {
      if (!byId.has(fill.fillId)) byId.set(fill.fillId, fill);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const timeDelta = (right.confirmedAtMs ?? 0) - (left.confirmedAtMs ?? 0);
    return timeDelta !== 0 ? timeDelta : left.fillId.localeCompare(right.fillId);
  });
}

function withoutChain(
  chains: ReadonlyArray<EvmActivityChain>,
  chain: EvmActivityChain,
): ReadonlyArray<EvmActivityChain> {
  return chains.filter((candidate) => candidate !== chain);
}

function withChain(
  chains: ReadonlyArray<EvmActivityChain>,
  chain: EvmActivityChain,
): ReadonlyArray<EvmActivityChain> {
  return chains.includes(chain) ? chains : [...chains, chain];
}

export function evmActivityReducer(
  state: EvmActivityState,
  event: EvmActivityEvent,
): EvmActivityState {
  if (event.type === 'refresh_started') {
    return {
      ...state,
      loading: state.loading,
      refreshing: !state.loading,
    };
  }

  if (event.type === 'refresh_finished') {
    if (event.results.some(({ result }) => result.kind === 'reauth')) {
      return { ...createInitialEvmActivityState(), loading: false, reauthRequired: true };
    }
    const pages: Record<EvmActivityChain, EvmActivityChainPage> = {
      bsc: state.pages.bsc,
      robinhood_chain: state.pages.robinhood_chain,
    };
    const failedChains: EvmActivityChain[] = [];
    for (const { chain, result } of event.results) {
      if (result.kind !== 'ok' || result.chain !== chain) {
        failedChains.push(chain);
        continue;
      }
      const previous = state.pages[chain];
      const sameAuthority =
        evmActivityAuthorityKey(previous.walletAccountIds) ===
        evmActivityAuthorityKey(result.walletAccountIds);
      const previousIds = new Set(previous.fills.map((fill) => fill.fillId));
      const refreshOverlaps = result.fills.some((fill) => previousIds.has(fill.fillId));
      // Keep expanded history only when the new first page overlaps it. If a
      // full page of newer fills arrived between polls, there is a gap between
      // the new page and the old rows; resetting to the new cursor is the only
      // honest way to make that gap loadable.
      const retainOlder =
        previous.expanded &&
        sameAuthority &&
        result.nextCursor !== null &&
        refreshOverlaps;
      pages[chain] = {
        fills: retainOlder
          ? mergeEvmActivityFills(result.fills, previous.fills)
          : result.fills,
        walletAccountIds: result.walletAccountIds,
        nextCursor: retainOlder ? previous.nextCursor : result.nextCursor,
        expanded: retainOlder,
      };
    }
    return {
      pages,
      failedChains,
      loadMoreFailedChains: [],
      loadingMoreChains: [],
      loading: false,
      refreshing: false,
      reauthRequired: false,
    };
  }

  if (event.type === 'load_more_started') {
    return {
      ...state,
      loadMoreFailedChains: state.loadMoreFailedChains.filter(
        (chain) => !event.chains.includes(chain),
      ),
      loadingMoreChains: event.chains,
    };
  }

  const current = state.pages[event.chain];
  const requestIsCurrent =
    current.nextCursor === event.requestedCursor &&
    evmActivityAuthorityKey(current.walletAccountIds) === event.requestedAuthority;
  const loadingMoreChains = withoutChain(state.loadingMoreChains, event.chain);
  if (!requestIsCurrent) return { ...state, loadingMoreChains };
  if (event.result.kind === 'reauth') {
    return { ...createInitialEvmActivityState(), loading: false, reauthRequired: true };
  }
  if (event.result.kind !== 'ok' || event.result.chain !== event.chain) {
    return {
      ...state,
      loadingMoreChains,
      loadMoreFailedChains: withChain(state.loadMoreFailedChains, event.chain),
    };
  }
  if (
    evmActivityAuthorityKey(event.result.walletAccountIds) !== event.requestedAuthority
  ) {
    return {
      ...state,
      pages: { ...state.pages, [event.chain]: emptyPage() },
      failedChains: withChain(state.failedChains, event.chain),
      loadMoreFailedChains: withoutChain(state.loadMoreFailedChains, event.chain),
      loadingMoreChains,
    };
  }
  return {
    ...state,
    pages: {
      ...state.pages,
      [event.chain]: {
        fills: mergeEvmActivityFills(current.fills, event.result.fills),
        walletAccountIds: current.walletAccountIds,
        nextCursor: event.result.nextCursor,
        expanded: true,
      },
    },
    loadMoreFailedChains: withoutChain(state.loadMoreFailedChains, event.chain),
    loadingMoreChains,
  };
}

export function toEvmActivitySnapshot(
  state: EvmActivityState,
  chains: ReadonlyArray<EvmActivityChain> = EVM_ACTIVITY_CHAINS,
): EvmActivitySnapshot {
  return {
    fills: mergeEvmActivityFills(...chains.map((chain) => state.pages[chain].fills)),
    failedChains: state.failedChains.filter((chain) => chains.includes(chain)),
    loading: state.loading,
    refreshing: state.refreshing,
    reauthRequired: state.reauthRequired,
    moreAvailable: chains.some(
      (chain) => state.pages[chain].nextCursor !== null,
    ),
    loadingMore: state.loadingMoreChains.some((chain) => chains.includes(chain)),
    loadMoreFailedChains: state.loadMoreFailedChains.filter((chain) => chains.includes(chain)),
  };
}

export function EvmActivityHistory({
  loader = fetchEvmFills,
  chains = EVM_ACTIVITY_CHAINS,
}: {
  loader?: typeof fetchEvmFills;
  chains?: ReadonlyArray<EvmActivityChain>;
}) {
  const [state, dispatch] = useReducer(
    evmActivityReducer,
    undefined,
    createInitialEvmActivityState,
  );
  const refreshSequence = useRef(0);
  const refreshInFlight = useRef<number | null>(null);
  const loadMoreInFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  const readPage = useCallback(
    async (
      chain: EvmActivityChain,
      cursor: string | null,
      signal?: AbortSignal,
    ): Promise<EvmFillsResult> => {
      try {
        return await loader(
          { chain, limit: LIMIT_PER_CHAIN, ...(cursor === null ? {} : { cursor }) },
          { signal },
        );
      } catch (error) {
        return {
          kind: 'network_error',
          reason: error instanceof Error ? error.message : 'network_error',
        };
      }
    },
    [loader],
  );

  const loadFresh = useCallback(
    async (signal?: AbortSignal) => {
      if (refreshInFlight.current !== null) return;
      const requestId = refreshSequence.current + 1;
      refreshSequence.current = requestId;
      refreshInFlight.current = requestId;
      dispatch({ type: 'refresh_started' });
      try {
        const results = await Promise.all(
          chains.map(async (chain) => ({
            chain,
            result: await readPage(chain, null, signal),
          })),
        );
        if (signal?.aborted !== true) dispatch({ type: 'refresh_finished', results });
      } finally {
        if (refreshInFlight.current === requestId) refreshInFlight.current = null;
      }
    },
    [chains, readPage],
  );

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    const onOrderTransition = () => void loadFresh(controller.signal);
    void loadFresh(controller.signal);
    const timer = globalThis.setInterval(() => void loadFresh(controller.signal), POLL_MS);
    globalThis.addEventListener('listen:evm-order-transition', onOrderTransition);
    return () => {
      controller.abort();
      refreshInFlight.current = null;
      if (activeController.current === controller) activeController.current = null;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener('listen:evm-order-transition', onOrderTransition);
    };
  }, [loadFresh]);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current) return;
    const failed = new Set(state.loadMoreFailedChains);
    const requestedChains = chains.filter((chain) => {
      if (state.pages[chain].nextCursor === null) return false;
      return failed.size === 0 || failed.has(chain);
    });
    if (requestedChains.length === 0) return;
    loadMoreInFlight.current = true;
    dispatch({ type: 'load_more_started', chains: requestedChains });
    try {
      await Promise.all(
        requestedChains.map(async (chain) => {
          const page = state.pages[chain];
          const cursor = page.nextCursor;
          if (cursor === null) return;
          const requestedAuthority = evmActivityAuthorityKey(page.walletAccountIds);
          const signal = activeController.current?.signal;
          const result = await readPage(
            chain,
            cursor,
            signal,
          );
          if (signal?.aborted === true) return;
          dispatch({
            type: 'load_more_finished',
            chain,
            requestedCursor: cursor,
            requestedAuthority,
            result,
          });
        }),
      );
    } finally {
      loadMoreInFlight.current = false;
    }
  }, [chains, readPage, state.loadMoreFailedChains, state.pages]);

  return (
    <EvmActivityBody
      snapshot={toEvmActivitySnapshot(state, chains)}
      onRetry={() => void loadFresh(activeController.current?.signal)}
      onLoadMore={() => void loadMore()}
    />
  );
}

export function EvmActivityBody({
  snapshot,
  onRetry,
  onLoadMore,
}: {
  snapshot: EvmActivitySnapshot;
  onRetry?: () => void;
  onLoadMore?: () => void;
}) {
  return (
    <section
      aria-label="EVM activity"
      data-testid="evm-activity-history"
      className="rounded-lg border p-3"
    >
      <header className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">EVM activity</h3>
        <span className="text-[10px] text-muted-foreground">
          your confirmed trades across every EVM token and wallet
        </span>
      </header>
      {snapshot.loading ? (
        <p className="text-xs text-muted-foreground">Loading EVM activity...</p>
      ) : snapshot.reauthRequired ? (
        <p className="text-xs text-muted-foreground">Sign in again to read your EVM activity.</p>
      ) : (
        <>
          {snapshot.failedChains.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-amber-600" role="status">
              <span>
                {snapshot.failedChains.map(chainLabel).join(' and ')} history is temporarily
                unavailable. Any rows shown for those chains are the last successfully read values.
              </span>
              {onRetry === undefined ? null : (
                <button
                  type="button"
                  data-testid="evm-activity-retry"
                  disabled={snapshot.refreshing}
                  onClick={onRetry}
                  className="rounded bg-muted px-2 py-0.5 font-semibold disabled:opacity-40"
                >
                  {snapshot.refreshing ? 'Retrying...' : 'Retry'}
                </button>
              )}
            </div>
          ) : null}
          {snapshot.fills.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {snapshot.failedChains.length === EVM_ACTIVITY_CHAINS.length
                ? 'Activity could not be read; this is not an empty history.'
                : 'No confirmed EVM trades recorded yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {snapshot.fills.map((fill) => (
                <ActivityRow key={fill.fillId} fill={fill} />
              ))}
            </ul>
          )}
          {snapshot.loadMoreFailedChains.length > 0 ? (
            <p className="mt-2 text-[10px] text-amber-600" role="status">
              Older {snapshot.loadMoreFailedChains.map(chainLabel).join(' and ')} history could not
              be read. Existing rows are unchanged.
            </p>
          ) : null}
          {snapshot.moreAvailable && onLoadMore !== undefined ? (
            <button
              type="button"
              data-testid="evm-activity-load-more"
              disabled={snapshot.loadingMore}
              onClick={onLoadMore}
              className="mt-2 rounded bg-muted px-2 py-1 text-[10px] font-semibold disabled:opacity-40"
            >
              {snapshot.loadingMore
                ? 'Loading...'
                : snapshot.loadMoreFailedChains.length > 0
                  ? 'Retry older'
                  : 'Load older'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActivityRow({ fill }: { fill: EvmFillEntry }) {
  const nativeRaw = parseWireSigned(fill.nativeDeltaWei);
  const nativeMagnitude = nativeRaw === null ? null : nativeRaw < 0n ? -nativeRaw : nativeRaw;
  const nativeText =
    nativeMagnitude === null
      ? 'amount unknown'
      : `${formatBigIntUnits(nativeMagnitude, 18, 6)} ${nativeSymbolForChain(fill.chain)}`;
  const tokenRaw = parseWireSigned(fill.tokenDeltaBaseUnits);
  const tokenMagnitude = tokenRaw === null ? null : tokenRaw < 0n ? -tokenRaw : tokenRaw;
  const tokenText = tokenMagnitude === null
    ? 'token amount unknown'
    : `${formatBigIntUnits(tokenMagnitude, 0, 0)} token base units`;
  const txUrl = explorerTxUrl(fill.chain, fill.txHash);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-[11px]">
      <span className="w-20 shrink-0 font-semibold">{chainLabel(fill.chain)}</span>
      <span
        className={
          fill.side === 'buy'
            ? 'font-bold uppercase text-emerald-600'
            : 'font-bold uppercase text-rose-600'
        }
      >
        {fill.side}
      </span>
      <Link href={tradePageHref(fill.token, fill.chain)} className="font-mono underline">
        {shortAddress(fill.token)}
      </Link>
      <span className="tabular-nums text-muted-foreground">native leg {nativeText}</span>
      <span className="tabular-nums text-muted-foreground">token leg {tokenText}</span>
      <span className="ml-auto text-muted-foreground">
        {fill.confirmedAtMs === null
          ? 'time unknown'
          : new Date(fill.confirmedAtMs).toLocaleString()}
      </span>
      {txUrl === null ? (
        <span className="font-mono text-muted-foreground">{shortTxHash(fill.txHash)}</span>
      ) : (
        <a href={txUrl} target="_blank" rel="noreferrer" className="font-mono underline">
          {shortTxHash(fill.txHash)}
        </a>
      )}
    </li>
  );
}

function chainLabel(chain: string): string {
  return Object.prototype.hasOwnProperty.call(CHAIN_LABELS, chain)
    ? CHAIN_LABELS[chain as keyof typeof CHAIN_LABELS]
    : chain;
}

function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 10)}...${address.slice(-6)}` : address;
}
