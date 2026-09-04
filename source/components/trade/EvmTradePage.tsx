'use client';

/**
 * EVM trade page (guide WP-108, launch-gate audit §2 step 4).
 *
 * Renders everything the read API actually provides:
 *  - header + stats  → `GET /evm/token`
 *  - chart           → `GET /evm/candles`
 *  - holders         → `GET /evm/holders`
 *  - top traders     → `GET /evm/top-traders`
 *  - live tape + live header updates → SSE `GET /evm/stream`
 *
 * Until 2026-08-06 all four of the lower panels were "not yet available"
 * placeholders while `the ingestion service` was already serving every one of them.
 * The placeholders were honest when written and became a lie when the read
 * API shipped; that is the gap this pass closes.
 *
 * Doctrine, unchanged:
 * - **Absent is never zero, and a missing SURFACE is never an empty widget.**
 *   Each panel has four states — loading, not-found, error, loaded — and none
 *   can be mistaken for another. A blank chart claims "no price history",
 *   which is a different and false statement from "the read failed".
 * - **Nothing waits on the socket to paint.** The header, chart, holders and
 *   traders are all snapshot reads; the stream only adds to them.
 * - **Every money figure goes through the BigInt formatters.**
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';

import {
  nativeSymbolForChain,
  parseEvmTradeHeader,
  resolvePriceDisplay,
  toCardView,
  type EvmCardView,
  type EvmTradeHeader,
} from '@/lib/evm/discoverAdapter';
import type { QuoteDenomination } from '@/components/discover/chainBinding';
import {
  EVM_TOKEN_DECIMALS_NOTE,
  formatAge,
  formatNative,
  formatPrice,
  formatTokenCompact,
  formatWeiUsd,
} from '@/lib/evm/money';
import { applyTradeToCard } from '@/lib/evm/laneState';
import {
  fetchEvmTokenBalance,
  type EvmTokenBalanceRow,
} from '@/lib/evm/tokenBalanceApi';
import { evmTokenUrl } from '@/lib/evm/readApi';
import {
  fetchEvmCandles,
  fetchEvmHolders,
  fetchEvmTopTraders,
  responseMatchesEvmSubject,
  fetchEvmTrades,
  droppedOlderText,
  quoteUnitsWithheldText,
  readHolderCount,
  type EvmCandleSeries,
  type EvmHolderPage,
  type EvmReadResult,
  type EvmTapeResult,
  type EvmTraderBoard,
} from '@/lib/evm/tradeApi';
import { explorerAddressUrl, explorerTxUrl } from '@/lib/evm/explorer';
import { createLiveRefetchScheduler } from '@/lib/evm/liveRefetch';
import { openEvmStream, type EvmStreamStatus } from '@/lib/evm/stream';
import {
  adoptTapePage,
  applyTapeFrame,
  mergeTape,
  type EvmTapeEntry,
  type EvmTapePage,
} from '@/lib/evm/tape';
import {
  EvmTradePanel,
  type EvmSelectedWallet,
  type EvmTokenBalance,
} from '@/components/trade/EvmTradePanel';
import { EvmPriceChart } from '@/components/trade/EvmPriceChart';
import { timeframeFetchPlan, type ChartTimeframe } from '@/components/trade/timeframes';
import { EvmMyFills } from '@/components/trade/EvmMyFills';
import { EvmHoldersPanel } from '@/components/trade/EvmHoldersPanel';
import { EvmTopTradersPanel } from '@/components/trade/EvmTopTradersPanel';
import { EvmTokenHeaderBar } from '@/components/trade/EvmTokenHeaderBar';
import { EvmTradesTable } from '@/components/trade/EvmTradesTable';
import { EvmDevTokensPanel } from '@/components/trade/EvmDevTokensPanel';
import { OrdersTabBody } from '@/components/trade/orders-tab/OrdersTabBody';
import { useAdvancedOrders } from '@/components/trade/orders-tab/useAdvancedOrders';
import { useTradeCapabilities } from '@/components/trade/useTradeCapabilities';
import { advancedModesForChain } from '@/lib/api/trade-capabilities';
import { PanelStack, type StackPanel } from '@/components/discover/layout/PanelStack';
import { RailColumn } from '@/components/trade/RailColumn';
import { useTradePaneHidden } from '@/components/trade/tradePaneVisibility';
import {
  readTradeLayout,
  writeTradeLayout,
  type TradeLayoutScope,
} from '@/lib/state/trade-layout-store';

/** Same override semantics as the discover lanes: unset = same-origin proxy. */
const EVM_INGEST_BASE = process.env.NEXT_PUBLIC_EVM_INGEST_BASE ?? '';

const STAGE_LABELS: Record<EvmCardView['stage'], string> = {
  new: 'New',
  ripening: 'Ripening',
  migrating: 'Migrating',
  graduated: 'Graduated',
};

const CHAIN_LABELS: Record<string, string> = {
  bsc: 'BSC',
  robinhood_chain: 'Robinhood',
};

/** Display timeframe (the Solana chart vocabulary). `timeframeFetchPlan`
 *  maps it to a native server resolution + a client-side fold group, so the
 *  derived 5s/4h/12h/1d timeframes cost no new server surface. */
const DEFAULT_TIMEFRAME: ChartTimeframe = '1m';
const HOLDER_LIMIT = 50;
const TRADER_LIMIT = 25;
const CLOCK_TICK_MS = 1_000;
/**
 * Minimum spacing between activity-driven snapshot refetches (chart, holders,
 * top traders). The stream has no candle/holder frames, so without this the
 * three panels froze at first paint while the tape and header moved live
 * beside them. 5s mirrors the Solana page's snapshot-poll demotion.
 */
const LIVE_REFETCH_MS = 5_000;
/**
 * Default vertical split weights for the left column's chart vs tables panel
 * — the same starting ratio as the Solana page. A drag adjusts them for this
 * mount; persisted in a chain-scoped key so an EVM drag cannot move Solana or
 * the other EVM chain's layout.
 */
const CHART_WEIGHT = 1.15;
const TABLE_WEIGHT = 1;
/** lg breakpoint — above it the page is viewport-locked with a resizable
 *  chart/tables split; below it everything stacks and the page scrolls. */
const LG_QUERY = '(min-width: 1024px)';

/**
 * Tracks the lg breakpoint via matchMedia — a local twin of the Solana
 * `TradePage`'s hook (kept private there; duplicating 12 lines beats putting
 * the sacred file on this diff). Defaults to `true` so SSR and the hydration
 * render both paint the locked desktop layout; a LAYOUT effect corrects to
 * the real value synchronously before the browser paints.
 */
