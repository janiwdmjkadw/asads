import { memo, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, useRef } from 'react';
import { SolscanButton } from '@/components/listen/SolscanButton';
import { Numeral } from '@/components/listen/primitives';
import { ArrowDown, ArrowUp, Crown, Solana } from '@/components/listen/icons/Icons';
import { navigateToToken } from '@/components/listen/navigation';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import { PILL_MARKS } from '@/components/discover/column/Pills';
import { useListenHolders } from '@/lib/api/listen-holders';
import {
  ListenHoldersBody,
  ListenToggleButton,
  readListenViewPref,
  writeListenViewPref,
} from './ListenHolders';
import type { WalletClass } from './useWalletClasses';
import { chartTimeframeSeconds, type ChartTimeframe } from './timeframes';
import { compactAge } from '@/lib/format';
import type { LiveNewPair } from '@/components/discover/useLiveNewPairs';
import type { DevTokenStats } from './useDevTokens';
import type { MockTrade } from './mockTrade';
import type { TokenHolder, TokenTopTrader } from './types';
import { FundingCell } from './FundingCell';
import { OrdersTabBody } from './orders-tab/OrdersTabBody';
import type { AdvancedOrdersTabState } from './orders-tab/useAdvancedOrders';
import { useTradePaneHidden } from './tradePaneVisibility';

interface Props {
  trades: MockTrade[];
  filter?: TradeFilterMeta | null;
  /** Active mint identity — resets hover-pause across token switches. */
  mintKey?: string;
  pagination?: TradePaginationMeta | null;
  holders?: TokenHolder[];
  holdersLoading?: boolean;
  holdersError?: string | null;
  holderPagination?: TradePaginationMeta | null;
  topTraders?: TokenTopTrader[];
  topTradersLoading?: boolean;
  topTradersError?: string | null;
  topTraderPagination?: TradePaginationMeta | null;
  /** TRACKED filter (Holders tab): show only the user's tracked wallets.
   *  The cross-page tracked set is assembled by the page (useTrackedHolders)
   *  because holder pagination is server-side. */
  trackedOnly?: boolean;
  /** FALSE while the user tracks no wallets — disables the toggle. */
  trackedFilterAvailable?: boolean;
  onToggleTrackedOnly?: () => void;
  trackedHolders?: TokenHolder[];
  trackedHoldersLoading?: boolean;
  trackedHoldersError?: string | null;
  /** Reports the LISTEN card-view flag so the page can gate the tracked
   *  fan-out (the filter acts only on the standard holders table). */
  onListenViewChange?: (on: boolean) => void;
  trackedWalletLabels?: Record<string, string>;
  /** Token creator (dev) wallet — chef-hats their holder/trader rows. */
  creatorAddress?: string | null;
  /** One page of the creator's deploys (Dev Tokens tab). */
  devTokens?: LiveNewPair[];
  /** Per-mint row extras (ATH / liquidity / 1h vol / dev PnL). */
  devTokensStats?: Record<string, DevTokenStats>;
  /** Total deploys across ALL pages (the tab count). */
  devTokensTotal?: number | null;
  devTokensPagination?: TradePaginationMeta | null;
  devTokensLoading?: boolean;
  devTokensError?: string | null;
  /** Orders tab (advanced DCA/limit) list + actions (useAdvancedOrders). */
  advancedOrders?: AdvancedOrdersTabState | null;
  /** Page token ticker — Orders-tab pair display for page-mint legs. */
  pageTokenSymbol?: string;
  emptyMessage?: string | null;
  /** Per-wallet dev/sniper/bundler badges (see useWalletClasses). */
  walletClasses?: Record<string, WalletClass>;
  /** Reports the selected table tab so the page can gate per-tab polling
   *  (an unselected Holders/Top-Traders tab must not poll at 5s). */
  onActiveTabChange?: (tab: string) => void;
}

export interface TradeFilterMeta {
  timeframe: ChartTimeframe;
  bucketStartSec: number;
  count: number;
  loading: boolean;
  error: string | null;
  onClear: () => void;
}

export interface TradePaginationMeta {
  pageIndex: number;
  pageSize: number;
  total: number | null;
  loading: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
}

interface TabDef {
  id: string;
  label: string;
  /** Plain count rendered as `(N)` after the label. */
  count?: number;
  /** Crown-prefixed secondary count. */
  crownValue?: number;
}

const TABS: readonly TabDef[] = [
  { id: 'trades', label: 'Trades' },
  { id: 'holders', label: 'Holders' },
  { id: 'topTraders', label: 'Top Traders' },
  // Count + crown (bonded count) are live-derived in TabHeader.
  { id: 'dev', label: 'Dev Tokens' },
  // Advanced DCA/limit orders — count = the user's OPEN orders.
  { id: 'orders', label: 'Orders' },
  // Holder clustering — the wallets that hold this coin, drawn as
  // connected bubbles. Nothing behind it yet; the tab is the placeholder
  // its own body explains.
  { id: 'bubbles', label: 'Bubble Maps' },
] as const;

type SortDir = 'asc' | 'desc';
type AgeMode = 'age' | 'time';

/*
 * ── THE HOLDER GRID LIVES IN CSS ─────────────────────────────────────
 *
 * It used to be this object, spread inline onto the head and every row.
 * Nine columns with hard `minmax` floors adding up to about 1150px, set
 * inline — so no stylesheet could reshape it and the table simply
 * overflowed at every width narrower than a desk.
 *
 * `trow--holders` in `trade-tape.css` owns the template now, and drops
 * columns as the pane narrows. Only the row heights stay here, because
 * they are the one part that never changes.
 */
const HOLDER_ROW_STYLE: CSSProperties = {
  height: 'auto',
  minHeight: 52,
  paddingTop: 8,
  paddingBottom: 8,
};
const EMPTY_HOLDERS: TokenHolder[] = [];
const EMPTY_TOP_TRADERS: TokenTopTrader[] = [];
const EMPTY_DEV_TOKENS: LiveNewPair[] = [];
const EMPTY_TRACKED_WALLET_LABELS: Record<string, string> = {};
const EMPTY_WALLET_CLASSES: Record<string, WalletClass> = {};
const DEV_GRID_STYLE: CSSProperties = {
  gridTemplateColumns:
    'minmax(190px,1.7fr) 70px minmax(90px,1fr) minmax(90px,1fr) minmax(90px,1fr) minmax(90px,1fr) minmax(90px,1fr) 96px',
  columnGap: 14,
};
const EMPTY_DEV_TOKEN_STATS: Record<string, DevTokenStats> = {};
const noopPage = () => {};