function useIsLgUp(): boolean {
  const [isLgUp, setIsLgUp] = useState(true);
  useLayoutEffect(() => {
    const mql = window.matchMedia(LG_QUERY);
    const onChange = () => setIsLgUp(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isLgUp;
}

type HeaderState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'loaded'; header: EvmTradeHeader; view: EvmCardView };

export interface EvmTradePageProps {
  /** Storage tag: `bsc`, `robinhood_chain` (the route translated the slug). */
  chain: string;
  /** Lowercased 0x address, already validated by the route. */
  address: string;
  /** Injected by tests. Production uses the bound global. */
  fetchImpl?: typeof fetch;
  /** Set false to render without a socket (tests, SSR probes). */
  live?: boolean;
  /**
   * Test seam: seeds the header state so a static render — which runs no
   * effects and therefore never fetches — can exercise the LOADED page.
   * The render tests are `renderToStaticMarkup` (the terminal has no DOM
   * rig), and without this the header, avatar and address rows are
   * unreachable by any test. Production never passes it.
   */
  initialHeader?: EvmTradeHeader;
}

/**
 * Key the stateful page below by the complete market identity.
 *
 * `PersistentEvmTradePane` deliberately survives route changes. Without a
 * keyed child, changing `/trade/<chain>/<address>` first renders the new
 * address with the previous token's header, reserves, typed amount and submit
 * state; the passive subject-reset effect runs only after that paint. Besides
 * showing fabricated history, that transient frame can submit the new address
 * using the old token's sizing inputs. A chain-qualified key makes the subject
 * swap atomic: React discards every market-scoped state cell before the new
 * address can render.
 */
export function EvmTradePage({
  chain,
  address,
  ...props
}: EvmTradePageProps) {
  return (
    <EvmTradeSubjectPage
      key={`${chain}:${address.toLowerCase()}`}
      chain={chain}
      address={address}
      {...props}
    />
  );
}

function EvmTradeSubjectPage({
  chain,
  address,
  fetchImpl,
  live = true,
  initialHeader,
}: EvmTradePageProps) {
  const [state, setState] = useState<HeaderState>(() =>
    initialHeader === undefined
      ? { kind: 'loading' }
      : { kind: 'loaded', header: initialHeader, view: toCardView(initialHeader) },
  );
  // Hidden persistent pane → dormant: the socket closes and the clock stops
  // (the derived reads only re-run on bumps, which stop with the socket).
  // Reveal heals with one refetch below. Default false, so a standalone
  // mount — tests, the pre-pane route — stays fully live.
  const paneHidden = useTradePaneHidden();
  const isLgUp = useIsLgUp();
  const [tableTab, setTableTab] = useState('trades');
  const advancedCapability = useTradeCapabilities();
  const advancedChain = chain === 'bsc' || chain === 'robinhood_chain' ? chain : null;
  const advancedModes = advancedModesForChain(advancedCapability, advancedChain ?? 'bsc');
  const desktopAdvancedModes = isLgUp && advancedChain !== null
    ? advancedModes
    : { limit: false, recurring: false };
  const advancedOrdersEnabled =
    desktopAdvancedModes.limit || desktopAdvancedModes.recurring;
  const advancedOrders = useAdvancedOrders(
    address,
    tableTab === 'orders' && !paneHidden,
    { chain: advancedChain ?? 'bsc', enabled: advancedOrdersEnabled },
  );
  // Chart/tables split weights (PanelStack is controlled), persisted per chain.
  const [layoutSizes, setLayoutSizes] = useState<Record<string, number>>({});
  const layoutScope: TradeLayoutScope | null = chain === 'bsc'
    ? 'evm:bsc'
    : chain === 'robinhood_chain'
      ? 'evm:robinhood_chain'
      : null;
  useLayoutEffect(() => {
    setLayoutSizes(layoutScope === null ? {} : readTradeLayout(layoutScope).sizes);
  }, [layoutScope]);
  const commitLayoutSizes = useCallback((sizes: Record<string, number>) => {
    setLayoutSizes(sizes);
    if (layoutScope !== null) writeTradeLayout({ sizes }, layoutScope);
  }, [layoutScope]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(DEFAULT_TIMEFRAME);
  // The NATIVE resolution the server is asked for; aggregated timeframes
  // (5s/4h/12h/1d) share a base fetch and fold client-side, so switching
  // among them never refetches or blanks the chart.
  const candlePlan = timeframeFetchPlan(timeframe);
  const [candles, setCandles] = useState<EvmReadResult<EvmCandleSeries> | null>(null);
  const [holders, setHolders] = useState<EvmReadResult<EvmHolderPage> | null>(null);
  const [traders, setTraders] = useState<EvmReadResult<EvmTraderBoard> | null>(null);
  // THE TAPE, in two parts. `tapeRead` is the durable page from
  // `GET /evm/trades`; `liveTape` is the frames that have landed since it was
  // read. They are held apart rather than concatenated into one state because
  // only one of them is replaced by a refetch, and the seam rule between them
  // (`adoptTapePage`) needs to see both.
  const [tapeRead, setTapeRead] = useState<EvmTapeResult | null>(null);
  const [liveTape, setLiveTape] = useState<readonly EvmTapeEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<EvmStreamStatus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Which EVM wallet the trade panel is currently pointed at. Held here (not
  // in the panel) because the token balance that answers "can I sell?" comes
  // from the HOLDERS read this page already owns.
  const [panelWallet, setPanelWallet] = useState<EvmSelectedWallet | null>(null);
  const [authoritativeTokenBalances, setAuthoritativeTokenBalances] = useState<
    readonly EvmTokenBalanceRow[] | null
  >(null);
  const [tokenBalanceReadWhy, setTokenBalanceReadWhy] = useState(
    'Your token balances are loading.',
  );
  // Bumped when the stream says this token changed in a way a snapshot read
  // must be redone for (a stage move, or a reorg retraction).
  const [refetchToken, bumpRefetch] = useReducer((count: number) => count + 1, 0);
  // Any catalog-changing chain frame invalidates the creator page. Replacing
  // page one (rather than merging it) is what removes reorg tombstones.
  const [creatorCatalogEpoch, bumpCreatorCatalog] = useReducer((count: number) => count + 1, 0);
  const handleOrderTransition = useCallback(() => {
    bumpRefetch();
    globalThis.dispatchEvent(new Event('listen:evm-order-transition'));
  }, []);
  // Bumped — debounced, at most once per LIVE_REFETCH_MS — while TRADE frames
  // for this token are arriving. The stream vocabulary has no candle, holder
  // or trader frames, so without this the chart, holders and top-traders
  // panels stayed frozen at first paint on an active token while the price,
  // stats and tape moved live beside them — and the stale holders read is
  // what sizes the sell percentage presets. Kept separate from
  // `refetchToken`, which also re-reads the header and tape.
  const [liveRefetchToken, bumpLiveRefetch] = useReducer((count: number) => count + 1, 0);
  const liveRefetchRef = useRef<ReturnType<typeof createLiveRefetchScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createLiveRefetchScheduler({
      intervalMs: LIVE_REFETCH_MS,
      onRefetch: bumpLiveRefetch,
    });
    liveRefetchRef.current = scheduler;
    return () => {
      scheduler.dispose();
      liveRefetchRef.current = null;
    };
  }, []);

  const doFetch = useMemo(
    () => fetchImpl ?? globalThis.fetch.bind(globalThis),
    [fetchImpl],
  );
  const readArgs = useMemo(
    () => ({ apiBase: EVM_INGEST_BASE, chain, address, fetchImpl: doFetch }),
    [chain, address, doFetch],
  );

  useEffect(() => {
    const controller = new AbortController();
    setAuthoritativeTokenBalances(null);
    setTokenBalanceReadWhy('Your token balances are loading.');
    void fetchEvmTokenBalance(chain, address, {
      signal: controller.signal,
      fetchImpl: doFetch,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind !== 'ok') {
        setAuthoritativeTokenBalances(null);
        setTokenBalanceReadWhy(
          result.kind === 'reauth'
            ? 'Sign in again to read your token balances.'
            : 'Your token balances could not be read.',
        );
        return;
      }
      setAuthoritativeTokenBalances(result.wallets);
    });
    return () => controller.abort();
  }, [address, chain, doFetch, refetchToken, liveRefetchToken]);

  // THE SUBJECT RESET. The app router reuses this component instance across
  // `/trade/<chain>/<addr>` navigations (the route has no `key`), so nothing
  // remounts when the address changes — and the tape is accumulated state, not
  // a fetch result. Without this, opening another token from the search modal
  // renders the PREVIOUS token's fills under the new token's header, which is
  // a fabricated trade history, not merely a stale panel. Reset here rather
  // than inside `loadHeader`, so a REFETCH (a stage frame, a reconnect) does
  // not also wipe it.
  useEffect(() => {
    setLiveTape([]);
    setTapeRead(null);
    setState({ kind: 'loading' });
  }, [chain, address]);

  const loadHeader = useCallback(
    async (signal?: AbortSignal) => {
      let response: Response;
      try {
        response = await doFetch(evmTokenUrl(EVM_INGEST_BASE, chain, address), { signal });
      } catch {
        if (signal?.aborted) return;
        setState({ kind: 'error' });
        return;
      }
      // A test seam or non-conforming fetch can resolve after abort. Status
      // branches mutate just as much state as the success branch, so the
      // subject guard belongs before all of them.
      if (signal?.aborted) return;
      if (response.status === 404) {
        // The server distinguishes "unknown on THIS chain" from an empty card
        // (the backend source: None → 404, never an empty object). Honor that here.
        setState({ kind: 'not-found' });
        return;
      }
      if (!response.ok) {
        setState({ kind: 'error' });
        return;
      }
      try {
        const body: unknown = await response.json();
        // Shape-checked, not cast. `toCardView` dereferences the card
        // immediately, so a 200 carrying an error envelope (or a null) threw
        // inside render instead of landing in the error state this page
        // already knows how to explain.
        const header = parseEvmTradeHeader(body);
        if (header === null || !responseMatchesEvmSubject(header, chain, address)) {
          if (!signal?.aborted) setState({ kind: 'error' });
          return;
        }
        if (signal?.aborted) return;
        setState({ kind: 'loaded', header, view: toCardView(header) });
      } catch {
        if (!signal?.aborted) setState({ kind: 'error' });
      }
    },
    [chain, address, doFetch],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadHeader(controller.signal);
    return () => controller.abort();
  }, [loadHeader, refetchToken]);

  // Clearing a panel back to its loading state is keyed on the SUBJECT
  // (token, resolution) and deliberately NOT on `refetchToken`. A refetch is
  // triggered by a stage frame or by any stream resnapshot — including the
  // ordinary reconnect after a transport blip — and blanking the whole page
  // on a reconnect contradicts this file's own "nothing waits on the socket
  // to paint" rule. The stale panel stays up until its replacement lands.
  useEffect(() => {
    setCandles(null);
  }, [readArgs, candlePlan.resolution]);
  useEffect(() => {
    setHolders(null);
  }, [readArgs]);
  useEffect(() => {
    setTraders(null);
  }, [readArgs]);

  // Chart. Re-reads on a resolution change, on a stream-signalled change (an
  // unrefetched chart after a reorg would keep drawing the replaced branch),
  // AND on the debounced live bump — the stream carries no candle frames, so
  // this is the only way the chart tracks a token that is actively trading.
  useEffect(() => {
    const controller = new AbortController();
    void fetchEvmCandles({
      ...readArgs,
      resolution: candlePlan.resolution,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setCandles(result);
      },
      () => {
        if (!controller.signal.aborted) setCandles({ kind: 'error', status: null });
      },
    );
    return () => controller.abort();
  }, [readArgs, candlePlan.resolution, refetchToken, liveRefetchToken]);

  // Holders re-read on the live bump too — this page is not only a display:
  // `resolveSellBalance` feeds the sell presets from it, and a holders
  // snapshot frozen at first paint sized "100%" against a pre-buy balance.
  useEffect(() => {
    const controller = new AbortController();
    void fetchEvmHolders({
      ...readArgs,
      limit: HOLDER_LIMIT,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setHolders(result);
      },
      () => {
        if (!controller.signal.aborted) setHolders({ kind: 'error', status: null });
      },
    );
    return () => controller.abort();
  }, [readArgs, refetchToken, liveRefetchToken]);

  // THE PUBLIC TAPE. Re-read on a stream-signalled change for the same reason
  // the chart is: after a reorg the replaced branch's trades must not stay on
  // screen. Deliberately NOT cleared to `null` on a refetch — the stale page
  // stays up until its replacement lands, same as the panels above.
  useEffect(() => {
    const controller = new AbortController();
    void fetchEvmTrades({ ...readArgs, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setTapeRead(result);
        // Reconcile the live edge against what the page now provably carries,
        // so a trade that arrived BOTH ways is printed once. Rows the page
        // does not contain survive — the seam does not blank the live edge.
        if (result.kind === 'ok') {
          setLiveTape((entries) => adoptTapePage(entries, result.value));
        }
      },
      () => {
        if (!controller.signal.aborted) setTapeRead({ kind: 'error', status: null });
      },
    );
    return () => controller.abort();
  }, [readArgs, refetchToken]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchEvmTopTraders({
      ...readArgs,
      limit: TRADER_LIMIT,
      signal: controller.signal,
    }).then(
      (result) => {
        if (!controller.signal.aborted) setTraders(result);
      },
      () => {
        if (!controller.signal.aborted) setTraders({ kind: 'error', status: null });
      },
    );
    return () => controller.abort();
  }, [readArgs, refetchToken, liveRefetchToken]);

  // The live socket. Only frames for THIS token move anything on this page.
  const tokenRef = useRef(address);
  tokenRef.current = address;
  // The page the seam rule consults, read through a ref so a new snapshot does
  // not tear down and re-open the socket.
  const tapePage: EvmTapePage | null =
    tapeRead !== null && tapeRead.kind === 'ok' ? tapeRead.value : null;
  const tapePageRef = useRef<EvmTapePage | null>(tapePage);
  tapePageRef.current = tapePage;
  useEffect(() => {
    if (!live || paneHidden) return;
    if (typeof globalThis.EventSource !== 'function') return;
    const handle = openEvmStream({
      chain,
      apiBase: EVM_INGEST_BASE,
      handlers: {
        onFrame: (frame) => {
          setLiveTape((entries) =>
            applyTapeFrame(entries, frame, tokenRef.current, tapePageRef.current),
          );
          if (frame.kind === 'created' || frame.kind === 'stage' || frame.kind === 'reverted') {
            bumpCreatorCatalog();
          }
          if (frame.token !== tokenRef.current) return;
          // LIVE STATS, not just a live price line. Before this, a trade frame
          // moved the price and left Volume / Trades / Buys / Sells frozen at
          // their snapshot values until an unrelated stage or reorg frame
          // forced a refetch — a header that is visibly wrong for minutes on
          // an active token. The arithmetic is the SAME function the discover
          // store uses (`applyTradeToCard`), so the two surfaces cannot drift:
          // counts advance only on a complete history, volume is left
          // unchanged rather than reset when a cost will not parse, and
          // reserves are never accumulated client-side.
          if (frame.kind === 'trade') {
            const payload =
              typeof frame.payload === 'object' && frame.payload !== null
                ? (frame.payload as Record<string, unknown>)
                : null;
            const side = payload?.['side'];
            const amount = payload?.['amount'];
            const cost = payload?.['cost'];
            if (
              (side === 'buy' || side === 'sell') &&
              typeof amount === 'string' &&
              typeof cost === 'string'
            ) {
              setState((current) => {
                if (current.kind !== 'loaded') return current;
                const header = applyTradeToCard(current.header, { side, amount, cost });
                if (header === current.header) return current;
                return { kind: 'loaded', header, view: toCardView(header) };
              });
            }
          }
          // A trade frame moves surfaces the stream cannot patch — candles,
          // holder balances, trader sums have no frame kinds — so it arms the
          // debounced snapshot re-read. The frame itself already updated the
          // tape and header above; this is catch-up for the derived reads.
          if (frame.kind === 'trade') liveRefetchRef.current?.noteTradeFrame();
          // A stage move or a retraction changes the header, the chart and the
          // leaderboards at once. The frame carries only the delta, so the
          // honest response is to re-read what the server computed rather
          // than to patch four derived surfaces by hand.
          if (frame.kind === 'stage' || frame.kind === 'reverted') bumpRefetch();
        },
        onResnapshot: () => {
          bumpRefetch();
          bumpCreatorCatalog();
        },
        onStatus: setStreamStatus,
      },
    });
    return () => handle.close();
  }, [chain, live, paneHidden]);

  useEffect(() => {
    if (paneHidden) return;
    const timer = globalThis.setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => globalThis.clearInterval(timer);
  }, [paneHidden]);

  // REVEAL HEAL. While hidden the socket is closed, so the frames that would
  // have bumped the reads never arrived — every panel is honestly stale. One
  // refetch on reveal brings header, chart, tape, holders and traders current
  // (mirrors the Solana pane's reveal-heals-with-one-snapshot rule).
  const wasHiddenRef = useRef(false);
  useEffect(() => {
    if (paneHidden) {
      wasHiddenRef.current = true;
      return;
    }
    if (wasHiddenRef.current) {
      wasHiddenRef.current = false;
      bumpRefetch();
    }
  }, [paneHidden]);

  // Memoized because the clock above re-renders this component every second
  // and the merge sorts up to `TAPE_CAP` rows. Neither input changes on a tick.
  const tape = useMemo(() => mergeTape(tapePage, liveTape), [tapePage, liveTape]);

  const chainLabel = CHAIN_LABELS[chain] ?? chain;
  const nativeSymbol = nativeSymbolForChain(chain);

  if (state.kind === 'loading') {
    return (
      <main className="p-6 text-sm text-muted-foreground" data-testid="evm-trade-loading">
        Loading {chainLabel} token…
      </main>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <main className="p-6 text-sm" data-testid="evm-trade-not-found">
        <p className="font-semibold">Token not found on {chainLabel}.</p>
        <p className="mt-1 text-muted-foreground">
          <span className="font-mono">{address}</span> is not known to this
          chain&apos;s indexer. It may not exist on {chainLabel}, or it has not
          been observed yet.
        </p>
        <p className="mt-3">
          <Link href="/discover" className="underline">
            Back to Discover
          </Link>
        </p>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="p-6 text-sm" data-testid="evm-trade-error">
        <p className="font-semibold">Couldn&apos;t load this token.</p>
        <p className="mt-1 text-muted-foreground">
          The {chainLabel} read API did not answer. This says nothing about
          whether the token exists.
        </p>
        <button
          type="button"
          onClick={() => bumpRefetch()}
          className="mt-3 rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
        >
          Retry
        </button>
      </main>
    );
  }

  const { view, header } = state;
  /* THE UNIT THE MONEY LEG IS ACTUALLY IN. `resolveQuote` answers the chain's
     ticker only when the wire said the quote is native, a shortened contract
     address when it named a quote token, and `null` when it said nothing — in
     which case the label below says "quote token" rather than asserting one.
     Never `nativeSymbol`, which is a fact about the CHAIN and not about this
     market. */
  const quoteUnit = view.quote.unitSymbol ?? 'quote token';
  const newestTrade = tape[0];
  // The selected wallet's balance of THIS token, from the holder page this
  // component already reads. Every "unknown" branch names WHICH unknown it is,
  // and the panel must not offer a "100%" preset over a number nobody measured.
  //
  // THE RULE USED TO BE SPELLED OUT HERE and it guarded `holders === null` and
  // a missing row but not `page.partial` — the case that spends real money. A
  // partial holder page's balances are FLOORS (every debit against a wallet
  // funded before our cursor clamps to zero), so handing one over as
  // `kind: 'known'` let "100% Sell" take a percentage of a lower bound and
  // submit it as the whole position. It now lives beside the other refusal
  // guarding the same arithmetic; see `lib/evm/sizing.ts`.
  const tokenBalance: EvmTokenBalance = (() => {
    if (panelWallet === null) {
      return { kind: 'unknown', why: 'Select a wallet to read its token balance.' };
    }
    const row = authoritativeTokenBalances?.find(
      (wallet) =>
        wallet.walletAccountId === panelWallet.walletAccountId
        && wallet.walletPubkey === panelWallet.walletAddress.toLowerCase(),
    );
    if (row?.status === 'ok' && row.balanceBaseUnits !== null) {
      return { kind: 'known', baseUnits: row.balanceBaseUnits };
    }
    return {
      kind: 'unknown',
      why: row === undefined && authoritativeTokenBalances !== null
        ? 'The selected wallet is not available on this chain.'
        : row === undefined
          ? tokenBalanceReadWhy
          : 'Your token balance could not be read from the chain.',
    };
  })();
  // Last-trade price beats the curve-implied one; both are exact ratios. Now
  // that the tape carries history, this is populated on first paint from the
  // newest stored trade rather than only after a frame arrives.
  //
  // GATED ON THE QUOTE, like the two view-side price legs it outranks. A
  // trade's `cost` is a count of QUOTE base units, so this ratio is only a
  // price in whole quote tokens when the quote is native — see `toCardView`
  // for why no relabelling rescues it. Ungated, this leg would have won
  // `resolvePriceDisplay`'s ordering on every stock-quoted token with a tape
  // and printed the one figure the other two just withheld.
  const livePrice =
    newestTrade === undefined || !view.quote.isNative
      ? null
      : formatPrice(newestTrade.cost, newestTrade.amount, 6, view.tokenDecimals);
  /* THE WIRE'S OWN PRICE SITS BETWEEN THE TWO, and this page skipped it: the
     line read `livePrice ?? view.curvePriceText`, so a GRADUATED token showed
     no price at all — its curve reserves are absent by design (the curve
     stopped being the market) and the tape can be empty on first paint, while
     `priceNativeNum`/`priceNativeDen` sat parsed and unread in the header
     response. The discover card had the full chain all along, which is why the
     resolution now lives in ONE shared function instead of being spelled out
     on each surface. */
  const { text: price, sourceText: priceSourceText } = resolvePriceDisplay({
    livePriceText: livePrice,
    wirePriceText: view.wirePriceText,
    curvePriceText: view.curvePriceText,
    priceBasisText: view.priceBasisText,
    reserveBasisText: view.reserveBasisText,
  });

  /* THE ORACLE RATE THE TAPE'S USD LEG IS PRICED AT — the same basis ladder
     the chart resolves (`chartAdapter.resolveEvmChartBasis`): the producer's
     own freshness verdict gates it (`usdUnavailableReason` present means the
     oracle is absent or stale, and this page does not overrule it), and a
     non-native money leg has no native/USD rate to price with at all. `null`
     renders the per-row em dash — stale/absent is never zero. */
  const tapeUsdRateNano =
    view.quote.isNative &&
    header.usdUnavailableReason === undefined &&
    typeof header.nativeUsdNano === 'string'
      ? header.nativeUsdNano
      : null;
  /* The Holders tab count — only an EXACT measurement earns the label. A
     partial fold's observed figure is a lower bound and the panel inside the
     tab already says "at least N"; stamping it on the tab as `(N)` would ship
     a measurement nobody made. */
  const holderPage = holders !== null && holders.kind === 'ok' ? holders.value : null;
  const holderCountForTab =
    holderPage === null
      ? null
      : (() => {
          const count = readHolderCount(holderPage);
          return count.kind === 'exact' ? count.count : null;
        })();

  /* THE SOLANA LAYOUT SKELETON (trade-page unification, phase 2). The page
     used to be a single scrolling 1100px column; it now composes the same
     regions as `TradePage`: a token header bar, a resizable chart/tables
     PanelStack on the left, and a fixed rail (trade panel + analytics) on the
     right — viewport-locked on lg+, stacked and scrolling below. Every
     section, sentence and testid of the old column survives; only the frame
     moved. */
  const headerBar = (
    <EvmTokenHeaderBar
      view={view}
      chain={chain}
      chainLabel={chainLabel}
      stageLabel={STAGE_LABELS[view.stage]}
      priceText={price === null ? null : `${price} ${quoteUnit}`}
      priceSourceText={priceSourceText}
      streamStatus={streamStatus}
      live={live}
    />
  );

  /* The rail's analytics panel — the slot Solana gives `AnalyticsPanel`.
     Hosts the identity/context notes that used to sit under the old header,
     then the stats and signals sections, unchanged. */
  const analyticsSection = (
    <section
      aria-label="Token analytics"
      data-testid="evm-trade-analytics"
      className="panel flex min-h-0 w-full flex-col gap-4 overflow-y-auto p-3"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="break-all font-mono">{view.address}</span>
          {view.marketVenue !== null && (
            <span
              className="font-mono"
              data-testid="evm-trade-market-venue"
              data-market-venue={view.marketVenue}
            >
              {view.marketVenue}
            </span>
          )}
        </div>
        {view.creator !== undefined && (
            <div className="break-all text-xs text-muted-foreground">
              Creator: <span className="font-mono">{view.creator}</span>
            </div>
          )}
          {view.tradeBlockedReason === 'migrating' && (
            /* Same explanation the lanes use: both sides freeze in
               four.meme's keeper-async gap, and a frozen market with no
               explanation reads as breakage. */
            <p className="mt-1 rounded bg-muted px-2 py-1 text-xs">
              Liquidity is migrating to the AMM; both sides are paused until
              the pool is live.
            </p>
          )}
          {view.stage === 'graduated' && (
            /* Graduated tokens have NO reserves on the wire on purpose: the
               curve stopped being the market and the AMM pool is a feed this
               process does not fold. Saying so is what keeps the em dashes
               below from reading as a broken page. */
            <p
              className="mt-1 rounded bg-muted px-2 py-1 text-xs"
              data-testid="evm-trade-graduated-note"
            >
              Graduated: liquidity moved to the AMM pool. Curve reserves are no
              longer a measurement of this market, so they are shown as
              unavailable rather than as their final frozen values.
            </p>
          )}
      </div>

        {/* What the read API measures today. Absent is not zero: partial
            history omits counts, unproven curves omit reserves, and both
            render as em dashes — never as fabricated zeros. */}
        <section aria-label="Token stats" className="rounded-lg border p-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {/* THE UNIT IS THE QUOTE'S, NOT THE CHAIN'S. These three labels
                read `nativeSymbolForChain` and so stamped "(ETH)" on figures
                that are counts of a stock token's base units for roughly half
                of live Pons v2 launches — the wrong unit entirely, on a figure
                that was itself rendered at an unverified scale. `quote` is the
                field that knows, and it declines to name a unit at all when
                the wire told us nothing (`resolveQuote`). */}
            <Stat label={`Reserve (${quoteUnit})`} value={view.reserveNativeText} />
            <Stat label="Reserve (token)" value={view.reserveTokenText} />
            <Stat label={`Volume (${quoteUnit})`} value={view.volumeNativeText} />
            {/* MARKET CAP, which this page never showed at all. The native
                figure is the one we hold whenever `decimals` and `totalSupply`
                both arrived; the USD one only when the oracle was fresh AND
                the money leg is native. Neither is derived from the other. */}
            <Stat label={`Market cap (${quoteUnit})`} value={view.marketCapNativeText} />
            <Stat label="Market cap (USD)" value={view.marketCapUsdText} />
            <Stat label="Volume (USD)" value={view.volumeUsdText} />
            {/* TOTAL SUPPLY, which the wire has carried all along
                (`EvmDiscoverCard.totalSupply`) and which was TYPED here and
                never parsed into the view — so it arrived on every response
                and died in the adapter. It is also the denominator the market
                cap above is built from, which made its absence odd: the page
                showed the product and withheld one of its factors. */}
            <Stat label="Total supply" value={view.totalSupplyText} />
            <Stat
              label="Trades"
              value={view.tradeCount === null ? null : String(view.tradeCount)}
            />
            <Stat
              label="Buys"
              value={view.buyCount === null ? null : String(view.buyCount)}
            />
            <Stat
              label="Sells"
              value={view.sellCount === null ? null : String(view.sellCount)}
            />
          </dl>
          {!view.historyComplete && (
            <p className="mt-2 text-xs text-muted-foreground">
              Partial history: this token was first observed after some of its
              activity, so counts are unavailable rather than zero.
            </p>
          )}
          {view.quoteUnitsUnavailableText !== null && (
            /* WHY THE THREE FIGURES ABOVE ARE EM DASHES on a stock-quoted
               market. Without this the omission reads as "this token has no
               depth and no volume", which is the opposite of true — it has
               both, denominated in something this wire cannot scale. */
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-quote-units-unavailable"
            >
              {view.quoteUnitsUnavailableText}
            </p>
          )}
          {/* WHAT THE RESERVE NUMBERS ARE. The wire has always carried
              `reserveBasis` (the backend source) and the
              terminal dropped it, so a bonding curve and a real AMM pair
              rendered under one identical "Reserve" label — two different
              claims about how tradeable that depth is. */}
          {view.reserveBasisText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-reserve-basis"
            >
              Reserves are {view.reserveBasisText}.
            </p>
          )}
          {view.reserveNativeText === null && view.reserveTokenText === null && (
            /* NO RESERVES AT ALL. The wire omits the keys rather than sending
               zero, and it does so for two very different reasons it does not
               distinguish: a token nobody has traded, and a
               concentrated-liquidity pool whose depth the fold deliberately
               WITHHOLDS (the backend source). Since the page cannot
               tell which, it says both — and above all says this is unknown
               rather than empty. */
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-reserves-unknown"
            >
              Depth for this token is <strong>unknown, not zero</strong>. Either
              no trade has proved its curve yet, or it trades on a
              concentrated-liquidity pool whose true depth this indexer does not
              publish. The order engine reads live reserves itself when you
              trade.
            </p>
          )}
          {/* WHERE THE DOLLAR FIGURES COME FROM. The wire has always carried
              the oracle pair, its rate and its publish time
              (`nativeUsdNano` / `nativeUsdPublishTimeSec` / `nativeUsdPair`)
              and the terminal parsed none of them, so every USD number above
              arrived with no way to see what produced it. A rate published
              four minutes ago and one published four hours ago are different
              claims, and a figure a user cannot audit is one they have to take
              on faith. */}
          {view.nativeUsdBasisText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-usd-basis"
            >
              {view.nativeUsdBasisText}
            </p>
          )}
          {view.usdUnavailableText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-usd-unavailable"
            >
              {view.usdUnavailableText}
            </p>
          )}
          {/* NO PRICE COULD BE DERIVED AT ALL (`price_underivable`), which is
              why every market figure above is an em dash. `toCardView` has
              always computed this sentence and no surface rendered it, so the
              page showed a column of dashes with no account of itself — the
              same defect class as the fields this pass restored, one level up:
              not a missing number but the missing REASON for all of them. */}
          {view.marketDataUnavailableText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-market-data-unavailable"
            >
              {view.marketDataUnavailableText}
            </p>
          )}
          {/* The decimals assumption, DISCLOSED rather than merely commented —
              and ONLY when it is actually an assumption.

              This printed unconditionally, and its text asserted that the
              indexer does not report decimals. That stopped being true:
              the backend source emits `decimals` whenever the
              identity resolver measured it, `toCardView` reads it, and every
              token-scaled figure on this page is now rendered at that scale.
              A disclosure that fires when there is nothing to disclose trains
              the reader to ignore it, which costs exactly the tokens where it
              IS true. `tokenDecimalsAssumed` is the flag that says which case
              this is — it had no reader until now. */}
          {view.tokenDecimalsAssumed && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-decimals-note"
            >
              {EVM_TOKEN_DECIMALS_NOTE}
            </p>
          )}
          {/* WHY an identity field is missing, not merely THAT it is.
              `identityAbsent` has always been on the wire — the producer
              records `reverted` / `unimplemented` / `undecodable` / `empty` /
              `unavailable` per field — and the terminal parsed it into a type
              and gave it zero readers, so an unnamed token rendered as a
              shortened address and an unmeasured scale rendered as the note
              above, both with no account of themselves.

              It matters most for `decimals`, and concretely: `unavailable`
              means nobody has called the contract yet and a reload may fix it,
              while `reverted` means the contract will never answer and the
              trade panel's refusal to size a sell is permanent. Those are
              different situations and a user deciding whether to wait needs to
              know which one they have. */}
          {view.identityAbsentSummary !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-identity-absent"
            >
              {view.identityAbsentSummary}
            </p>
          )}
          <p className="mt-2 break-all text-[10px] text-muted-foreground">
            Last block {header.lastBlockNumber}{' '}
            <span className="font-mono">{header.lastBlockHash}</span>
          </p>
        </section>

        {/* SIGNALS — the momentum score, the security shares, and the
            creator's launch tally.

            All three have been on the wire since `insert_market_fields` was
            wired (`trade_header_with_market` calls the same three inserters
            the discover card does) and NONE of them had a reader. Measured,
            shipped, discarded.

            They are one section and not three because they share one rule and
            it is the sharpest one on this page: every figure here is OMITTED
            rather than zeroed when it was not measured, so every absence gets
            its own reason and no absence may render as a number. A `0% dev` on
            a token nobody classified is a fabricated safety claim, and a `0.0`
            score is the worst reading rather than no reading. */}
        <section aria-label="Token signals" className="rounded-lg border p-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {/* `toFixed(1)` is the producer's own rendering, restated: the
                wire ships `scoreTenths` as an integer precisely so the
                rounding is explicit, and `EvmCardView.score` is that integer
                over ten. */}
            <Stat
              label="Score"
              value={view.score === null ? null : view.score.toFixed(1)}
            />
            <Stat label="Dev holdings" value={formatSupplyShare(view.devHoldingsPct)} />
            <Stat label="Sniper holdings" value={formatSupplyShare(view.sniperHoldingsPct)} />
            <Stat label="Bundler holdings" value={formatSupplyShare(view.bundlerHoldingsPct)} />
            {/* TOP-HOLDER CONCENTRATION. It fails INDEPENDENTLY of the three
                shares above — an unanchored token has no dev share and still
                has a largest holder — so it is not gated on their reason. */}
            <Stat label="Top holder" value={formatSupplyShare(view.topHolderPct)} />
            {/* THE CROWN BADGE'S NUMBERS in their long form. Rendered only
                when the fold HAS a record: the producer refuses to serve a
                `{created: 0, migrated: 0}`, because that shape once read a
                serial rugger with forty launches as a first-time dev. */}
            <Stat
              label="Dev launches migrated"
              value={
                view.creatorStats === null
                  ? null
                  : `${view.creatorStats.migrated} / ${view.creatorStats.created}`
              }
            />
          </dl>
          {view.scoreUnavailableText !== null && (
            /* THE REFUSAL, AS A REFUSAL. The score is not missing here, it is
               DECLINED — most often because the market's money leg is a stock
               token and scoring its volume against a native formula would be
               wrong by the whole exchange rate. An unexplained dash presents a
               deliberate decision as an outage. */
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-score-unavailable"
            >
              {view.scoreUnavailableText}
            </p>
          )}
          {view.holdingsUnavailableText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-holdings-unavailable"
            >
              {view.holdingsUnavailableText}
            </p>
          )}
          {view.holdingsQualifierText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-holdings-qualifier"
            >
              {view.holdingsQualifierText}
            </p>
          )}
          {view.creatorRecordUnavailableText !== null && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="evm-trade-creator-unavailable"
            >
              {view.creatorRecordUnavailableText}
            </p>
          )}
        </section>
    </section>
  );

  /* The chart panel — the left column's top region, same slot as Solana's
     chart section. `EvmPriceChart` fills the panel on lg+ and keeps its
     fixed height in the stacked layout. */
  const chartSection = (
    <section className="panel flex min-h-[var(--chart-h-min)] min-w-0 flex-col overflow-hidden p-3 lg:h-full lg:min-h-0">
      <ReadPanel
        result={candles}
        title="Chart"
        render={(series) => (
          /* The REAL Solana chart (phase 1 of the trade-page unification),
             replacing the static-SVG `EvmCandleChart` fork: lightweight-
             charts with zoom/pan/crosshair, `timeframes.ts` client
             aggregation, a tape-synthesized provisional tip and the
             append-only settled-bar renderer. The basis (USD MC → USD →
             native → bare ratio) is resolved from the wire and disclosed
             beside the chart — see `EvmPriceChart`. */
          <EvmPriceChart
            series={series}
            header={header}
            view={view}
            chain={chain}
            address={address}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            /* The merged tape (page + live edge): trade frames advance the
               chart tip between candle refetches — the stream has no candle
               frames, so this is what makes the chart live rather than
               5s-debounce-only. */
            tape={tape}
            refetchEpoch={refetchToken}
          />
        )}
      />
    </section>
  );

  /* The tabbed tables panel — the left column's bottom region, the exact
     visual frame of Solana's `TradesTable` with the page's existing EVM
     surfaces as tab bodies (see `EvmTradesTable` for why it is an exact-frame
     rather than a reuse). Every fetch and honest-state decision stays here. */
  const tablesSection = (
    <EvmTradesTable
      tradeCount={tapePage?.total ?? null}
      holderCount={holderCountForTab}
      onActiveTabChange={setTableTab}
      orderCount={advancedOrdersEnabled ? advancedOrders.openCount : undefined}
      trades={
        <EvmTradeTape
          entries={tape}
          read={tapeRead}
          liveCount={liveTape.length}
          quote={view.quote}
          tokenDecimals={view.tokenDecimals}
          usdRateNano={tapeUsdRateNano}
          nowMs={nowMs}
          live={live}
          chain={chain}
        />
      }
      fills={
        /* The user's OWN fills, from `GET /api/v1/evm/trade/fills` — its own
           tab so it can never be confused with the market tape beside it.
           `refetchToken` is the page's existing post-order bump, so a fill
           that just confirmed appears without a manual refresh. */
        <EvmMyFills
          chain={chain}
          address={address}
          nativeSymbol={nativeSymbol}
          /* MEASURED decimals or null — the fills route serves no scale of
             its own, and the render-time 18 fallback must not reach a figure
             that claims to be the user's own trade size. */
          tokenDecimals={view.measuredTokenDecimals}
          refetchToken={refetchToken}
        />
      }
      holders={
        <ReadPanel
          result={holders}
          title="Holders"
          render={(page) => (
            <EvmHoldersPanel
              page={page}
              tokenDecimals={view.tokenDecimals}
              chain={chain}
              /* Base units, from the header the page already read — the
                 denominator for the supply-% column and the top-10 bar. */
              totalSupply={header.totalSupply ?? null}
            />
          )}
        />
      }
      topTraders={
        <ReadPanel
          result={traders}
          title="Top traders"
          render={(board) => (
            <EvmTopTradersPanel
              board={board}
              quote={view.quote}
              tokenDecimals={view.tokenDecimals}
              chain={chain}
            />
          )}
        />
      }
      devTokens={
        view.creator === undefined ? (
          <div className="flex min-h-32 items-center justify-center px-6 text-center text-xs text-muted-foreground" data-testid="evm-dev-tokens-creator-unknown">
            Creator identity is unavailable, so no launch-history claim can be made.
          </div>
        ) : (
          <EvmDevTokensPanel
            chain={chain}
            creator={view.creator}
            refreshKey={creatorCatalogEpoch}
            fetchImpl={doFetch}
          />
        )
      }
      orders={
        advancedOrdersEnabled && advancedChain !== null ? (
          <OrdersTabBody
            state={advancedOrders}
            pageMint={address}
            pageTokenSymbol={view.ticker}
            chain={advancedChain}
            nativeSymbol={nativeSymbol}
            pageTokenDecimals={view.measuredTokenDecimals}
            quoteDecimals={view.quote.decimals ?? null}
          />
        ) : undefined
      }
    />
  );

  const tradePanelSection = (
    /* `measuredTokenDecimals`, NOT `tokenDecimals` — the latter falls back
       to 18 whenever the wire served no scale, and handing that to the
       ORDER panel is precisely the mis-sizing the prop exists to stop.
       The read surfaces (tape, holders, top traders, header price)
       deliberately take `tokenDecimals`: a figure rendered at a disclosed
       assumption is still worth reading, and the note beside them says
       so. An order is not a figure to read. */
    <EvmTradePanel
      chain={chain}
      address={address}
      tokenSymbol={view.ticker}
      reserveNative={header.reserveQuoteBaseUnits ?? header.reserveNative ?? null}
      reserveToken={header.reserveToken ?? null}
      reserveBasis={header.reserveBasis ?? null}
      curvePriceWord={header.curvePriceWord ?? null}
      lastTrade={
        newestTrade === undefined
          ? null
          : { cost: newestTrade.cost, amount: newestTrade.amount }
      }
      buyable={view.buyable}
      sellable={view.sellable}
      buyBlockedReason={view.buyBlockedReason}
      sellBlockedReason={view.sellBlockedReason}
      marketVenue={view.marketVenue}
      tokenBalance={tokenBalance}
      tokenBalances={authoritativeTokenBalances}
      /* Whether an amount typed into the BUY box is a count of this
         chain's coin at all. On a stock-quoted market it is not, and the
         order wire has no other denomination — see `lib/evm/sizing.ts`. */
      quoteIsNative={view.quote.isNative}
      quoteAssetAddress={view.quote.kind === 'native' ? null : view.quote.address}
      quoteDecimals={view.quote.decimals ?? null}
      quoteSymbol={view.quote.unitSymbol}
      tokenDecimals={view.measuredTokenDecimals}
      tokenDecimalsAbsentText={view.tokenDecimalsAbsentText}
      onWalletChange={setPanelWallet}
      onOrderTransition={handleOrderTransition}
      desktopAdvancedModes={desktopAdvancedModes}
      onAdvancedCreated={advancedOrders.refetch}
    />
  );

  /* lg+: viewport-locked, mirroring `TradePage` — left column is the
     drag-resizable chart/tables PanelStack, right rail is FIXED (trade panel
     on top, analytics filling the rest). Below lg everything stacks in the
     same order as the Solana page and the page scrolls. */
  const leftColumnPanels: StackPanel[] = [
    { id: 'chart', sizing: 'flex', weight: CHART_WEIGHT, content: chartSection },
    { id: 'table', sizing: 'flex', weight: TABLE_WEIGHT, content: tablesSection },
  ];

  if (isLgUp) {
    return (
      <main
        className="mx-auto flex h-[var(--h-app-content)] w-full max-w-[min(2400px,100%)] flex-col gap-[var(--gap-page)] overflow-hidden px-[var(--section-pad-x)] py-[var(--section-pad-y)]"
        data-testid="evm-trade-page"
      >
        {headerBar}
        <div className="flex min-h-0 flex-1 gap-[var(--gap-page)]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <PanelStack
              axis="vertical"
              panels={leftColumnPanels}
              sizes={layoutSizes}
              onSizesChange={commitLayoutSizes}
              handleSize={12}
              className="min-h-0 flex-1"
            />
          </div>
          <RailColumn className="gap-[var(--gap-page)]">
            <div className="flex min-h-0 shrink flex-col overflow-y-auto">{tradePanelSection}</div>
            <div className="flex min-h-0 flex-1">{analyticsSection}</div>
          </RailColumn>
        </div>
      </main>
    );
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[min(2400px,100%)] flex-col gap-[var(--gap-page)] px-[var(--section-pad-x)] py-[var(--section-pad-y)]"
      data-testid="evm-trade-page"
    >
      {headerBar}
      {chartSection}
      {tradePanelSection}
      {tablesSection}
      {analyticsSection}
    </main>
  );
}

/**
 * One derived read's four states, rendered so none can be mistaken for
 * another. `null` is "still in flight" — deliberately distinct from an
 * `ok` with an empty body.
 */
function ReadPanel<T>({
  result,
  title,
  render,
}: {
  result: EvmReadResult<T> | null;
  title: string;
  render: (value: T) => React.ReactNode;
}) {
  if (result === null) {
    return (
      <section
        aria-label={title}
        className="rounded-lg border p-3 text-xs text-muted-foreground"
        data-testid={`evm-panel-loading-${slug(title)}`}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1">Loading…</p>
      </section>
    );
  }
  if (result.kind === 'not-found') {
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
        data-testid={`evm-panel-missing-${slug(title)}`}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1">
          This chain&apos;s indexer does not know this token, so there is
          nothing to show — which is different from showing nothing.
        </p>
      </section>
    );
  }
  if (result.kind === 'error') {
    // VISUALLY distinct from the not-found branch above, not merely worded
    // differently. Both used `border-dashed` + muted text, so a failed read
    // and a token this chain has never seen rendered as the same grey box —
    // and the difference between them is the difference between "there is
    // nothing" and "we do not know", which is the whole doctrine of this
    // page. The destructive tone and the FAILED tag are what make the
    // distinction survive being glanced at.
    return (
      <section
        aria-label={title}
        className="rounded-lg border border-destructive/50 p-3 text-xs text-muted-foreground"
        data-testid={`evm-panel-error-${slug(title)}`}
      >
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          {title}
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
            Failed
          </span>
        </h2>
        <p className="mt-1">
          The read failed
          {result.status === null ? '' : ` (HTTP ${result.status})`}. This says
          nothing about the token — it is not empty, it is unknown.
        </p>
      </section>
    );
  }
  return <>{render(result.value)}</>;
}