// Memoized: TradePage re-renders ~1-2×/sec on stream ticks, but every prop
// here is identity-stabilized upstream (useMemo / react-query data), so the
// table only re-renders when its data actually changes (it owns its own 1s
// age-refresh interval internally).
export const TradesTable = memo(function TradesTable({
  trades,
  filter,
  mintKey = '',
  pagination,
  holders = EMPTY_HOLDERS,
  holdersLoading = false,
  holdersError = null,
  holderPagination = null,
  topTraders = EMPTY_TOP_TRADERS,
  topTradersLoading = false,
  topTradersError = null,
  topTraderPagination = null,
  trackedOnly = false,
  trackedFilterAvailable = false,
  onToggleTrackedOnly,
  trackedHolders = EMPTY_HOLDERS,
  trackedHoldersLoading = false,
  trackedHoldersError = null,
  onListenViewChange,
  trackedWalletLabels = EMPTY_TRACKED_WALLET_LABELS,
  walletClasses = EMPTY_WALLET_CLASSES,
  creatorAddress = null,
  devTokens = EMPTY_DEV_TOKENS,
  devTokensStats = EMPTY_DEV_TOKEN_STATS,
  devTokensTotal = null,
  devTokensPagination = null,
  devTokensLoading = false,
  devTokensError = null,
  advancedOrders = null,
  pageTokenSymbol,
  emptyMessage,
  onActiveTabChange,
}: Props) {
  const [active, setActive] = useState<string>('trades');
  useEffect(() => {
    onActiveTabChange?.(active);
  }, [active, onActiveTabChange]);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  // DEV filter: trades tab shows ONLY the creator's txs until toggled off.
  const [devOnly, setDevOnly] = useState(false);
  // LISTEN view: the Holders tab flips into Listen-platform holder cards.
  // Persisted preference — survives mint switches and reloads; the query
  // below only runs while the view is actually visible.
  const [listenView, setListenView] = useState(false);
  // Hydrate the persisted pref after mount — seeding useState from
  // localStorage desyncs the first client render from the server HTML
  // (see chart-prefs-store.ts).
  useEffect(() => {
    setListenView(readListenViewPref());
  }, []);
  useEffect(() => {
    onListenViewChange?.(listenView);
  }, [listenView, onListenViewChange]);
  const listenHolders = useListenHolders(mintKey || undefined, {
    enabled: active === 'holders' && listenView,
  });
  const toggleListenView = () => {
    const next = !listenView;
    setListenView(next);
    writeListenViewPref(next);
  };
  // Which format the first column shows: relative age ("57s") or absolute
  // clock ("11:02:33"). Independent of sort direction.
  const [ageMode, setAgeMode] = useState<AgeMode>('age');
  // Hover-pause for the TRADES tab only: while the cursor is over the
  // list, the rendered rows freeze so nothing scrolls out from under a
  // read (or an imminent wallet click); the live feed keeps flowing into
  // props and the latest rows snap in the moment the cursor leaves. The
  // chart and every other tab are untouched. Mouse pointers only — touch
  // has no unhover, so it would freeze forever.
  const [frozenTrades, setFrozenTrades] = useState<MockTrade[] | null>(null);
  // Live hover truth + latest trades, for re-arming the freeze when the
  // user returns to the Trades tab (keyboard/tab-click) with the cursor
  // already resting on the list.
  const listHoveredRef = useRef(false);
  const latestTradesRef = useRef(trades);
  latestTradesRef.current = trades;
  // Hiding the persistent pane (display:none) can eat the pointerleave
  // that would unfreeze the tape — returning to the SAME mint would then
  // render the pre-hide frozen rows indefinitely ("paused · +N new").
  // Hidden means no cursor rests on the list: drop the freeze and the
  // hover truth (default false, so standalone mounts are untouched).
  const paneHidden = useTradePaneHidden();
  useEffect(() => {
    if (!paneHidden) return;
    listHoveredRef.current = false;
    setFrozenTrades(null);
  }, [paneHidden]);

  useEffect(() => {
    if (active !== 'trades') {
      setFrozenTrades(null);
      return;
    }
    // Returning to the tab with the cursor already over the list must
    // re-engage the pause — pointerenter won't re-fire without movement.
    if (listHoveredRef.current) setFrozenTrades(latestTradesRef.current);
  }, [active]);
  // The previous token's frozen rows must never survive a mint switch
  // that happens while the cursor rests on the table (back/forward nav).
  // Neither may the DEV filter: left on, the next coin's tape filters by a
  // creator that hasn't resolved yet and renders empty — which reads as a
  // broken/stale trades panel.
  useEffect(() => {
    setFrozenTrades(null);
    setDevOnly(false);
  }, [mintKey]);

  // Clicking the inactive label switches the display format; clicking the
  // already-active label toggles the (recency) sort direction.
  const selectAgeMode = (mode: AgeMode) => {
    if (mode !== ageMode) setAgeMode(mode);
    else setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  };

  const sorted = useMemo(() => {
    const sourceTrades = frozenTrades ?? trades;
    let rows =
      devOnly && creatorAddress !== null
        ? sourceTrades.filter((t) => t.traderAddress === creatorAddress)
        : sourceTrades;
    /*
     * TRACKED narrows the tape as well as the holders. The tracked set is
     * whatever has a label — that record IS the set the user built, and
     * it is already here for the row labels.
     *
     * The two filters stack: dev AND tracked is "did the creator, whom I
     * also track, do anything", which is a real question and a rare
     * enough answer that it should not be silently turned into an OR.
     */
    if (trackedOnly) {
      rows = rows.filter((t) => t.traderAddress != null && t.traderAddress in trackedWalletLabels);
    }
    // Age ordering is time-invariant (all live rows age at the same rate),
    // so sorting against one reference clock captured per recompute equals
    // re-sorting every second — without the per-second O(n log n) pulse and
    // full-table re-render the old 1s nowMs dep caused. The age TEXT still
    // ticks per second inside the FirstCell leaf below.
    const refNowMs = Date.now();
    return Array.from(rows).sort((a, b) => {
      const aAge = liveAgeSec(a, refNowMs);
      const bAge = liveAgeSec(b, refNowMs);
      return sortDir === 'asc' ? aAge - bAge : bAge - aAge;
    });
  }, [frozenTrades, trades, sortDir, devOnly, creatorAddress, trackedOnly, trackedWalletLabels]);
  const holderCount =
    holderPagination?.total != null
      ? holderPagination.total
      : holders.length > 0
        ? holders.length
        : undefined;
  const topTraderCount =
    topTraderPagination?.total != null
      ? topTraderPagination.total
      : topTraders.length > 0
        ? topTraders.length
        : undefined;
  const pausedNewCount = useMemo(() => {
    if (!frozenTrades) return 0;
    const frozenIds = new Set(frozenTrades.map((t) => t.id));
    let count = 0;
    for (const trade of trades) {
      if (frozenIds.has(trade.id)) continue;
      // The badge advertises rows that will actually appear on unhover —
      // respect the DEV filter.
      if (devOnly && creatorAddress !== null && trade.traderAddress !== creatorAddress) continue;
      count += 1;
    }
    return count;
  }, [creatorAddress, devOnly, frozenTrades, trades]);
  // Listen cards are responsive — only the tabular surfaces force the
  // wide min-width.
  const isWideTab =
    (active === 'holders' && !listenView) ||
    active === 'topTraders' ||
    active === 'dev' ||
    active === 'orders';
  const devBondedCount = useMemo(
    () => devTokens.filter((token) => token.graduated === true).length,
    [devTokens],
  );
  // The bonded crown is computed from the loaded page only; beside an
  // all-pages total it would shrink/change while paginating. Only show
  // it when the page IS the whole set.
  const devBondedComplete =
    devTokensTotal == null || devTokensTotal <= devTokens.length;
  const trackedPagination = useMemo<TradePaginationMeta>(
    () => ({
      pageIndex: 0,
      pageSize: Math.max(1, trackedHolders.length),
      total: trackedHolders.length,
      loading: trackedHoldersLoading,
      error: trackedHoldersError,
      hasNext: false,
      hasPrev: false,
      onNext: noopPage,
      onPrev: noopPage,
    }),
    [trackedHolders.length, trackedHoldersLoading, trackedHoldersError],
  );

  return (
    <div className="panel flex h-full min-h-0 w-full flex-col" style={{ paddingBottom: 0 }}>
      <TabHeader
        active={active}
        holderCount={holderCount}
        topTraderCount={topTraderCount}
        devCount={
          devTokensTotal != null && devTokensTotal > 0
            ? devTokensTotal
            : devTokens.length > 0
              ? devTokens.length
              : undefined
        }
        devBondedCount={devTokens.length > 0 && devBondedComplete ? devBondedCount : undefined}
        ordersCount={
          advancedOrders !== null && advancedOrders.openCount > 0
            ? advancedOrders.openCount
            : undefined
        }
        devOnly={devOnly}
        devFilterAvailable={creatorAddress !== null}
        onToggleDevOnly={() => setDevOnly((v) => !v)}
        listenView={listenView}
        listenCount={listenHolders.total}
        onToggleListenView={toggleListenView}
        trackedOnly={trackedOnly}
        trackedFilterAvailable={trackedFilterAvailable}
        onToggleTrackedOnly={onToggleTrackedOnly}
        onChange={setActive}
      />
      {filter ? <FilterBanner filter={filter} /> : null}
      {/* Body horizontally scrolls below the breakpoint where the 6-column
          fixed grid gets squeezed. The min-width ensures column widths
          stay readable; the parent panel hides overflow at its rounded
          corners via .panel's `overflow: hidden`. */}
      <div
        className="tt-body relative min-h-0 flex-1 overflow-auto scroll-hide"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          listHoveredRef.current = true;
          if (active === 'trades') setFrozenTrades(trades);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          listHoveredRef.current = false;
          setFrozenTrades(null);
        }}
      >
        {frozenTrades && active === 'trades' ? (
          // Plain text vertically centered in the sticky head row (the
          // container is height 0 so it overlays without shifting rows).
          <div className="tt-paused-wrap" style={{ height: 0 }}>
            {/* A pill, not a line of tracked capitals shouted at the end
                of the header row. It says one thing — the tape is held
                because your cursor is on it — and how much has piled up
                behind that. */}
            <span className="tt-paused">
              Paused
              {pausedNewCount > 0 ? <b>+{pausedNewCount}</b> : null}
            </span>
          </div>
        ) : null}
        <div
          className="flex min-h-full min-w-[var(--table-min-w)] flex-col"
          style={{ minWidth: isWideTab ? 'var(--table-min-w-wide)' : undefined }}
        >
          {active === 'holders' ? (
            listenView ? (
              <ListenHoldersBody
                holders={listenHolders.holders}
                total={listenHolders.total}
                loading={listenHolders.loading}
                error={listenHolders.error}
                reauth={listenHolders.reauth}
                topHolders={holders}
              />
            ) : (
              <HoldersBody
                holders={trackedOnly ? trackedHolders : holders}
                loading={trackedOnly ? trackedHoldersLoading : holdersLoading}
                error={trackedOnly ? trackedHoldersError : holdersError}
                trackedOnly={trackedOnly}
                trackedWalletLabels={trackedWalletLabels}
                walletClasses={walletClasses}
                creatorAddress={creatorAddress}
              />
            )
          ) : active === 'topTraders' ? (
            <TopTradersBody
              traders={topTraders}
              loading={topTradersLoading}
              error={topTradersError}
              trackedWalletLabels={trackedWalletLabels}
              walletClasses={walletClasses}
              creatorAddress={creatorAddress}
            />
          ) : active === 'dev' ? (
            <DevTokensBody
              tokens={devTokens}
              stats={devTokensStats}
              loading={devTokensLoading}
              error={devTokensError}
            />
          ) : active === 'orders' ? (
            <OrdersTabBody
              state={advancedOrders}
              pageMint={mintKey}
              pageTokenSymbol={pageTokenSymbol}
            />
          ) : active === 'bubbles' ? (
            <div className="tt-soon">Bubble maps are not wired up yet.</div>
          ) : (
            <>
              <HeadRow ageMode={ageMode} sortDir={sortDir} onSelectMode={selectAgeMode} />
              {sorted.map((t) => (
                <Row
                  key={t.id}
                  trade={t}
                  ageMode={ageMode}
                  trackedWalletLabels={trackedWalletLabels}
                  walletClasses={walletClasses}
                />
              ))}
              {sorted.length === 0 ? (
                <EmptyRows
                  message={devOnly ? 'No dev txs in this page.' : emptyMessage}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
      {active === 'trades' && pagination ? (
        <PaginationFooter
          pagination={pagination}
          // Range math needs the LIVE page's row count: the frozen (hover
          // pause) or dev-filtered count would show wrong/overlapping
          // ranges. Live-merged pages can exceed pageSize — clamp.
          visibleCount={Math.min(trades.length, pagination.pageSize)}
          itemLabel="txs"
        />
      ) : null}
      {active === 'holders' && !listenView && trackedOnly ? (
        // The tracked set is a single cross-page fold — a count strip, not
        // a pager.
        <PaginationFooter
          pagination={trackedPagination}
          visibleCount={trackedHolders.length}
          itemLabel="tracked holders"
        />
      ) : null}
      {active === 'holders' && !listenView && !trackedOnly && holderPagination ? (
        <PaginationFooter
          pagination={holderPagination}
          visibleCount={holders.length}
          itemLabel="holders"
        />
      ) : null}
      {active === 'topTraders' && topTraderPagination ? (
        <PaginationFooter
          pagination={topTraderPagination}
          visibleCount={topTraders.length}
          itemLabel="traders"
        />
      ) : null}
      {active === 'dev' && devTokensPagination ? (
        <PaginationFooter
          pagination={devTokensPagination}
          visibleCount={devTokens.length}
          itemLabel="tokens"
        />
      ) : null}
      {/* Orders list is served whole (per-user cap) — a count strip, not
          a pager. */}
      {active === 'orders' && advancedOrders !== null && advancedOrders.orders.length > 0 ? (
        <div
          className="flex h-[34px] shrink-0 items-center gap-2 px-4 text-[11px]"
          style={{
            color: 'var(--ink-3)',
            borderTop: '1px solid var(--hairline)',
            background: 'var(--tabs-bg)',
            fontFamily: 'var(--mono)',
          }}
        >
          <span>
            {advancedOrders.openCount} open / {advancedOrders.orders.length} orders
            {advancedOrders.error ? ` (${advancedOrders.error})` : ''}
          </span>
        </div>
      ) : null}
    </div>
  );
});

function EmptyRows({ message }: { message?: string | null }) {
  return (
    <div
      className="flex min-h-[120px] flex-1 items-center justify-center px-4 text-center text-[11px]"
      style={{
        color: 'var(--ink-3)',
        fontFamily: 'var(--mono)',
        lineHeight: '16px',
      }}
    >
      {message ?? 'No trades to show.'}
    </div>
  );
}

function PaginationFooter({
  pagination,
  visibleCount,
  itemLabel,
}: {
  pagination: TradePaginationMeta;
  visibleCount: number;
  itemLabel: string;
}) {
  const start = pagination.total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const end = pagination.pageIndex * pagination.pageSize + visibleCount;
  const totalLabel = pagination.total == null ? 'unknown' : pagination.total.toLocaleString();
  return (
    <div
      className="flex h-[34px] shrink-0 items-center gap-2 px-4 text-[11px]"
      style={{
        color: 'var(--ink-3)',
        borderTop: '1px solid var(--hairline)',
        background: 'var(--tabs-bg)',
        fontFamily: 'var(--mono)',
      }}
    >
      <span>
        {pagination.loading ? 'loading' : `${start}-${end}`} / {totalLabel} {itemLabel}
        {pagination.error ? ` (${pagination.error})` : ''}
      </span>
      <div className="flex-1" />
      <PageButton
        label="Prev"
        disabled={!pagination.hasPrev || pagination.loading}
        onClick={pagination.onPrev}
      />
      <PageButton
        label="Next"
        disabled={!pagination.hasNext || pagination.loading}
        onClick={pagination.onNext}
      />
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-[24px] items-center rounded-[var(--r-xs)] px-2 text-[10px]"
      style={{
        color: disabled ? 'var(--ink-4)' : 'var(--ink-1)',
        background: 'var(--input-bg)',
        border: '1px solid var(--hairline)',
        fontFamily: 'var(--mono)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function FilterBanner({ filter }: { filter: TradeFilterMeta }) {
  const start = formatBucketTime(filter.bucketStartSec);
  const end = formatBucketTime(filter.bucketStartSec + chartTimeframeSeconds(filter.timeframe) - 1);
  return (
    <div
      className="flex shrink-0 items-center gap-2 px-4 py-2 text-[11px]"
      style={{
        color: 'var(--ink-2)',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--accent-wash)',
        fontFamily: 'var(--mono)',
      }}
    >
      <span style={{ color: 'var(--accent-primary)', fontWeight: 800 }}>Filtered</span>
      <span>
        {filter.timeframe} candle {start} - {end}
      </span>
      <span style={{ color: 'var(--ink-3)' }}>
        ({filter.loading ? 'loading' : `${filter.count} txs`}
        {filter.error ? `, ${filter.error}` : ''})
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={filter.onClear}
        className="inline-flex h-[22px] items-center rounded-[var(--r-xs)] px-2 text-[10px]"
        style={{
          color: 'var(--ink-1)',
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          fontFamily: 'var(--mono)',
          cursor: 'pointer',
        }}
      >
        Clear
      </button>
    </div>
  );
}

function liveAgeSec(trade: MockTrade, nowMs: number): number {
  if (trade.ageBaseMs == null) return trade.ageSec;
  return trade.ageSec + Math.max(0, Math.floor((nowMs - trade.ageBaseMs) / 1_000));
}

// Shared 1s clock for the age column: ONE interval for the whole table, and
// a tick re-renders only the tiny FirstCell leaves that subscribe — never
// the sorted list or the memoized rows (the old per-table nowMs state
// re-sorted and reconciled every row once per second).
let ageTickNowMs = Date.now();
const ageTickListeners = new Set<() => void>();
let ageTickIntervalId: number | null = null;
function subscribeAgeTick(listener: () => void): () => void {
  ageTickListeners.add(listener);
  if (ageTickIntervalId == null) {
    ageTickIntervalId = window.setInterval(() => {
      // Hidden tabs don't need the age column re-rendering every second;
      // the first visible tick catches the clock back up.
      if (document.hidden) return;
      ageTickNowMs = Date.now();
      for (const notify of ageTickListeners) notify();
    }, 1_000);
  }
  return () => {
    ageTickListeners.delete(listener);
    if (ageTickListeners.size === 0 && ageTickIntervalId != null) {
      window.clearInterval(ageTickIntervalId);
      ageTickIntervalId = null;
    }
  };
}
function readAgeTickNowMs(): number {
  return ageTickNowMs;
}
function useNowMsTick(): number {
  return useSyncExternalStore(subscribeAgeTick, readAgeTickNowMs, readAgeTickNowMs);
}

/** Wall-clock timestamp of the trade for the absolute "Time" display. Prefers
 *  the measured baseline (ageBaseMs - ageSec), then the raw arrival, then a
 *  best-effort estimate from the current clock. */
function tradeTimeMs(trade: MockTrade, nowMs: number): number {
  if (trade.ageBaseMs != null) return trade.ageBaseMs - trade.ageSec * 1_000;
  if (trade.arrivedAtMs != null) return trade.arrivedAtMs;
  return nowMs - trade.ageSec * 1_000;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
}

/* ─── Sub-blocks ─────────────────────────────────────────────────────── */

function TabHeader({
  active,
  holderCount,
  topTraderCount,
  devCount,
  devBondedCount,
  ordersCount,
  devOnly,
  devFilterAvailable,
  onToggleDevOnly,
  listenView,
  listenCount,
  onToggleListenView,
  trackedOnly,
  trackedFilterAvailable,
  onToggleTrackedOnly,
  onChange,
}: {
  active: string;
  holderCount?: number;
  topTraderCount?: number;
  devCount?: number;
  devBondedCount?: number;
  ordersCount?: number;
  devOnly: boolean;
  devFilterAvailable: boolean;
  onToggleDevOnly: () => void;
  listenView: boolean;
  listenCount: number | null;
  onToggleListenView: () => void;
  trackedOnly: boolean;
  trackedFilterAvailable: boolean;
  onToggleTrackedOnly?: () => void;
  onChange: (id: string) => void;
}) {
  return (
    // px-6 = 24px, matching .trow's horizontal padding so the tab labels
    // left-align with the AGE column below.
    <div
      className="flex h-[var(--h-tab-bar)] shrink-0 items-center gap-6 overflow-x-auto px-6 scroll-hide"
      style={{ borderBottom: '1px solid var(--hairline)' }}
    >
      {TABS.map((t) => {
        const count =
          t.id === 'holders'
            ? holderCount
            : t.id === 'topTraders'
              ? topTraderCount
              : t.id === 'dev'
                ? devCount
                : t.id === 'orders'
                  ? ordersCount
                  : t.count;
        // Gold crown = how many of the dev's deploys bonded (graduated).
        const crownValue = t.id === 'dev' ? devBondedCount : t.crownValue;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`tab-underline ${active === t.id ? 'active' : ''}`}
          >
            {t.label}
            {count !== undefined && (
              <span className="t-num-sm font-normal" style={{ color: 'var(--ink-3)' }}>
                ({count.toLocaleString()})
              </span>
            )}
            {crownValue !== undefined && (
              <span
                className="inline-flex items-center gap-1 font-normal"
                style={{ color: 'var(--hold)' }}
              >
                <Crown
                  style={{
                    width: 16,
                    height: 16,
                    filter: 'drop-shadow(0 0 5px color-mix(in srgb, var(--hold) 65%, transparent))',
                  }}
                />
                <Numeral size="sm" tone="hold">
                  {crownValue}
                </Numeral>
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      {/* TRACKED filter: the Holders tab shows only the user's tracked
          wallets while active. Acts on the standard table only, so it
          hides while the LISTEN card view is up. Disabled until the user
          tracks at least one wallet. */}
      {/*
        * ── IT IS NEVER HIDDEN ─────────────────────────────────────────
        *
        * It used to disappear while the Listen card view was up, on the
        * reasoning that the filter acts on the standard holders table.
        * But a control that vanishes reads as a control that broke: you
        * flip a view and the thing you were about to press is gone, with
        * nothing saying where it went.
        *
        * Trades and Holders both always show it. Whether it has anything
        * to narrow is the ANSWER, not a reason to withhold the question.
        */}
      {active === 'holders' || active === 'trades' ? (
        <button
          type="button"
          role="switch"
          aria-checked={trackedOnly}
          aria-label={
            trackedOnly
              ? 'Showing tracked wallets only — click to show all holders'
              : 'Filter to tracked wallets only'
          }
          title={
            !trackedFilterAvailable
              ? 'No tracked wallets yet'
              : trackedOnly
                ? 'Showing tracked wallets only — click to show all holders'
                : 'Filter to tracked wallets only'
          }
          /*
           * ── NEVER DISABLED ──────────────────────────────────────────
           *
           * It used to grey out until the user tracked a wallet. But
           * every coin can be looked at through this filter — the answer
           * is sometimes "none of them", and an empty list IS the answer.
           * A dead grey control says the feature is broken; a live one
           * that returns nothing says nobody you follow has touched this.
           */
          onClick={onToggleTrackedOnly}
          /* NO inline style. It was a `color-mix` against theme vars, and
             an inline declaration cannot be overridden by a stylesheet
             rule the way a class can — the lit state lives in
             `trade-tape.css` and the markup only reports the state. */
          className="tt-filter"
        >
          <span className="tt-star">{trackedOnly ? '★' : '☆'}</span>
          Tracked
        </button>
      ) : null}

      {/* LISTEN view: flips the Holders tab into Listen-holder cards.
          Only rendered where it acts — on the Holders tab. */}
      {active === 'holders' ? (
        <ListenToggleButton
          active={listenView}
          count={listenCount}
          onToggle={onToggleListenView}
        />
      ) : null}

      {/* DEV filter: the Trades tab shows only the creator's txs while
          active. Disabled until the snapshot has named the creator. */}
      <button
        type="button"
        role="switch"
        aria-checked={devOnly}
        aria-label={devOnly ? 'Showing dev txs only — click to show all' : 'Filter to dev txs only'}
        title={
          !devFilterAvailable
            ? 'Creator unknown yet'
            : devOnly
              ? 'Showing dev txs only — click to show all'
              : 'Filter to dev txs only'
        }
        /* Never disabled — every coin has a dev, so the question is
           always askable even before the snapshot has named them. */
        onClick={onToggleDevOnly}
        className="tt-filter"
      >
        {/* The dev's OWN mark — the chef hat every Discover row and the
            trade rail already use for the deployer. It was a `▽` / `▼`
            pair, which is a sort indicator everywhere else on this page
            and meant nothing here. */}
        {PILL_MARKS.dev}
        Dev
      </button>
    </div>
  );
}

function HeadRow({
  ageMode,
  sortDir,
  onSelectMode,
}: {
  ageMode: AgeMode;
  sortDir: SortDir;
  onSelectMode: (mode: AgeMode) => void;
}) {
  return (
    <div className="trow trow--head sticky top-0 z-10">
      <span className="inline-flex items-center gap-1 leading-none">
        <AgeModeToggle
          label="Age"
          active={ageMode === 'age'}
          sortDir={sortDir}
          onClick={() => onSelectMode('age')}
        />
        <span style={{ color: 'var(--ink-4)' }}>/</span>
        <AgeModeToggle
          label="Time"
          active={ageMode === 'time'}
          sortDir={sortDir}
          onClick={() => onSelectMode('time')}
        />
      </span>
      <span>MC</span>
      <span className="inline-flex items-center gap-1">
        Total
        <Solana style={{ width: 10, height: 10, flexShrink: 0 }} />
      </span>
      <span>Supply %</span>
      <span>Supply Held</span>
      <span>Trader</span>
    </div>
  );
}

function AgeModeToggle({
  label,
  active,
  sortDir,
  onClick,
}: {
  label: string;
  active: boolean;
  sortDir: SortDir;
  onClick: () => void;
}) {
  const SortIcon = sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent leading-none text-[color:var(--ink-1)] transition-colors'
          : 'inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent leading-none text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink-1)]'
      }
      style={{
        padding: 0,
        font: 'inherit',
        letterSpacing: 'inherit',
        textTransform: 'inherit',
      }}
      aria-pressed={active}
      aria-label={
        active
          ? `Sort by ${label.toLowerCase()} (${sortDir === 'asc' ? 'newest first' : 'oldest first'})`
          : `Show ${label.toLowerCase()}`
      }
    >
      {label}
      {active ? (
        <SortIcon style={{ width: 12, height: 12, color: 'var(--accent-primary)' }} />
      ) : null}
    </button>
  );
}

function HoldersBody({
  holders,
  loading,
  error,
  trackedOnly = false,
  trackedWalletLabels,
  walletClasses,
  creatorAddress,
}: {
  holders: TokenHolder[];
  loading: boolean;
  error: string | null;
  trackedOnly?: boolean;
  trackedWalletLabels: Record<string, string>;
  walletClasses: Record<string, WalletClass>;
  creatorAddress: string | null;
}) {
  const message = error
    ? `holders unavailable: ${error}`
    : loading
      ? 'loading holders…'
      : trackedOnly
        ? 'No tracked wallets hold this token.'
        : 'No holders to show.';
  return (
    <>
      <div className="trow trow--holders trow--head sticky top-0 z-10">
        <span>Rank</span>
        <span>Holder</span>
        <span>SOL Bal</span>
        <span>Bought</span>
        <span>Sold</span>
        <span>PnL</span>
        <span>Remaining</span>
        <span>Funding</span>
        <span>Held</span>
      </div>
      {holders.map((holder) => (
        <HolderTableRow
          key={holder.owner}
          holder={holder}
          trackedWalletLabels={trackedWalletLabels}
          isDev={creatorAddress !== null && holder.owner === creatorAddress}
          holderClass={walletClasses[holder.owner]}
        />
      ))}
      {holders.length === 0 ? <EmptyRows message={message} /> : null}
    </>
  );
}

function HolderTableRow({
  holder,
  trackedWalletLabels,
  isDev,
  holderClass,
}: {
  holder: TokenHolder;
  trackedWalletLabels: Record<string, string>;
  isDev: boolean;
  holderClass?: WalletClass;
}) {
  const trackedLabel = trackedWalletLabels[holder.owner];
  const pnlSol = holder.unrealizedPnlSol;
  const pnlTone = pnlSol == null ? 'var(--ink-2)' : pnlSol >= 0 ? 'var(--up)' : 'var(--down)';
  return (
    <div
      className="trow trow--holders"
      style={HOLDER_ROW_STYLE}
    >
      <span style={{ color: 'var(--ink-2)' }}>{holder.rank}</span>
      <TraderCell
        trader={shortAddress(holder.owner)}
        title={trackedLabel ? `${trackedLabel} (${holder.owner})` : holder.owner}
        trackedLabel={trackedLabel}
        badge={holder.rank <= 9 ? holder.rank : 0}
        isDev={isDev}
        holderClass={holderClass}
        address={holder.owner}
      />
      <MetricStack primary={formatSolLamports(holder.solBalanceLamports)} />
      <MetricStack
        primary={formatSolLamports(holder.boughtSolLamports)}
        secondary={
          holder.avgBuyMarketCapUsd == null
            ? 'no buys'
            : `avg ${formatCompactUsd(holder.avgBuyMarketCapUsd)}`
        }
      />
      <MetricStack
        primary={formatSolLamports(holder.soldSolLamports)}
        secondary={
          holder.avgSellMarketCapUsd == null
            ? 'no sells'
            : `avg ${formatCompactUsd(holder.avgSellMarketCapUsd)}`
        }
      />
      <MetricStack primary={formatPnlSol(pnlSol)} secondary={formatPnlPct(holder)} tone={pnlTone} />
      <MetricStack
        primary={formatPct(holder.supplyPct)}
        secondary={`${formatBaseUnits(holder.amountBaseUnits)} tokens`}
      />
      <FundingCell wallet={holder.owner} />
      <MetricStack
        primary={formatHeldDuration(holder.heldSinceMs)}
        secondary={formatLastActive(holder.lastActiveAtMs)}
      />
    </div>
  );
}

function TopTradersBody({
  traders,
  loading,
  error,
  trackedWalletLabels,
  walletClasses,
  creatorAddress,
}: {
  creatorAddress: string | null;
  traders: TokenTopTrader[];
  loading: boolean;
  error: string | null;
  trackedWalletLabels: Record<string, string>;
  walletClasses: Record<string, WalletClass>;
}) {
  const message = error
    ? `top traders unavailable: ${error}`
    : loading
      ? 'loading top traders…'
      : 'No top traders to show.';
  return (
    <>
      <div className="trow trow--holders trow--head sticky top-0 z-10">
        <span>Rank</span>
        <span>Trader</span>
        <span>SOL Bal</span>
        <span>Bought</span>
        <span>Sold</span>
        <span>PnL</span>
        <span>Remaining</span>
        <span>Funding</span>
        <span>Last Active</span>
      </div>
      {traders.map((trader) => (
        <TopTraderTableRow
          key={trader.owner}
          trader={trader}
          trackedWalletLabels={trackedWalletLabels}
          isDev={creatorAddress !== null && trader.owner === creatorAddress}
          holderClass={walletClasses[trader.owner]}
        />
      ))}
      {traders.length === 0 ? <EmptyRows message={message} /> : null}
    </>
  );
}

function TopTraderTableRow({
  trader,
  trackedWalletLabels,
  isDev,
  holderClass,
}: {
  trader: TokenTopTrader;
  trackedWalletLabels: Record<string, string>;
  isDev: boolean;
  holderClass?: WalletClass;
}) {
  const trackedLabel = trackedWalletLabels[trader.owner];
  const pnlTone =
    trader.totalPnlSol == null
      ? 'var(--ink-2)'
      : trader.totalPnlSol >= 0
        ? 'var(--up)'
        : 'var(--down)';
  return (
    <div
      className="trow trow--holders"
      style={HOLDER_ROW_STYLE}
    >
      <span style={{ color: 'var(--ink-2)' }}>{trader.rank}</span>
      <TraderCell
        trader={shortAddress(trader.owner)}
        title={trackedLabel ? `${trackedLabel} (${trader.owner})` : trader.owner}
        trackedLabel={trackedLabel}
        badge={trader.rank <= 9 ? trader.rank : 0}
        isDev={isDev}
        holderClass={holderClass}
        address={trader.owner}
      />
      <MetricStack primary={formatSolLamports(trader.solBalanceLamports)} />
      <MetricStack
        primary={formatSolLamports(trader.boughtSolLamports)}
        secondary={`${formatBaseUnits(trader.boughtTokenBaseUnits)} tokens`}
      />
      <MetricStack
        primary={formatSolLamports(trader.soldSolLamports)}
        secondary={`${formatBaseUnits(trader.soldTokenBaseUnits)} tokens`}
      />
      <MetricStack
        primary={formatPnlSol(trader.totalPnlSol)}
        secondary={formatPnlPctFromValues(trader.boughtSolLamports, trader.totalPnlSol)}
        tone={pnlTone}
      />
      <MetricStack
        primary={formatPct(trader.remainingSupplyPct)}
        secondary={`${formatBaseUnits(trader.remainingTokenBaseUnits)} tokens`}
      />
      <FundingCell wallet={trader.owner} />
      <MetricStack
        primary={formatLastActive(trader.lastActiveAtMs)}
        secondary={
          trader.avgBuyMarketCapUsd == null
            ? 'no avg buy'
            : `avg buy ${formatCompactUsd(trader.avgBuyMarketCapUsd)}`
        }
      />
    </div>
  );
}

/**
 * Dev Tokens tab: every token this coin's creator deployed (from the
 * ingestion catalog, `/creator/:address/tokens`), newest first. Bonded
 * deploys wear the gold crown; rows navigate to their trade page.
 */
function DevTokensBody({
  tokens,
  loading,
  stats,
  error,
}: {
  tokens: LiveNewPair[];
  stats: Record<string, DevTokenStats>;
  loading: boolean;
  error: string | null;
}) {
  const message = error
    ? `dev tokens unavailable: ${error}`
    : loading
      ? 'loading dev tokens…'
      : 'No deploys found for this creator.';
  return (
    <>
      <div className="trow trow--head sticky top-0 z-10" style={DEV_GRID_STYLE}>
        <span>Token</span>
        <span>Age</span>
        <span>MC</span>
        <span>ATH</span>
        <span>Liquidity</span>
        <span>1h Vol</span>
        <span>PnL</span>
        <span>Bonded</span>
      </div>
      {tokens.map((token) => (
        <DevTokenRow key={token.mint} token={token} stats={stats[token.mint]} />
      ))}
      {tokens.length === 0 ? <EmptyRows message={message} /> : null}
    </>
  );
}

function DevTokenRow({ token, stats }: { token: LiveNewPair; stats?: DevTokenStats }) {
  const bonded = token.graduated === true;
  const symbol = token.symbol.trim() || shortAddress(token.mint);
  const imageUrl = token.imageThumbUrl ?? token.imageCdnUrl ?? token.imageUrl ?? null;
  const pnl = stats?.devPnlUsd;
  return (
    <button
      type="button"
      className="trow w-full text-left"
      style={{ ...DEV_GRID_STYLE, cursor: 'pointer' }}
      onClick={() =>
        navigateToToken(token.mint, {
          name: token.name,
          symbol,
          imageUrl,
        })
      }
      title={`Open ${symbol} trade page`}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <DevTokenThumb imageUrl={imageUrl} symbol={symbol} />
        <span className="min-w-0 truncate" style={{ color: 'var(--ink-0)', fontWeight: 600 }}>
          {symbol}
        </span>
        <span className="min-w-0 truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>
          {token.name.trim()}
        </span>
        <SolscanButton kind="token" id={token.mint} />
      </span>
      <span style={{ color: 'var(--ink-2)' }}>
        {token.createdAtMs != null ? compactAge(Math.max(0, Date.now() - token.createdAtMs)) : '—'}
      </span>
      <span style={{ color: 'var(--ink-1)' }}>{formatCompactUsd(token.marketCapUsd)}</span>
      <span style={{ color: 'var(--ink-1)' }}>{formatCompactUsd(stats?.athMarketCapUsd)}</span>
      <span style={{ color: 'var(--ink-1)' }}>{formatCompactUsd(stats?.liquidityUsd)}</span>
      <span style={{ color: 'var(--ink-1)' }}>{formatCompactUsd(stats?.vol1hUsd)}</span>
      {pnl == null ? (
        <span style={{ color: 'var(--ink-3)' }}>—</span>
      ) : (
        <span style={{ color: pnl >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
          {pnl >= 0 ? '+' : '-'}
          {formatCompactUsd(Math.abs(pnl))}
        </span>
      )}
      {bonded ? (
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--hold)' }}>
          <Crown
            style={{
              width: 14,
              height: 14,
              filter: 'drop-shadow(0 0 5px color-mix(in srgb, var(--hold) 65%, transparent))',
            }}
          />
          bonded
        </span>
      ) : (
        <span style={{ color: 'var(--ink-3)' }}>—</span>
      )}
    </button>
  );
}

/** 22px token avatar with a letter fallback (broken/missing image URLs). */
function DevTokenThumb({ imageUrl, symbol }: { imageUrl: string | null; symbol: string }) {
  const [broken, setBroken] = useState(false);
  const showImage = imageUrl != null && imageUrl.length > 0 && !broken;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: 22,
        height: 22,
        background: 'color-mix(in srgb, var(--ink-3) 22%, transparent)',
        color: 'var(--ink-2)',
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setBroken(true)}
        />
      ) : (
        symbol.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

// Memoized: under a heavy tape the flush re-renders the table once per
// frame, but adapted rows keep object identity across flushes (see the
// adaptTokenTrades row cache), so only NEW rows reconcile — not all ~250.
const Row = memo(function Row({
  trade,
  ageMode,
  trackedWalletLabels,
  walletClasses,
}: {
  trade: MockTrade;
  ageMode: AgeMode;
  trackedWalletLabels: Record<string, string>;
  walletClasses: Record<string, WalletClass>;
}) {
  const tone = trade.type === 'Buy' ? 'var(--up)' : 'var(--down)';
  const trackedLabel = trade.traderAddress ? trackedWalletLabels[trade.traderAddress] : undefined;
  return (
    // trow--cv: offscreen rows skip style/layout/paint (see listen.css).
    <div className="trow trow--cv">
      <FirstCell trade={trade} ageMode={ageMode} />
      <span style={{ color: 'var(--ink-1)' }}>{trade.mc}</span>
      <span className="inline-flex items-center gap-1">
        <Solana style={{ width: 11, height: 11, flexShrink: 0 }} />
        <span style={{ color: tone }}>{trade.totalSol}</span>
      </span>
      <span style={{ color: 'var(--ink-2)' }}>{trade.supplyPct}</span>
      <span style={{ color: 'var(--ink-1)' }}>{trade.supplyHeld}</span>
      <TraderCell
        trader={trade.trader}
        trackedLabel={trackedLabel}
        badge={trade.badge}
        holderClass={trade.traderAddress ? walletClasses[trade.traderAddress] : undefined}
        address={trade.traderAddress}
        solscan={trade.signature ? { kind: 'tx', id: trade.signature } : null}
      />
    </div>
  );
});

/** The only per-second cell: subscribes to the shared 1s clock so the age
 *  text ticks without breaking the row memo above it. */
function FirstCell({ trade, ageMode }: { trade: MockTrade; ageMode: AgeMode }) {
  const nowMs = useNowMsTick();
  const age = trade.arrivedAtMs == null ? trade.age : formatAge(liveAgeSec(trade, nowMs));
  const firstCol = ageMode === 'time' ? formatClock(tradeTimeMs(trade, nowMs)) : age;
  return <span style={{ color: 'var(--ink-2)' }}>{firstCol}</span>;
}

function formatAge(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`;
  const min = Math.floor(ageSec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  return `${Math.floor(hour / 24)}d`;
}


function formatBucketTime(bucketStartSec: number): string {
  const date = new Date(bucketStartSec * 1_000);
  if (!Number.isFinite(date.getTime())) return String(bucketStartSec);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatPct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value >= 10) return `${value.toFixed(1)}%`;
  if (value >= 1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(3)}%`;
}

function formatBaseUnits(value: string): string {
  if (!/^\d+$/.test(value)) return value;
  const whole = value.length > 6 ? value.slice(0, -6) : '0';
  const fracRaw = value.length > 6 ? value.slice(-6) : value.padStart(6, '0');
  const frac = fracRaw.replace(/0+$/, '');
  const display = frac ? `${whole}.${frac}` : whole;
  const numeric = Number(display);
  if (!Number.isFinite(numeric)) return display;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(2)}K`;
  return display;
}

function MetricStack({
  primary,
  secondary,
  tone = 'var(--ink-1)',
}: {
  primary: string;
  secondary?: string;
  tone?: string;
}) {
  return (
    <span className="inline-flex min-w-0 flex-col leading-tight">
      <span className="truncate" style={{ color: tone }}>
        {primary}
      </span>
      {secondary ? (
        <span className="truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>
          {secondary}
        </span>
      ) : null}
    </span>
  );
}

function formatSolLamports(value?: string | null): string {
  const sol = lamportsToSol(value);
  if (sol == null) return 'n/a';
  if (sol === 0) return '0 SOL';
  if (sol >= 100) return `${sol.toFixed(0)} SOL`;
  if (sol >= 10) return `${sol.toFixed(1)} SOL`;
  if (sol >= 1) return `${sol.toFixed(2)} SOL`;
  return `${sol.toFixed(3)} SOL`;
}

function lamportsToSol(value?: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const lamports = Number(value);
  if (!Number.isFinite(lamports)) return null;
  return lamports / 1_000_000_000;
}

function formatPnlSol(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  const abs = Math.abs(value);
  const digits = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return `${sign}${value.toFixed(digits)} SOL`;
}

function formatPnlPct(holder: TokenHolder): string {
  return formatPnlPctFromValues(holder.boughtSolLamports, holder.unrealizedPnlSol);
}

function formatPnlPctFromValues(boughtLamports: string, pnlSol?: number | null): string {
  const boughtSol = lamportsToSol(boughtLamports);
  if (!boughtSol || pnlSol == null || !Number.isFinite(pnlSol)) return 'n/a';
  const pct = (pnlSol / boughtSol) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`;
}

function formatCompactUsd(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatHeldDuration(startMs?: number | null): string {
  if (startMs == null || !Number.isFinite(startMs)) return 'n/a';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1_000));
  return formatDuration(elapsedSec);
}

function formatLastActive(activeMs?: number | null): string {
  if (activeMs == null || !Number.isFinite(activeMs)) return 'no trades';
  return `last ${formatDuration(Math.max(0, Math.floor((Date.now() - activeMs) / 1_000)))}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function TraderCell({
  trader,
  title,
  trackedLabel,
  badge,
  isDev = false,
  holderClass,
  address,
  solscan,
}: {
  trader: string;
  title?: string;
  trackedLabel?: string;
  badge: number;
  /** Token creator (dev) — chef-hatted automatically, no tracking needed. */
  isDev?: boolean;
  /** Engine classification badge: dev / sniper / bundler. */
  holderClass?: WalletClass;
  /** Full wallet address — makes the cell open the wallet profile modal. */
  address?: string;
  /** Solscan jump override. undefined = default wallet/account jump;
   *  null = no button; a target = jump there (Trades rows pass the tx). */
  solscan?: { kind: 'account' | 'tx'; id: string } | null;
}) {
  const display = trackedLabel ?? trader;
  const NameShell = address ? 'button' : 'span';
  const solscanTarget =
    solscan === undefined ? (address ? { kind: 'account' as const, id: address } : null) : solscan;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <NameShell
        {...(address
          ? {
              type: 'button' as const,
              onClick: (e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                openWalletProfile(address);
              },
            }
          : {})}
        className={`inline-flex items-center gap-1 truncate${address ? ' cursor-pointer hover:underline' : ''}`}
        style={{ color: 'var(--ink-1)' }}
        title={title ?? (trackedLabel ? `${trackedLabel} (${trader})` : trader)}
      >
        <span
          aria-hidden
          className="inline-block rounded-full"
          style={{
            width: 12,
            height: 12,
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
          }}
        />
        <span
          className="truncate"
          style={{
            color: trackedLabel ? 'var(--accent-primary)' : 'var(--ink-1)',
            fontFamily: 'var(--mono)',
          }}
        >
          {display}
        </span>
        {isDev || holderClass === 'dev' ? (
          <span
            aria-label="Token creator (dev)"
            title="Token creator (dev)"
            className="shrink-0 text-[12px] leading-none"
          >
            👨‍🍳
          </span>
        ) : null}
        {holderClass === 'sniper' ? (
          <span
            aria-label="Sniper — bought in the creation block"
            title="Sniper — bought in the creation block"
            className="shrink-0 text-[12px] leading-none"
          >
            🎯
          </span>
        ) : null}
        {holderClass === 'bundler' ? (
          <span
            aria-label="Bundler — bought in slots 1-4 after creation"
            title="Bundler — bought in slots 1-4 after creation"
            className="shrink-0 text-[12px] leading-none"
          >
            📦
          </span>
        ) : null}
      </NameShell>
      {solscanTarget ? <SolscanButton kind={solscanTarget.kind} id={solscanTarget.id} /> : null}
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[var(--r-xs)] text-[10px]"
        style={{
          width: 16,
          height: 16,
          color: 'var(--ink-0)',
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline-2)',
          fontFamily: 'var(--mono)',
        }}
      >
        {badge > 0 ? badge : ''}
      </span>
    </span>
  );
}