/**
 * The token's trade tape — `GET /evm/trades` with the live stream on its
 * newest end.
 *
 * Until 2026-08-07 this was live-only and its heading said "since this page
 * opened", which was honest then: no historical endpoint existed. It does now,
 * so the heading no longer disclaims a limit that is gone — and instead states
 * the limits that are real, which is the whole job of this component:
 *
 * - **The four tiers render as four different things.** `unavailable` is NOT
 *   an empty tape; it is nobody answering, and on an active token an "empty"
 *   rendering would be a straight lie. `cold_empty` IS a measurement — the
 *   store looked and holds nothing — and only that one may say "no trades".
 * - **`historyComplete: false` is stated, with `droppedOlder` sizing it.**
 * - **`total` vs `count` is stated.** The client can see what it is not
 *   showing.
 * - **No infinite scroll.** The server has no cursor — one capped page,
 *   newest first — so there is no "load more" affordance to offer, and
 *   inventing one would promise history the API cannot serve.
 */
export function EvmTradeTape({
  entries,
  read,
  liveCount,
  quote,
  tokenDecimals,
  usdRateNano = null,
  nowMs,
  live,
  chain,
}: {
  entries: readonly EvmTapeEntry[];
  read: EvmTapeResult | null;
  /** Rows that arrived over the socket after the page was read. */
  liveCount: number;
  /** The oracle's nano-USD rate for the USD leg, or `null` when the producer
   *  judged it absent/stale (or the money leg is not native). `null` renders
   *  the per-row em dash — an unpriced leg, never a zero one. */
  usdRateNano?: string | null;
  /** What each row's `cost` is DENOMINATED IN. Was `nativeSymbol: string`,
   *  which is a fact about the chain and not about this market: it stamped
   *  "(ETH)" on figures that are counts of a stock token's base units for
   *  roughly half of live Pons v2 launches. */
  quote: QuoteDenomination;
  /** MEASURED token scale when the wire carried one, the module assumption
   *  otherwise. Threaded rather than defaulted so the page's decimals
   *  disclosure can be honest: hiding the note because `decimals` arrived,
   *  while this figure is still scaled by 18, would be a 10^12 error with
   *  nothing on screen admitting it. */
  tokenDecimals: number;
  nowMs: number;
  live: boolean;
  /** Storage tag, for per-row explorer tx links. Unknown chains link nowhere. */
  chain: string;
}) {
  const page = read !== null && read.kind === 'ok' ? read.value : null;
  return (
    /* Hosted inside the `EvmTradesTable` panel (phase-2 layout), so the frame
       is the panel's: no own border, `.trow` rows below, and the provenance
       strips aligned to the rows' 24px inset. */
    <section aria-label="Trades" data-testid="evm-tape" className="flex min-h-0 flex-col">
      <header className="mb-1 flex flex-wrap items-baseline gap-2 px-6 pt-2">
        <h2 className="text-sm font-semibold">Trades</h2>
        {page !== null && (
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            data-testid="evm-tape-tier"
            data-tier={page.tier}
            title={TIER_TITLES[page.tier]}
          >
            {page.tier}
          </span>
        )}
        {live && liveCount > 0 && (
          <span className="text-[10px] text-muted-foreground">
            +{liveCount} live since this page loaded
          </span>
        )}
      </header>

      <TapeBody
        entries={entries}
        read={read}
        quote={quote}
        tokenDecimals={tokenDecimals}
        usdRateNano={usdRateNano}
        nowMs={nowMs}
        chain={chain}
      />

      {!quote.isNative && entries.length > 0 && (
        /* WHY THE COST COLUMN IS EM DASHES. Without this the tape reads as a
           feed of trades whose size nobody recorded, which is the opposite of
           true — every row's `cost` arrived, in a token whose scale the wire
           does not publish. The token leg beside it is unaffected and is the
           reason the tape is still worth showing at all.

           The CONSEQUENCE only — which token, and that its decimals are
           unpublished, is the stats block's sentence and is not repeated
           here. See `quoteUnitsWithheldText`. */
        <p
          className="mt-2 px-6 text-xs text-muted-foreground"
          data-testid="evm-tape-quote-units-unavailable"
        >
          {quoteUnitsWithheldText('tape')}
        </p>
      )}

      {page !== null && <TapeProvenance page={page} shown={entries.length} />}
    </section>
  );
}

/** The tape's `.trow` grid — inline override, same pattern as the Solana
 *  holder rows' `HOLDER_GRID_STYLE`. */
const TAPE_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: '64px 1.1fr 1.1fr 1.2fr minmax(90px, 0.7fr)',
  columnGap: 18,
};

/** What each tier label means, for the reader who hovers it. */
const TIER_TITLES: Record<EvmTapePage['tier'], string> = {
  fold: 'Served from the indexer’s resident memory — the freshest authority.',
  cold: 'Served from the durable store, which retains 60 days.',
  cold_empty:
    'The durable store was asked and holds no trades for this token. A measurement, not a failure.',
  unavailable:
    'No tier could answer. This is not a statement that the token has no trades.',
};

/**
 * The rows, or the precise reason there are none.
 *
 * Every branch here is a DIFFERENT claim and none may be reachable from
 * another's wording: still asking, the route is not there, the read failed,
 * nobody answered, the store measured nothing, and here are the trades.
 */
function TapeBody({
  entries,
  read,
  quote,
  tokenDecimals,
  usdRateNano,
  nowMs,
  chain,
}: {
  entries: readonly EvmTapeEntry[];
  read: EvmTapeResult | null;
  quote: QuoteDenomination;
  tokenDecimals: number;
  usdRateNano: string | null;
  nowMs: number;
  chain: string;
}) {
  if (entries.length > 0) {
    return (
      /* `.trow` rows — the Solana trades table's row vocabulary (grid, mono,
         hairlines, hover, sticky head), with EVM columns. The grid template
         is overridden inline the same way the Solana holder rows override
         theirs. */
      <div className="flex flex-col">
        <div className="trow trow--head sticky top-0 z-10" style={TAPE_GRID_STYLE}>
          <span>Side</span>
          <span>Total</span>
          <span>Tokens</span>
          <span>Trader</span>
          <span style={{ textAlign: 'right' }}>Age</span>
        </div>
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="trow trow--cv"
            style={TAPE_GRID_STYLE}
            data-testid={`evm-tape-${entry.key}`}
            data-origin={entry.origin}
          >
            <span
              className="font-semibold"
              style={{
                color:
                  entry.side === 'buy'
                    ? 'var(--up, #37c07a)'
                    : 'var(--down, #e05260)',
              }}
            >
              {entry.side === 'buy' ? 'BUY' : 'SELL'}
            </span>
            {/* `cost` IS A COUNT OF QUOTE BASE UNITS. `formatNative` renders
                it at 18 decimals, which is a statement about the chain's own
                coin — true only when the money leg IS that coin. The unit
                label and the FIGURE fall together: relabelling an 18-scaled
                number as NVDA would present an unmeasured scale as a verified
                one. The reason is printed under the table, once, rather than
                on every row. */}
            <span style={{ color: 'var(--ink-1)' }}>
              {!quote.isNative
                ? '—'
                : quote.unitSymbol === null
                  ? (formatNative(entry.cost) ?? '—')
                  : `${formatNative(entry.cost) ?? '—'} ${quote.unitSymbol}`}
              {/* THE USD LEG, priced at the oracle basis the header carries —
                  the chart's basis ladder, one row at a time. An absent or
                  stale rate is a per-row em dash with the reason on hover,
                  never a zero and never a silently reused old rate. Non-native
                  markets have no rate to price with, and their cost cell is
                  already the em dash above. */}
              {quote.isNative && (
                <span
                  className="t-num-sm"
                  style={{ color: 'var(--ink-3)', marginLeft: 6 }}
                  data-testid={`evm-tape-usd-${entry.key}`}
                  title={
                    usdRateNano === null
                      ? 'No fresh native/USD rate is published for this chain, so the dollar leg is unknown — not zero.'
                      : 'Priced at the native/USD oracle rate shown in the stats panel.'
                  }
                >
                  {usdRateNano === null
                    ? '· $—'
                    : `· ${formatWeiUsd(entry.cost, usdRateNano) ?? '$—'}`}
                </span>
              )}
            </span>
            <span style={{ color: 'var(--ink-2)' }}>
              {formatTokenCompact(entry.amount, tokenDecimals) ?? '—'} tokens
            </span>
            <span className="min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
              {/* History rows carry the trader; the live frame envelope does
                  not — an em dash, never a guessed wallet. Unknown chains get
                  inert text, never a guessed explorer URL. */}
              {(() => {
                if (entry.trader === null) return '—';
                const url = explorerAddressUrl(chain, entry.trader);
                const short = `${entry.trader.slice(0, 6)}…${entry.trader.slice(-4)}`;
                if (url === null) {
                  return (
                    <span className="font-mono" title={entry.trader}>
                      {short}
                    </span>
                  );
                }
                return (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono underline-offset-2 hover:underline"
                    data-testid={`evm-tape-trader-${entry.key}`}
                    title={entry.trader}
                  >
                    {short}
                  </a>
                );
              })()}
            </span>
            <span style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
              {/* Unknown block time renders as an em dash, never 1970. The
                  age doubles as the tx link when the row carries a hash
                  (history rows do; live frames do not) — an unknown chain or
                  a missing hash renders plain text, never a guessed URL. */}
              {(() => {
                const age = formatAge(entry.occurredAtMs, nowMs) ?? '—';
                const url =
                  entry.txHash === null ? null : explorerTxUrl(chain, entry.txHash);
                if (url === null) return age;
                return (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                    data-testid={`evm-tape-tx-${entry.key}`}
                    title="View this transaction on the block explorer"
                  >
                    {age} ↗
                  </a>
                );
              })()}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (read === null) {
    return <p className="px-6 py-3 text-xs text-muted-foreground">Loading trades…</p>;
  }

  if (read.kind === 'route-missing') {
    // A 404 here is NOT "no such token" — `/evm/trades` is documented never to
    // 404 (the backend source answers an explicitly `unavailable` page instead).
    // It means the route is not registered on the hop we asked. Saying
    // "no trades" over a missing deployment is the empty-vs-unavailable defect.
    //
    // STILL REACHABLE, and here is exactly when it fires. The api proxy now
    // registers `GET /api/v1/evm/trades/:chain/:address`, which closed the
    // one condition that used to make this the NORMAL state — so it is no
    // longer what a healthy same-origin deployment shows. It remains reachable
    // in two: (1) the same-origin proxy on an api build that predates that
    // registration, i.e. a partially-rolled fleet, which is the live condition
    // for as long as the rollout takes; (2) the direct topology
    // (`NEXT_PUBLIC_EVM_INGEST_BASE`) pointed at an `the ingestion service` build
    // predating its own `/evm/trades` route. Both are version skew, and both
    // are exactly what this copy is for. Delete this branch only when neither
    // hop can serve a build without the route.
    return (
      <p className="px-6 py-3 text-xs text-muted-foreground" data-testid="evm-tape-route-missing">
        The trade-tape endpoint did not answer at this address, so this token’s
        trades are <strong>unknown, not absent</strong>. This is a gap in the
        read path, not a statement about the token.
      </p>
    );
  }

  if (read.kind === 'error') {
    return (
      <p className="px-6 py-3 text-xs text-muted-foreground" data-testid="evm-tape-error">
        The trade tape could not be read
        {read.status === null ? '' : ` (HTTP ${read.status})`}, so it is{' '}
        <strong>unknown, not empty</strong>.
      </p>
    );
  }

  if (read.value.tier === 'unavailable') {
    // THE ONE THAT MUST NEVER LOOK EMPTY. the backend source forces
    // `historyComplete: false` + `stale: true` on this tier precisely so a
    // client can tell; flattening it to "no trades yet" would mislabel a token
    // that may be trading heavily right now.
    return (
      <p className="px-6 py-3 text-xs text-muted-foreground" data-testid="evm-tape-unavailable">
        No tier could answer for this token’s trades, so they are{' '}
        <strong>unknown, not absent</strong>. The indexer’s resident memory did
        not hold it and the durable store did not respond — this token may be
        very active.
      </p>
    );
  }

  // `cold_empty` — the only branch entitled to say there are no trades, and
  // even it says over what window. `fold` with no rows means the resident ring
  // holds none, which is the same kind of measured answer.
  return (
    <p className="px-6 py-3 text-xs text-muted-foreground" data-testid="evm-tape-empty">
      {read.value.tier === 'cold_empty'
        ? 'The durable store was asked and holds no trades for this token in its 60-day retention window.'
        : 'The indexer holds no trades for this token.'}
    </p>
  );
}

/**
 * What this page is NOT showing, stated rather than implied.
 *
 * Rendered even when the tape has rows — especially then, because a full
 * screenful is exactly when a window reads as a whole history.
 */
function TapeProvenance({
  page,
  shown,
}: {
  page: EvmTapePage;
  shown: number;
}) {
  const notes: string[] = [];
  if (page.total > page.count) {
    // `total` is the server's own row count. This is the only thing that tells
    // a reader there is more — there is no cursor to fetch it with.
    notes.push(
      `Showing the newest ${page.count} of ${page.total} trades this indexer holds. There is no pagination on this endpoint yet, so the rest cannot be requested.`,
    );
  }
  if (!page.historyComplete) {
    /* `droppedOlder` IS TWO DIFFERENT QUANTITIES UNDER ONE NAME, and this
       printed one sentence for both. On the resident tier it is the in-memory
       ring's overflow SINCE BOOT (the backend source); on the cold tier it is
       store rows beyond this page (the backend source). So "10 older trades are not
       in this page" was rendered while the real gap was 4,811 — a precise
       number that is precise about the wrong thing. The server cannot be
       changed from here, so the sentence is chosen by the tier instead, and a
       tier the server did not stamp gets one that admits the count is
       tier-relative. */
    const dropped = droppedOlderText(page.droppedOlder, page.tier);
    notes.push(
      dropped
        ?? (page.tier === 'cold'
          ? 'Partial history: the durable store retains 60 days, so this can never be the token’s whole trading life.'
          : 'Partial history: this token was first observed after some of its activity, so earlier trades were never recorded.'),
    );
  }
  if (page.stale) {
    notes.push('This page is flagged stale by the indexer.');
  }
  if (notes.length === 0) return null;
  return (
    <div
      className="mt-2 flex flex-col gap-1 px-6 pb-3 text-[10px] text-muted-foreground"
      data-testid="evm-tape-provenance"
      data-shown={shown}
    >
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

/* `StreamChip`, `TokenAvatar` and `CopyAddressButton` moved to
   `EvmTokenHeaderBar.tsx` with the header they serve (testids intact). */

/**
 * A share of supply as a percent, or `null` to render the unknown mark.
 *
 * ONE decimal, unlike the discover card's whole-percent chips: this page has
 * the room, and a 0.4% dev share and a 0% one are different facts that whole
 * percent collapses. `null` passes straight through to `Stat`'s em dash — the
 * one thing this must never do is turn an unmeasured share into `0%`, which on
 * this row is a positive claim of safety about a token nobody classified.
 */
function formatSupplyShare(pct: number | null): string | null {
  return pct === null ? null : `${pct.toFixed(1)}%`;
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

function slug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-');
}

/** Only the fields this page dereferences before rendering are required. */
export function isTradeHeader(value: unknown): value is EvmTradeHeader {
  return parseEvmTradeHeader(value) !== null;
}
