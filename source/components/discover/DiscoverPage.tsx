'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { AlphaCoin, MockCoin } from './mockCoins';
import { ColumnTabs } from './layout/ColumnTabs';
import { type StackPanel } from './layout/PanelStack';
import { Section } from './layout/Section';
import { CARD_ZOOM_BY_SIZE, resolveLayout } from './layout/resolveLayout';
import { renderAlphaCard, renderStandardCard, type CardItem } from './layout/cardVariants';
import { useDiscoverFeedDormant } from './DiscoverFeedProvider';
import { useDiscoverPaneHidden } from './discoverPaneVisibility';
import { useTrackedWalletsContext } from './TrackedWalletsProvider';
import {
  displayNameWithEmoji,
  type TrackedWallet,
  type UseTrackedWalletsResult,
} from './trackedWallets';
import { useWalletActivity, type WalletActivityEvent } from './useWalletActivity';
import { useWalletTokenTickers } from './useWalletTokenTickers';
import { WalletActivityFeed } from './WalletActivityFeed';
import { TweetTrackerDock } from './dock/TweetTrackerDock';
import {
  createTradeToast,
  WalletNoticeToastStack,
  type WalletNoticeToast,
} from './WalletNoticeToasts';
import { prefetchView, tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import { warmTokenTradeData } from '@/components/trade/useTokenTradePrewarm';
import { prewarmMints } from '@/lib/api/prewarm';
import { useAuth } from '@clerk/nextjs';
import { getClerkSession, getMirroredClerkUserId } from '@/lib/state/clerk-session-store';
import {
  readDiscoverFilters,
  useDiscoverStore,
  type DiscoverLayout,
  type SectionId,
} from '@/lib/state/discover-store';
import type { QuickBuySectionId } from '@/lib/state/trade-store';
import { useHydrateUserSettings } from '@/lib/api/user-settings';
import { useAlphaFeed } from '@/lib/api/alpha-calls';
import {
  applyAlphaLiveStats,
  mergeAlphaLane,
  type LiveAlphaCoin,
} from '@/lib/api/alpha-calls-shared';
import { reconcileAlphaLane } from './alphaLaneReconcile';
import { DiscoverFiltersButton } from './DiscoverFiltersButton';
import { DiscoverProtocolFilter } from './DiscoverProtocolFilter';
import { EvmDiscoverLanes } from './EvmDiscoverLanes';
import { DISCOVER_CHAINS } from '@/lib/evm/chains';
import { useDiscoverChain } from '@/lib/evm/useDiscoverChain';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import { filterCoinsBySearch } from './discoverSearch';
import { useBoardSuppression } from './useBoardSuppression';
import { useHiddenTokens } from './useHiddenTokens';
import { useAlphaLiveStats } from './useAlphaLiveStats';
import {
  playAlphaCallBell,
  playGraduationBell,
  playWalletToastSoundFor,
  primeAttentionSoundsOnGesture,
  resolveWalletToastSound,
} from './attentionSounds';
import { walletToastTtlMs } from '@/lib/state/wallet-toast-style';
import { applyQuickbuyAlwaysAttr } from '@/lib/state/coincard-prefs';
import { DiscoverFiltersModal } from '@/components/settings/DiscoverFiltersModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { feedKillSwitchEnabled } from './feedKillSwitches';
import { rememberTokenIdentities, resolveSharedTicker, tokenCardKey } from './tokenIdentityCache';
/* Hover-to-pause moved to its own leaf module so the EVM lanes hold the SAME
   freeze semantics rather than a second implementation of them. Behaviour here
   is unchanged — the functions were lifted verbatim. */
import { coinKey, mergePausedRows, usePausableRow } from './pausableRow';
import {
  compareAlmostGraduatedCoins,
  DISCOVER_ROW_RENDER_LIMIT,
  limitDiscoverRows,
} from './useLiveNewPairs';
import {
  almostGraduatedFeedStore,
  useAlmostGraduatedFeed,
  useAlmostGraduatedIngestion,
} from './useAlmostGraduated';
import { useGraduatedRenderCache } from './useGraduatedCache';
import { useStableRowKeys } from './stableRowKeys';
import { TokenRow } from './column/TokenRow';
import { PADS } from './column/rowData';
import { DiscoverCoinStoreContext } from './discoverFeedStore';
import {
  coinPassesFilter,
  DISCOVER_FILTER_SECTIONS,
  rowFilterActive,
  type DiscoverSectionId,
} from './discoverFilters';

const WALLET_TOAST_SEEN_KEY = 'discover:wallet-mint-toasts-seen:v1';
const INITIAL_RECENT_TOAST_MS = 5 * 60_000;
const TOAST_TTL_MS = 8_000;
const TRADE_TOAST_TTL_MS = 6_500;
/**
 * Only toast tracked-wallet trades that are genuinely live. Every fresh
 * SSE connect/reconnect replays the last ~30 persisted trades as history
 * (trading-server backfill, identical frame shape to live events), so a
 * frame-count-based "first batch is history" heuristic is unreliable —
 * the backfill spans many frames and two independent streams. Instead we
 * judge each trade by its LOCAL arrival time (`receivedAtMs`), compared
 * against the same local clock — skew-free, unlike the old block-time
 * gate which silently muted toasts on clients ≥10s ahead and toasted
 * replayed backfill on clients behind. `blockTimeMs` (validator clock)
 * remains only as a generous secondary "very old event" rejection.
 */
const LIVE_TRADE_TOAST_MAX_AGE_MS = 10_000;
const LIVE_TRADE_TOAST_MAX_BLOCK_AGE_MS = 5 * 60_000;
const SHOW_MAYHEM_KEY = 'discover:show-mayhem:v1';
const PREFETCH_TOKEN_LIMIT = 16;

/**
 * Discover page (Listen redesign port).
 *
 * Shared chrome (`.listen-root`, ambient background, top nav, theme, and
 * tracked-wallet store) is owned by the persistent terminal shell.
 */
/* The chain selector's vocabulary now lives in `lib/evm/chains.ts` alongside
   the URL/storage conversions, because the selection is no longer local to
   this component: it is a URL parameter with a persisted memory, shared with
   `/discover/evm` and written by the chain-qualified trade route. The list
   used to be declared here with `sol` spelled as a URL SLUG beside two STORAGE
   tags — one array in two vocabularies, which is how `robinhood` and
   `robinhood_chain` both ended up in flight. */

/** Same wiring as `/discover/evm`: unset (the default) means same-origin
 *  through the api's `/api/v1/evm/*` proxy; the env var remains a dev-rig
 *  override pointing straight at an ingestion read API. */
const EVM_INGEST_BASE = process.env.NEXT_PUBLIC_EVM_INGEST_BASE ?? '';

export function DiscoverPage() {
  const queryClient = useQueryClient();
  /* Owner directive (2026-08-06): chain switch buttons live ON the discover
     page. Selecting an EVM chain display-flips to the EVM lanes; the Solana
     subtree stays MOUNTED (hidden) so its SSE subscriptions and card state
     survive and switching back is a flip, not a remount — the same doctrine
     as the persistent panes. */
  const { chain: discoverChain, setChain: setDiscoverChain } = useDiscoverChain();
  /* `useDiscoverChain` already pins the chain to Solana while the flag is off,
     so this second read is only about the CHROME: the switcher itself has to
     disappear, not sit there with SOL as the single reachable option. */
  const evmEnabled = useEvmEnabled();
  /* Boot-time: pull the user's per-section quick-buy amounts AND
     the global trading-preset block from the server into the
     trade-store. Same hook hydrates both slices. No-op when the
     user isn't signed in (Discover is gated behind sign-in by an
     upstream layout, so this is mostly defensive). */
  useHydrateUserSettings();
  // Hidden persistent pane → dormant subscriptions: the page stops
  // re-rendering on feed flushes while invisible and snaps current on reveal.
  const paneHidden = useDiscoverPaneHidden();
  const liveNewPairs = useDiscoverFeedDormant(paneHidden);
  // Dedicated "Almost Graduated" feed: a separate live SSE stream of the
  // top non-graduated tokens by market cap, ANY age (see useAlmostGraduated).
  // Independent of the recency-capped new-pairs feed above, so old-but-bonding
  // coins surface here even though they never enter New Pairs.
  // `paneHidden` feeds its visibility gate: this stream exclusively paints
  // the row (no alert/trade-page consumer), so a genuinely invisible board
  // drops the socket after a grace window and reconnects on reveal.
  useAlmostGraduatedIngestion(paneHidden);
  const almostGraduatedLive = useAlmostGraduatedFeed(paneHidden);
  const trackedWallets = useTrackedWalletsContext();
  const latestLiveNewPairs = useRef(liveNewPairs);
  const newPairsPaused = useRef(false);
  const prefetchedTokenIds = useRef<Set<string>>(new Set());
  const showMayhem = useDiscoverStore((state) => state.showMayhem);
  const setShowMayhem = useDiscoverStore((state) => state.setShowMayhem);
  const showNewPairsPaused = useDiscoverStore((state) => state.newPairsPaused);
  const setShowNewPairsPaused = useDiscoverStore((state) => state.setNewPairsPaused);
  const filters = useDiscoverStore((state) => state.filters);
  const setFilters = useDiscoverStore((state) => state.setFilters);
  // Per-user filter owner: Clerk user id, with the mirrored-JWT fallback so
  // a cold boot hydrates under the right key instead of the anon bucket.
  const { userId: clerkUserId, isLoaded: clerkLoaded } = useAuth();
  const filtersOwner = clerkUserId ?? (clerkLoaded ? null : getMirroredClerkUserId());
  // Per-user hidden-token set (the coin-card hide button). Optimistic
  // mutations land in the shared react-query cache, so `hiddenMints`
  // changes — and every row below re-filters — the instant a hide happens.
  const hiddenTokens = useHiddenTokens();
  const hiddenMints = hiddenTokens.mintSet;
  /*
   * Every reason a coin stays off the board, in one predicate: the hidden
   * mints, the dev blacklist, the handle blacklist, and the two
   * preferences that steer the hidden set. It used to be the mint check
   * written out inline at each of the six sites below.
   */
  const suppressed = useBoardSuppression(hiddenMints);
  /* One header-search query per section (SectionSearch is a controlled
     input). Owned here — the same single state owner as `filters` — so the
     per-section row derivations below can apply it after the metric filters
     and before the 50-row caps. */
  const [sectionQueries, setSectionQueries] = useState<Record<SectionId, string>>({
    alpha: '',
    'new-pairs': '',
    'almost-graduated': '',
    graduated: '',
  });
  const setSectionQuery = useCallback((section: SectionId, query: string) => {
    setSectionQueries((current) =>
      current[section] === query ? current : { ...current, [section]: query },
    );
  }, []);
  const alphaQuery = sectionQueries.alpha;
  const newPairsQuery = sectionQueries['new-pairs'];
  const almostGraduatedQuery = sectionQueries['almost-graduated'];
  const graduatedQuery = sectionQueries['graduated'];
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Which filter tab to focus when the modal opens (each section's filter
  // icon targets its own tab; Alpha has no filter data so it falls back).
  const [filtersSection, setFiltersSection] = useState<DiscoverSectionId>('new-pairs');
  const openFilters = useCallback((section: DiscoverSectionId) => {
    setFiltersSection(section);
    setFiltersOpen(true);
  }, []);
  const layout = useDiscoverStore((state) => state.layout);
  const hydrateLayout = useDiscoverStore((state) => state.hydrateLayout);
  const setSizes = useDiscoverStore((state) => state.setSizes);
  const cardSize = layout.cardSize;
  const [visibleNewPairs, setVisibleNewPairs] = useState(() =>
    limitDiscoverRows(
      (showMayhem ? liveNewPairs : liveNewPairs.filter((coin) => !isMayhemCoin(coin)))
        .filter((coin) => !coin.graduated)
        .sort(compareNewPairCoins),
    ),
  );
  const walletMintFlashPending = useRef(new Set<string>());
  const [walletMintFlashIds, setWalletMintFlashIds] = useState<Set<string>>(() => new Set());
  // Flash timers must die with the page — a bare setTimeout would fire
  // setState on an unmounted tree (mirrors TradePage's walletToastTimersRef).
  const walletFlashTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = walletFlashTimersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
    };
  }, []);
  // Stamp the persisted "Quickbuy always" pref onto <html> (CSS-only card
  // swap — see coincard-prefs.ts). Attribute survives route changes.
  useEffect(() => {
    applyQuickbuyAlwaysAttr();
  }, []);
  /* Stable bridge for the wallet-activity coordinator below: flashes go
     through the page-owned pause/pending refs so a paused New Pairs row
     defers the flash exactly as before. */
  const requestMintFlash = useCallback((mint: string) => {
    // Phase-0 `flashes-off` kill switch: every wallet-mint flash routes
    // through here, so this one guard suppresses the span AND its setState
    // re-renders (see feedKillSwitches.ts). Client-only callback: safe.
    if (feedKillSwitchEnabled('flashes-off')) return;
    queueWalletMintFlash(
      mint,
      newPairsPaused,
      walletMintFlashPending,
      setWalletMintFlashIds,
      walletFlashTimersRef,
    );
  }, []);
  useLayoutEffect(() => {
    setShowMayhem(readShowMayhem());
  }, [setShowMayhem]);
  // Hydrate persisted row filters AFTER hydration (same pattern as
  // `showMayhem`) so the server and the client's first render agree.
  // Filters are a PER-USER preference: keyed by Clerk user id with the
  // cold-boot mirror fallback (same owner resolution as trackedWallets),
  // re-hydrated whenever the account changes.
  useLayoutEffect(() => {
    setFilters(readDiscoverFilters(filtersOwner), filtersOwner);
  }, [setFilters, filtersOwner]);
  /* Hydrate the persisted layout after mount. SSR + first client render use
     store defaults so markup matches; this runs pre-paint, no visible flash. */
  useLayoutEffect(() => {
    hydrateLayout();
  }, [hydrateLayout]);
  // Single pass + single sort over the live feed per tick: split the
  // mayhem-filtered feed into active vs graduated, sort actives once, and
  // derive both New Pairs views from the same sorted list (previously three
  // independent filter+sort passes).
  //
  // `displayActiveNewPairs` is the display-only filtered variant that feeds
  // the visible/pause pipeline. Kept SEPARATE from `liveActiveNewPairs` so
  // the tracked-wallet toast/flash effects still observe the full,
  // unfiltered set — a metric filter hides cards, it does not silence
  // notifications. Filter runs before the 50-row cap so a tight filter
  // still yields up to 50 matches.
  const { liveActiveNewPairs, displayActiveNewPairs, liveGraduatedCoins } = useMemo(() => {
    const active: MockCoin[] = [];
    const graduated: MockCoin[] = [];
    for (const coin of liveNewPairs) {
      // Graduated coins bypass the mayhem gate here ON PURPOSE: the sticky
      // retention below only refreshes a retained card when it re-enters
      // this bucket, so gating the input would freeze a card that arrived
      // flagless (hot-stub frames can transiently lose launch-mode flags)
      // and the corrected `isMayhem` frame could never reach it — the stale
      // copy then leaked into the Mayhem-off row forever. The authoritative
      // gate for the Graduated row runs AFTER retention, in
      // `graduatedFeedCoins`.
      if (coin.graduated) {
        graduated.push(coin);
        continue;
      }
      if (!showMayhem && isMayhemCoin(coin)) continue;
      active.push(coin);
    }
    active.sort(compareNewPairCoins);
    const rowFilter = filters['new-pairs'];
    return {
      liveActiveNewPairs: limitDiscoverRows(active),
      displayActiveNewPairs: limitDiscoverRows(
        filterCoinsBySearch(
          active.filter(
            (coin) =>
              coinPassesFilter(coin, rowFilter) &&
              !suppressed(coin),
          ),
          newPairsQuery,
        ),
      ),
      liveGraduatedCoins: graduated,
    };
  }, [filters, suppressed, liveNewPairs, newPairsQuery, showMayhem]);
  // Live coin calls (Call This Coin): calls from callers this user follows
  // (slug signups / wallet tracking). Delivery is push-first (SSE into the
  // query cache) with a 15s poll only while the stream is down. No calls →
  // an honest empty lane; reauth/error frames render the same way.
  const alphaFeed = useAlphaFeed();
  // Age labels are derived from Date.now() — with a healthy push stream the
  // feed data reference can stay identical for hours, so a minute tick keeps
  // the "42m" labels honest without re-fetching anything.
  const [alphaAgeTick, setAlphaAgeTick] = useState(0);
  const alphaTickWasHidden = useRef(false);
  useEffect(() => {
    if (paneHidden) {
      alphaTickWasHidden.current = true;
      return;
    }
    if (alphaTickWasHidden.current) {
      alphaTickWasHidden.current = false;
      // Reveal after a dwell: alphaLaneCoins' memo deps may all be unchanged
      // (push feed idle, live-stats resume structurally equal), so bump the
      // tick to re-derive age labels with a fresh Date.now().
      setAlphaAgeTick((t) => t + 1);
    }
    const timer = window.setInterval(() => setAlphaAgeTick((t) => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [paneHidden]);
  // New-call attention: a soft bell + one-shot flash sweep on the card, for
  // calls that arrive AFTER the initial feed load — the backlog primes
  // silently so a page load never rings for history.
  const alphaCallsSeen = useRef<Set<string>>(new Set());
  const alphaCallsPrimed = useRef(false);
  // Keyed by CALL id, not mint: a second call of an already-called coin
  // must flash ONLY its own card — a mint-keyed set replayed the "new
  // card" sweep on every sibling card of that coin.
  const [alphaFlashCallIds, setAlphaFlashCallIds] = useState<Set<string>>(() => new Set());
  const alphaFlashTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = alphaFlashTimersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
    };
  }, []);
  // Autoplay policy: arm the sounds' AudioContext on the first interaction.
  useEffect(() => primeAttentionSoundsOnGesture(), []);
  useEffect(() => {
    const result = alphaFeed.data;
    if (!result || result.kind !== 'ok' || result.data.length === 0) return;
    const calls = result.data;
    if (!alphaCallsPrimed.current) {
      alphaCallsPrimed.current = true;
      for (const call of calls) alphaCallsSeen.current.add(call.id);
      return;
    }
    const freshCallIds = new Set<string>();
    for (const call of calls) {
      if (alphaCallsSeen.current.has(call.id)) continue;
      alphaCallsSeen.current.add(call.id);
      freshCallIds.add(call.id);
    }
    if (freshCallIds.size === 0) return;
    playAlphaCallBell();
    setAlphaFlashCallIds((current) => new Set([...current, ...freshCallIds]));
    // Clear just past the 2s flash animation so the class unmounts clean.
    alphaFlashTimersRef.current.push(
      window.setTimeout(() => {
        setAlphaFlashCallIds((current) => {
          const next = new Set(current);
          for (const id of freshCallIds) next.delete(id);
          return next;
        });
      }, 2_200),
    );
    // Bound the dedupe set (feed window is 30 calls; this is a backstop).
    if (alphaCallsSeen.current.size > 500) {
      alphaCallsSeen.current = new Set([...alphaCallsSeen.current].slice(-250));
    }
  }, [alphaFeed.data]);
  const alphaMints = useMemo(() => {
    const result = alphaFeed.data;
    const calls = result && result.kind === 'ok' ? result.data : [];
    return [...new Set(calls.map((call) => call.mint))];
  }, [alphaFeed.data]);
  // Live stats poll for the called mints: keeps each card's MC / volume /
  // txns current as trades roll in and drives the since-call % readout.
  // Paused with the pane, so a trade-page dwell stops the polling.
  const alphaLiveStats = useAlphaLiveStats(alphaMints, paneHidden);
  // Derivation cache for the reconcile below — NOT a second source of truth:
  // it only carries the previous emission's object identities across runs.
  const alphaLanePrevRef = useRef<ReadonlyMap<string, LiveAlphaCoin>>(new Map());
  const alphaLaneCoins = useMemo(() => {
    const result = alphaFeed.data;
    const calls = result && result.kind === 'ok' ? result.data : [];
    // mergeAlphaLane rebuilds every card object per run, so a stats tick
    // that changed nothing visible would still defeat memo(AlphaCard) for
    // the whole lane — reconcile output identity against the previous
    // emission so unchanged cards keep their reference.
    const { lane, byCallId } = reconcileAlphaLane(
      applyAlphaLiveStats(mergeAlphaLane(calls, Date.now()), alphaLiveStats),
      alphaLanePrevRef.current,
    );
    alphaLanePrevRef.current = byCallId;
    return lane;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alphaAgeTick re-derives time-based labels
  }, [alphaFeed.data, alphaAgeTick, alphaLiveStats]);
  // Header search for the alpha lane: same fold/predicate as the standard
  // rows, applied AFTER the identity reconcile — an empty query passes the
  // lane through by reference.
  const alphaDisplayCoins = useMemo(() => {
    const searched = filterCoinsBySearch(alphaLaneCoins, alphaQuery);
    // Hidden set applies here too — a coin the user hid should not resurface
    // via a caller's coin call. Size-0 fast path preserves identity.
    return searched.filter((coin) => !suppressed(coin));
  }, [alphaLaneCoins, alphaQuery, suppressed]);
  const almostGraduatedCoins = useMemo(() => {
    // Sourced from the dedicated DB-backed feed (top non-graduated by
    // bonding progress, ANY age) — NOT a re-filter of the recency-capped
    // new-pairs feed. The backend already ranks by real SOL reserves and
    // ships a 150-deep candidate POOL; every local filter (mayhem,
    // graduated, missing-mcap defense, row filters, search) runs over the
    // full pool BEFORE the 50-row render cap, so a filtered row still
    // fills all 50 slots and a coin that drops in rank is backfilled by a
    // spare instead of leaving a hole. No production mock fallback: the
    // dedicated feed boot-seeds from a last-good browser cache, and if no
    // cache exists we prefer an honest empty row until the live frame
    // arrives.
    return limitDiscoverRows(
      filterCoinsBySearch(
        (showMayhem
          ? almostGraduatedLive
          : almostGraduatedLive.filter((coin) => !isMayhemCoin(coin)))
          .filter((coin) => !coin.graduated)
          .filter((coin) => Number.isFinite(coin.marketCapUsd ?? Number.NaN))
          .filter((coin) => coinPassesFilter(coin, filters['almost-graduated']))
          .filter((coin) => !suppressed(coin)),
        almostGraduatedQuery,
      ).sort(compareAlmostGraduatedCoins),
    );
  }, [almostGraduatedLive, almostGraduatedQuery, showMayhem, filters, suppressed]);
  // Graduated rows are the `graduated` subset of the new-pairs feed (the
  // backend buckets graduated tokens to the top of the same envelope). On a
  // cold refresh that feed is empty for a beat; rather than flashing a mock
  // list, `useGraduatedRenderCache` boot-seeds the row from a last-good
  // browser cache and swaps to live rows the moment the feed populates.
  // The backend's broadcast graduated bucket is the union of the top 50
  // graduated overall and the top 50 non-mayhem graduated (≤100 cards), so a
  // Mayhem-off session can always fill its 50 visible rows; hot-engine
  // eviction churn still makes rank-boundary graduated coins flicker in/out.
  // Graduation is monotonic (a coin never un-graduates) and `graduatedAtMs` is
  // immutable, so retain every graduated coin we have seen (the `graduated`
  // bucket from the single-pass memo above) and re-derive a stable top-N by
  // graduation time — a 1-frame backend drop must never flash a coin out of
  // the row or resort it.
  const stickyGraduatedCoins = useStickyGraduatedCoins(liveGraduatedCoins);
  // Authoritative mayhem gate for the Graduated row. It runs AFTER sticky
  // retention (see the single-pass memo above) so a retained card is always
  // judged on its LATEST flags, and BEFORE the 50-row cap so hidden mayhem
  // cards never occupy visible slots.
  const graduatedFeedCoins = useMemo(
    () =>
      limitDiscoverRows(
        filterCoinsBySearch(
          stickyGraduatedCoins
            .filter((coin) => showMayhem || !isMayhemCoin(coin))
            .filter((coin) => coinPassesFilter(coin, filters['graduated']))
            .filter((coin) => !suppressed(coin)),
          graduatedQuery,
        ).sort(compareGraduatedCoins),
      ),
    [stickyGraduatedCoins, showMayhem, filters, graduatedQuery, suppressed],
  );
  const graduatedRenderCoins = useGraduatedRenderCache(
    graduatedFeedCoins,
    liveNewPairs.length > 0,
    graduatedQuery === '',
  );
  // Boot-seed safety net: the render cache replays rows persisted by a
  // previous session, which may have been written with Mayhem ON (or before
  // a late flag correction reached that session). Re-apply the gate on the
  // way out so a cached mayhem card can never seed a Mayhem-off row.
  const graduatedLiveCoins = useMemo(() => {
    const gated = showMayhem
      ? graduatedRenderCoins
      : graduatedRenderCoins.filter((coin) => !isMayhemCoin(coin));
    // Re-apply the hidden set after the boot cache for the same reason as
    // the mayhem regate: a previous session's cached rows may contain a
    // coin this user has since hidden.
    return gated.filter((coin) => !suppressed(coin));
  }, [graduatedRenderCoins, showMayhem, suppressed]);
  // Fresh-graduation attention: same bell + flash sweep as a new alpha
  // call. The rendered graduated row primes silently on its first
  // non-empty frame (boot cache / backlog must never ring), and beyond the
  // seen-set dedupe a coin only rings when its immutable `graduatedAtMs`
  // is genuinely recent — coins re-entering the capped row through filter
  // toggles or rank churn are old news, not events.
  const gradSeenMints = useRef<Set<string>>(new Set());
  const gradPrimed = useRef(false);
  const [gradFlashMints, setGradFlashMints] = useState<Set<string>>(() => new Set());
  const gradFlashTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = gradFlashTimersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
    };
  }, []);
  useEffect(() => {
    if (graduatedLiveCoins.length === 0) return;
    if (!gradPrimed.current) {
      gradPrimed.current = true;
      for (const coin of graduatedLiveCoins) {
        if (coin.id) gradSeenMints.current.add(coin.id);
      }
      return;
    }
    const now = Date.now();
    const fresh = new Set<string>();
    for (const coin of graduatedLiveCoins) {
      if (!coin.id || gradSeenMints.current.has(coin.id)) continue;
      gradSeenMints.current.add(coin.id);
      const graduatedAtMs = coin.graduatedAtMs;
      if (typeof graduatedAtMs !== 'number' || now - graduatedAtMs > 120_000) continue;
      fresh.add(coin.id);
    }
    if (fresh.size === 0) return;
    /* Insta-quickbuy readiness: a just-graduated mint is cold EVERYWHERE
       server-side — the engine's first touch has to discover the PumpSwap
       pool structure, and that discovery can spend seconds retrying while
       the migration tx lands. Warm it the moment the row INSERTS (not on
       hover/click) so pool structure + reserves + cashback state are
       already cached by the time a human can aim at the lightning button.
       One immediate POST per fresh graduation; the engine single-flights
       discovery per mint, so many clients collapse to one loop. */
    if (!document.hidden) {
      // Same mint-length gate as the visibility batch warm below — a
      // fixture row's ticker-fallback id would 400 the whole batch.
      const warmMints = [...fresh].filter((mint) => mint.length >= 32).slice(0, 32);
      if (warmMints.length > 0) {
        // Every viewer receives the graduation in the same ~250ms broadcast
        // tick, so an immediate POST here was a synchronized herd against
        // the api auth path (thousands of identical requests per
        // graduation). The engine single-flights discovery per mint — the
        // earliest-landing request does all the work — so spread the rest
        // over 0-2s. Still comfortably ahead of a human aiming at the
        // lightning button (the flash animation alone runs 2s). Rides the
        // flash-timer list so unmount cancels it.
        gradFlashTimersRef.current.push(
          window.setTimeout(() => {
            if (document.hidden) return;
            const session = getClerkSession();
            if (session.isSignedIn !== true) return;
            prewarmMints(warmMints, session.token, { graduatedMints: warmMints, immediate: true });
          }, Math.random() * 2_000),
        );
      }
    }
    playGraduationBell();
    // Phase-0 `flashes-off` kill switch: suppress the graduation attention
    // flash span + its setState re-renders (bell/prewarm untouched).
    if (!feedKillSwitchEnabled('flashes-off')) {
      setGradFlashMints((current) => new Set([...current, ...fresh]));
      // Clear just past the 2s flash animation so the class unmounts clean.
      gradFlashTimersRef.current.push(
        window.setTimeout(() => {
          setGradFlashMints((current) => {
            const next = new Set(current);
            for (const mint of fresh) next.delete(mint);
            return next;
          });
        }, 2_200),
      );
    }
    if (gradSeenMints.current.size > 600) {
      gradSeenMints.current = new Set([...gradSeenMints.current].slice(-300));
    }
  }, [graduatedLiveCoins]);
  const almostGraduatedRow = usePausableRow(almostGraduatedCoins, isActiveCoin, almostGraduatedQuery);
  const graduatedRow = usePausableRow(graduatedLiveCoins, keepAlways, graduatedQuery);
  // The alpha lane is live now (pushed calls prepend) — hover-freeze it like
  // every other live lane so a card can't shift out from under a click.
  const alphaRow = usePausableRow(alphaDisplayCoins, keepAlways, alphaQuery);
  /* Structural order slices for the store-backed lanes (phase 0.3): each
     lane renders from a `cardKey[]` whose reference only moves when rows
     enter/leave/reorder. Content-only ticks re-render this page (fresh
     entity arrays feed the effects/derivations above) but hand the memoized
     CardLane identical props, so the 50-slot list reconciliation is
     skipped; changed cards repaint via their own `useDiscoverCoin`
     subscription. `getItem` serves `renderCard` the LATEST coin (fallback +
     flash targeting) whenever the lane does re-render. The Alpha lane is
     NOT keyed this way: its cards are props-fed (not store-subscribed), so
     it must re-render whenever its data changes — `alphaRow.visible`
     already reuses identity for unchanged cards (reconcileAlphaLane). */
  const { keys: newPairsKeys, getItem: getNewPairsItem } = useStableRowKeys(
    visibleNewPairs,
    tokenCardKey,
  );
  const { keys: almostGraduatedKeys, getItem: getAlmostGraduatedItem } = useStableRowKeys(
    almostGraduatedRow.visible,
    tokenCardKey,
  );
  const { keys: graduatedKeys, getItem: getGraduatedItem } = useStableRowKeys(
    graduatedRow.visible,
    tokenCardKey,
  );
  useEffect(() => {
    rememberTokenIdentities([...visibleNewPairs, ...almostGraduatedCoins, ...graduatedLiveCoins]);
  }, [almostGraduatedCoins, graduatedLiveCoins, visibleNewPairs]);
  // Navigation-latency marker: first non-empty New Pairs render after this
  // page mounts (Trade→Discover return: how fast cards are live again).
  const firstFrameMarked = useRef(false);
  useEffect(() => {
    if (firstFrameMarked.current || visibleNewPairs.length === 0) return;
    firstFrameMarked.current = true;
    performance.mark('discover:first-frame', { detail: { cards: visibleNewPairs.length } });
  }, [visibleNewPairs]);
  /* Coin-derived ticker sources for the wallet-activity coordinator.
     Event-derived tickers (navigation hints + lazy snapshot resolution)
     are layered on inside DiscoverWalletActivity, so this memo never
     depends on the SSE event stream. */
  const coinTickerByMint = useMemo(() => {
    const map = new Map<string, string>();
    const add = (coin: { id?: string | null; ticker: string; name: string }) => {
      if (!coin.id) return;
      setTicker(map, coin.id, coin.ticker, coin.name);
    };
    // Alpha first: a live call's snapshot ticker may be a truncated-mint
    // fallback, so any real feed lane below must win the map.set overwrite.
    for (const coin of alphaLaneCoins) add(coin);
    for (const coin of visibleNewPairs) add(coin);
    for (const coin of almostGraduatedCoins) add(coin);
    for (const coin of graduatedLiveCoins) add(coin);
    return map;
  }, [almostGraduatedCoins, alphaLaneCoins, graduatedLiveCoins, visibleNewPairs]);
  useEffect(() => {
    // Hidden persistent pane: feed churn during a trade-page dwell must not
    // warm trade data for cards the user can't see. Re-fires with the
    // current lanes on reveal, so warm coverage heals immediately.
    if (paneHidden) return;
    return scheduleDeferredPrefetch(() => {
      prefetchView('trade');
      /* Data-only warm for the top coins (react-query, bounded by gcTime).
         Deliberately NO `prefetchToken` here: a route-RSC prefetch per
         distinct feed mint leaked ~1MB of renderer-native memory per new
         mint under churn (Next 15.5 keeps every prefetch's response
         stream open forever as a native GC root — see the dedupe note in
         app/providers.tsx). The harness measured this fan-out as THE
         unbounded Discover leak (perf-harness e1–e5/c2). Route prefetch
         now fires only on real intent — card hover / pointer-down via
         useTokenTradePrewarm — which precedes a click by enough to keep
         navigation instant and is bounded by user behavior. */
      const seen = new Set<string>();
      for (const coin of [...visibleNewPairs, ...almostGraduatedCoins, ...graduatedLiveCoins]) {
        if (!coin.id || seen.has(coin.id) || prefetchedTokenIds.current.has(coin.id)) continue;
        seen.add(coin.id);
        prefetchedTokenIds.current.add(coin.id);
        warmTokenTradeData(queryClient, coin.id);
        if (seen.size >= PREFETCH_TOKEN_LIMIT) break;
      }
      // Evict the OLDEST entries (Set preserves insertion order) instead of
      // clearing: a full clear made every visible coin "new" again and fired
      // a periodic re-prefetch burst across the whole feed.
      if (prefetchedTokenIds.current.size > 512) {
        prefetchedTokenIds.current = new Set([...prefetchedTokenIds.current].slice(-256));
      }
    });
  }, [almostGraduatedCoins, graduatedLiveCoins, paneHidden, queryClient, visibleNewPairs]);
  useEffect(() => {
    latestLiveNewPairs.current = displayActiveNewPairs;
    if (!newPairsPaused.current) {
      setVisibleNewPairs(displayActiveNewPairs);
    } else {
      setVisibleNewPairs((current) => {
        const merged = mergePausedRows(current, displayActiveNewPairs, isActiveCoin);
        return showMayhem ? merged : merged.filter((coin) => !isMayhemCoin(coin));
      });
    }
  }, [displayActiveNewPairs, showMayhem]);
  // Search must cut through the hover-freeze: typing in the header keeps the
  // pointer inside the section, so without this snap the query looks inert
  // until pointer-leave. Declared after the merge effect so it reads the
  // already-updated latest list; feed churn between keystrokes stays frozen.
  useEffect(() => {
    setVisibleNewPairs(latestLiveNewPairs.current);
  }, [newPairsQuery]);

  const pauseNewPairs = useCallback(() => {
    newPairsPaused.current = true;
    setShowNewPairsPaused(true);
  }, [setShowNewPairsPaused]);

  const resumeNewPairs = useCallback(() => {
    newPairsPaused.current = false;
    setShowNewPairsPaused(false);
    setVisibleNewPairs(latestLiveNewPairs.current);
  }, [setShowNewPairsPaused]);

  const updateShowMayhem = useCallback(
    (next: boolean) => {
      setShowMayhem(next);
      writeShowMayhem(next);
    },
    [setShowMayhem],
  );

  useEffect(() => {
    if (newPairsPaused.current) return;
    for (const coin of visibleNewPairs) {
      if (!coin.id || !walletMintFlashPending.current.has(coin.id)) continue;
      walletMintFlashPending.current.delete(coin.id);
      startWalletMintFlash(coin.id, setWalletMintFlashIds, walletFlashTimersRef);
    }
  }, [visibleNewPairs]);

  const anyFiltersActive = useMemo(
    () => DISCOVER_FILTER_SECTIONS.some((section) => rowFilterActive(filters[section])),
    [filters],
  );

  /* Stable per-section card renderers: identity changes ONLY when a flash
     set swaps (rare, event-driven), never on feed content ticks — one leg
     of the memoized CardLane's prop stability. Standard sections receive
     KEYS and look up the latest coin at render time through the lane's
     identity-stable `getItem`; Alpha receives its coins directly. */
  const renderNewPairsCard = useCallback(
    (item: LaneItem, index: number): ReactNode => {
      const coin = typeof item === 'string' ? getNewPairsItem(item) : undefined;
      if (!coin) return null;
      return renderStandardCard(coin, {
        sectionId: 'new-pairs',
        flash: coin.id ? walletMintFlashIds.has(coin.id) : false,
        imageLoading: index < 8 ? 'eager' : 'lazy',
      });
    },
    [getNewPairsItem, walletMintFlashIds],
  );
  const renderAlmostGraduatedCard = useCallback(
    (item: LaneItem): ReactNode => {
      const coin = typeof item === 'string' ? getAlmostGraduatedItem(item) : undefined;
      if (!coin) return null;
      return renderStandardCard(coin, {
        sectionId: 'almost-graduated',
        flash: coin.id ? walletMintFlashIds.has(coin.id) : false,
        imageLoading: 'lazy',
      });
    },
    [getAlmostGraduatedItem, walletMintFlashIds],
  );
  const renderGraduatedCard = useCallback(
    (item: LaneItem): ReactNode => {
      const coin = typeof item === 'string' ? getGraduatedItem(item) : undefined;
      if (!coin) return null;
      return renderStandardCard(coin, {
        sectionId: 'graduated',
        flash: coin.id ? walletMintFlashIds.has(coin.id) : false,
        attentionFlash: coin.id ? gradFlashMints.has(coin.id) : false,
        imageLoading: 'lazy',
      });
    },
    [getGraduatedItem, gradFlashMints, walletMintFlashIds],
  );
  const renderAlphaLaneCard = useCallback(
    (item: LaneItem): ReactNode => {
      if (typeof item === 'string') return null;
      const alphaCoin = item as AlphaCoin & { id?: string };
      return renderAlphaCard(alphaCoin, {
        flash: alphaCoin.callId ? alphaFlashCallIds.has(alphaCoin.callId) : false,
      });
    },
    [alphaFlashCallIds],
  );

  /* What each section's lane RENDERS: the standard sections' structural
     key slices (reference-stable across content-only ticks), Alpha's
     props-fed coins. */
  /*
   * ── COIN TO ROW ──────────────────────────────────────────────────
   *
   * Four readings the row wants that the feed states differently.
   * Each returns undefined when the feed has nothing, and the row
   * leaves that part out rather than drawing a zero.
   */
  /*
   * No pad here. The feed states no launchpad per coin — only the
   * filter knows the list — so the ring stays neutral and the badge is
   * left off. `findPad` is ready for the field the moment one exists;
   * picking the nearest name would put the wrong logo on a real token.
   */
  /* Under 30 minutes green, under an hour orange, over that red. */
  const ageTierOf = (ms?: number | null) =>
    ms == null ? undefined : ms < 1_800_000 ? 'fresh' : ms < 3_600_000 ? 'aging' : 'old';
  /* Under 20K blue, under 100K gold, over that green. */
  const mcTierOf = (usd?: number | null) =>
    usd == null ? undefined : usd < 20_000 ? 'low' : usd < 100_000 ? 'mid' : 'high';

  const laneItemsBySection: Record<SectionId, LaneItem[]> = {
    alpha: alphaRow.visible,
    'new-pairs': newPairsKeys,
    'almost-graduated': almostGraduatedKeys,
    graduated: graduatedKeys,
  };
  const renderCardBySection: Record<SectionId, (item: LaneItem, index: number) => ReactNode> = {
    alpha: renderAlphaLaneCard,
    'new-pairs': renderNewPairsCard,
    'almost-graduated': renderAlmostGraduatedCard,
    graduated: renderGraduatedCard,
  };

  /* Live coin sources keyed by section (visibility-return warm below reads
     these; the lanes themselves render from `laneItemsBySection`). New
     Pairs uses the visible/pause pipeline; Almost Graduated + Graduated use
     their pausable-row visible lists; Alpha is shown directly (not in the
     feed store). */
  const coinsBySection: Record<SectionId, CardItem[]> = {
    alpha: alphaRow.visible,
    'new-pairs': visibleNewPairs,
    'almost-graduated': almostGraduatedRow.visible,
    graduated: graduatedRow.visible,
  };
  /* Visibility-return batch warm: after any hidden stretch >1.5s every
     rendered card's server-side quote cache has TTL'd out, so the first
     quickbuy after returning pays the engine's cold RPC read. One
     immediate batch POST re-warms the rendered cards the moment the tab
     is visible again — hot well before a human can re-aim and click.
     Structural element type so MockCoin and AlphaCoin lanes both fit. */
  const prewarmLanesRef = useRef<
    ReadonlyArray<ReadonlyArray<{ id?: string | null; graduated?: boolean }>>
  >([]);
  prewarmLanesRef.current = [
    coinsBySection.alpha,
    coinsBySection['new-pairs'],
    coinsBySection['almost-graduated'],
    coinsBySection.graduated,
  ];
  const lastVisibilityWarmAtRef = useRef(0);
  useEffect(() => {
    if (paneHidden) return;
    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      // Rapid hide/show flapping shouldn't spam the batch endpoint.
      const now = Date.now();
      if (now - lastVisibilityWarmAtRef.current < 2_000) return;
      const session = getClerkSession();
      if (session.isSignedIn !== true) return;
      const mints: string[] = [];
      const graduatedMints: string[] = [];
      const seen = new Set<string>();
      for (const lane of prewarmLanesRef.current) {
        for (const coin of lane) {
          // Length gate mirrors the api schema (mint pubkeys, 32-64
          // chars) — a mock coin's ticker-fallback id would 400 the
          // whole batch.
          if (!coin.id || coin.id.length < 32 || seen.has(coin.id)) continue;
          seen.add(coin.id);
          mints.push(coin.id);
          if (coin.graduated === true) graduatedMints.push(coin.id);
          // MAX_MINTS_PER_REQUEST cap — first-rendered lanes win.
          if (mints.length >= 32) break;
        }
        if (mints.length >= 32) break;
      }
      if (mints.length === 0) return;
      lastVisibilityWarmAtRef.current = now;
      prewarmMints(mints, session.token, { immediate: true, graduatedMints });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [paneHidden]);
  /* Per-section hover-to-pause handlers + paused badge. */
  const sectionPause: Partial<
    Record<SectionId, { onPointerEnter: () => void; onPointerLeave: () => void; paused: boolean }>
  > = {
    alpha: {
      onPointerEnter: alphaRow.onPointerEnter,
      onPointerLeave: alphaRow.onPointerLeave,
      paused: alphaRow.paused,
    },
    'new-pairs': {
      onPointerEnter: pauseNewPairs,
      onPointerLeave: resumeNewPairs,
      paused: showNewPairsPaused,
    },
    'almost-graduated': {
      onPointerEnter: almostGraduatedRow.onPointerEnter,
      onPointerLeave: almostGraduatedRow.onPointerLeave,
      paused: almostGraduatedRow.paused,
    },
    graduated: {
      onPointerEnter: graduatedRow.onPointerEnter,
      onPointerLeave: graduatedRow.onPointerLeave,
      paused: graduatedRow.paused,
    },
  };

  /* Auto second row: is the viewport tall enough to fit one more card row
     after every visible section has its first? Re-measured on resize and on
     any layout change. resolveLayout gates the 2nd row on this. */
  const [extraRowAvailable, setExtraRowAvailable] = useState(false);
  useEffect(() => {
    const measure = () => setExtraRowAvailable(computeExtraRowRoom(layout));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [layout]);
  const descriptor = resolveLayout(layout, { extraRowAvailable });
  const presetZoom = CARD_ZOOM_BY_SIZE[layout.cardSize] ?? 1;
  const stackPanels: StackPanel[] = descriptor.panels.map((panel) => {
    const isAlpha = panel.id === 'alpha';
    // Column mode = narrow headers: filters collapse to an icon and Mayhem
    // is dropped entirely (matches Section's dense header treatment).
    const dense = descriptor.cardFlow === 'vertical';
    const pause = sectionPause[panel.id];
    // Uniform column headers: in column mode every section shows the same
    // trailing cluster (Search + Quick-buy + Filters icon). The filters icon
    // targets this section's own tab; Alpha has no filter data, so it falls
    // back to the New Pairs tab. Rows mode is unchanged — Filters + Mayhem
    // only on New Pairs.
    const filterSection: DiscoverSectionId = panel.id === 'alpha' ? 'new-pairs' : panel.id;
    /*
     * The launchpad control sits on EVERY lane, in both flows, because it
     * narrows that lane on its own and the whole point is not having to
     * open the panel to do it. Alpha has no filter data of its own, so it
     * borrows the New Pairs section the same way its Filters button does.
     */
    const headerAction = dense ? (
      <div className="flex shrink-0 items-center gap-1.5">
        <DiscoverProtocolFilter section={filterSection} dense />
        <DiscoverFiltersButton
          active={rowFilterActive(filters[filterSection])}
          onClick={() => openFilters(filterSection)}
          iconOnly
        />
      </div>
    ) : panel.id === 'new-pairs' ? (
      <div className="flex shrink-0 items-center gap-2">
        <DiscoverProtocolFilter section={filterSection} />
        <DiscoverFiltersButton active={anyFiltersActive} onClick={() => openFilters('new-pairs')} />
        <DiscoverMayhemToggle showMayhem={showMayhem} onChange={updateShowMayhem} />
      </div>
    ) : (
      <div className="flex shrink-0 items-center gap-2">
        <DiscoverProtocolFilter section={filterSection} />
      </div>
    );
    const section = (
      <Section
        label={panel.label}
        variant={panel.variant}
        sizing={panel.sizing}
        tracks={panel.tracks}
        cardFlow={descriptor.cardFlow}
        maxZoom={presetZoom}
        quickBuySectionId={panel.id as QuickBuySectionId}
        isAlpha={isAlpha}
        live={isAlpha}
        headerAction={headerAction}
        headerBadge={pause?.paused ? 'paused' : null}
        /* Column mode reads these two instead of `headerAction`: the
           column draws its own funnel, so it takes the behaviour rather
           than a pre-built button wearing the old header's chrome. */
        onFilters={() => openFilters(filterSection)}
        filtersActive={rowFilterActive(filters[filterSection])}
        searchValue={sectionQueries[panel.id]}
        onSearchChange={(value) => setSectionQuery(panel.id, value)}
        onPointerEnter={pause?.onPointerEnter}
        onPointerLeave={pause?.onPointerLeave}
        items={laneItemsBySection[panel.id]}
        // Reference-stable across renders (module fn / useCallback above):
        // the memoized CardLane's prop identity depends on it. Alpha items
        // are keyed per CALL (same-mint sibling cards must not collide).
        getKey={laneItemKey}
        renderCard={renderCardBySection[panel.id]}
        /*
           Column mode. Built from the COINS rather than the lane items,
           because a row reads a coin and a lane item is an identifier.

           Every field the feed does not carry is left off rather than
           filled from the sandbox fixtures: an invented holder split on
           a real token is worse than a gap. */
        /*
           Column mode. One row per coin in the section, rendered by the
           same component the `/whatever` sheet uses.

           FIXTURE BACKED, by index. This board runs on mock coins and
           the row shows about thirty fields — the mock feed carries
           four of them, so a row driven off the feed rendered a ticker,
           an age and two pills and nothing else. The point of putting
           it here is to see the whole row, so the row brings its own
           data and the coin decides how many of them there are.

           The pad cycles with the index so a column shows the range of
           launchpads rather than fourteen of the same badge. */
        rows={coinsBySection[panel.id].map((coin, index) => (
          <TokenRow
            key={(coin as MockCoin).id ?? `${coin.ticker}-${index}`}
            pad={PADS[index % PADS.length]}
            i={index}
            graduated={panel.id === 'graduated'}
          />
        ))}
      />
    );
    // Almost Graduated cards read per-coin data from the dedicated
    // almost-graduated store (any-age, DB-backed), not the singleton feed.
    const content =
      panel.id === 'almost-graduated' ? (
        <DiscoverCoinStoreContext.Provider value={almostGraduatedFeedStore}>
          {section}
        </DiscoverCoinStoreContext.Provider>
      ) : (
        section
      );
    return { id: panel.id, sizing: panel.sizing, weight: panel.weight, content };
  });

  return (
    /* One Tooltip provider for the whole page: every card's MetaRow
       tooltips share it (delay + skip-delay), instead of mounting a
       provider per card. */
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      {/* Owns the tracked-wallet SSE subscriptions + toast/flash side
          effects so a trade event re-renders only this subtree, never the
          page root (and with it every section/card). */}
      <DiscoverWalletActivity
        paneHidden={paneHidden}
        trackedWallets={trackedWallets}
        liveActiveNewPairs={liveActiveNewPairs}
        visibleNewPairs={visibleNewPairs}
        coinTickerByMint={coinTickerByMint}
        requestMintFlash={requestMintFlash}
      />
      <TweetTrackerDock ctx="discover" />

      <main
        data-card-size={cardSize}
        /* 10px of air on three sides and none at the foot — the footer
           strip below already provides that edge, and doubling it would
           leave a band of nothing under the last card. The values are
           inline rather than utilities because the left and right have to
           add the dock inset to the 10; see the note in `style`. */
        // The board's palette hangs off this element rather than off
        // `.listen-root`, so everything inside goes to paper and no other
        // page in the terminal moves. See discover.css, THE BOARD'S PALETTE.
        data-board-paper=""
        className="mx-auto flex h-[var(--h-app-content)] w-full max-w-[min(2400px,100%)] flex-col overflow-hidden"
        style={{
          // Snapped docks reserve their width via CSS vars (written directly
          // by the dock layer — resize drags never re-render this page).
          /*
           * ── 10 ON THREE SIDES, AND THE DOCK INSET ON TOP OF IT ────
           *
           * The sides are `10px + --dock-*-w-discover`. The dock term is
           * the whole reason this is inline rather than a utility class:
           * when the wallet or tweet dock snaps to a side it publishes
           * its width, and the board insets by exactly that so the lane
           * underneath is not covered. With no dock snapped both resolve
           * to 0 and only the 10 is left.
           *
           * The foot is 0 on purpose. The footer strip sits directly
           * under this and already draws the bottom edge, so padding
           * here would put a band of empty ground between the last card
           * and the bar.
           *
           * Inline also settles a conflict rather than creating one: an
           * inline style beats a Tailwind utility, so a `p-*` class on
           * the element above could not change this anyway.
           */
          paddingTop: '10px',
          paddingBottom: 0,
          paddingLeft: 'calc(10px + var(--dock-left-w-discover, 0px))',
          paddingRight: 'calc(10px + var(--dock-right-w-discover, 0px))',
          transition: 'padding 200ms ease',
        }}
      >
        {/* Single Filters modal root, opened by the funnel button in the
            New Pairs header; tabs inside switch between per-row filters. */}
        <DiscoverFiltersModal
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          initialSection={filtersSection}
        />
        {/* Chain switcher (owner directive): SOL renders the Solana stack
            below; BSC/ROBINHOOD flip the display to the EVM lanes. Hidden
            wholesale behind `evm-client-surface` — a one-option switcher is
            still an EVM surface, and its absence is what makes the gated
            page byte-identical to the pre-EVM Solana page. */}
        {evmEnabled ? (
        <div className="mb-1 flex shrink-0 items-center gap-1.5">
          {DISCOVER_CHAINS.map(({ tag, label }) => {
            const active = discoverChain === tag;
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => setDiscoverChain(tag)}
                className="inline-flex h-[22px] shrink-0 items-center rounded-full px-2 transition-colors"
                style={{
                  color: active ? 'var(--ink-0)' : 'var(--ink-2)',
                  background: active
                    ? 'color-mix(in srgb, var(--accent-primary) 16%, var(--input-bg))'
                    : 'var(--input-bg)',
                  border: `1px solid ${active ? 'color-mix(in srgb, var(--accent-primary) 48%, var(--hairline))' : 'var(--input-border)'}`,
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        ) : null}
        {/* Viewport-locked layout engine. PanelStack handles fixed + flex
            panels uniformly, hides via the panel list, resizes proportionally,
            and fills the viewport so the page never scrolls. Stays mounted
            (hidden) while an EVM chain is selected — see discoverChain.
            `!evmEnabled` is restated here rather than trusted from the hook:
            the fallback must be the Solana stack VISIBLE, and a blank board is
            the one outcome the gate may not produce. */}
        <div className={cn('min-h-0 flex-1 flex-col', !evmEnabled || discoverChain === 'solana' ? 'flex' : 'hidden')}>
          {/* Under 1200 this becomes one column and a tab strip; above
              it, it IS `PanelStack` and nothing changes. */}
          <ColumnTabs
            axis={descriptor.axis}
            panels={stackPanels}
            labels={Object.fromEntries(descriptor.panels.map((p) => [p.id, p.label]))}
            sizes={layout.sizes[layout.mode]}
            onSizesChange={(next) => setSizes(layout.mode, next)}
            className="min-h-0 flex-1"
          />
        </div>
        {evmEnabled && discoverChain !== 'solana' && (
          /* Viewport-locked, exactly like the Solana stack above: the EVM board
             now runs the same `PanelStack`, so its lanes size themselves to the
             available height and scroll INTERNALLY. The `overflow-y-auto` this
             replaced let the whole page scroll instead, which is the one thing
             the layout engine exists to prevent. */
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Keyed per chain: the lane reducer is chain-keyed and a fresh
                mount guarantees a clean snapshot on switch. */}
            <EvmDiscoverLanes
              key={discoverChain}
              chain={discoverChain}
              apiBase={EVM_INGEST_BASE}
              /* The page's single filters modal, opened on the tab whose bounds
                 that lane borrows — one modal root and one persisted filter set
                 for both boards. */
              onOpenFilters={openFilters}
              /* Same dormancy rule the Solana subtree follows: the
                 persistent pane stays MOUNTED behind the trade page, and an
                 invisible board must not hold an SSE connection open or
                 repaint on every frame. The reducer's re-snapshot path is
                 what makes waking up correct rather than incremental. */
              live={!paneHidden}
            />
          </div>
        )}
      </main>
    </TooltipProvider>
  );
}

interface DiscoverWalletActivityProps {
  /** Hidden persistent pane: the streams stay subscribed (rolling buffer +
   *  chime survive) but per-event React notifications are suppressed. */
  paneHidden: boolean;
  trackedWallets: UseTrackedWalletsResult;
  /** Full (unfiltered) New Pairs view — mint toasts must not be silenced by row filters. */
  liveActiveNewPairs: MockCoin[];
  /** Currently rendered New Pairs rows (for flash targeting + toast ticker fallback). */
  visibleNewPairs: MockCoin[];
  /** Coin-derived tickers from the page; event-derived tickers are layered on here. */
  coinTickerByMint: ReadonlyMap<string, string>;
  /** Routes a flash request through the page-owned pause/pending refs. */
  requestMintFlash: (mint: string) => void;
}

/**
 * Tracked-wallet activity coordinator. Subscribes to the wallet-activity
 * SSE streams and owns every consumer of the events — the toast stack,
 * the floating activity feed, and the toast/flash side effects — so a
 * trade event re-renders only this subtree, never the DiscoverPage root.
 */
function DiscoverWalletActivity({
  paneHidden,
  trackedWallets,
  liveActiveNewPairs,
  visibleNewPairs,
  coinTickerByMint,
  requestMintFlash,
}: DiscoverWalletActivityProps) {
  /* Dormant chime: while the pane is hidden the subscriptions below stay
     live (dropping them would tear down the shared stream + rolling buffer
     after its linger when Discover is the last consumer — e.g. a /tracker
     dwell) but stop notifying React, so the toast effect that normally
     rings can't run. Ring here instead, per suppressed event, behind the
     same freshness gates the toast effect applies; playWalletToastSoundFor's
     throttle collapses the double-fire when the trade page's stack also
     rings (mirrors the existing Discover/Trade dual-stack guard). */
  const trackedWalletsRef = useRef(trackedWallets);
  trackedWalletsRef.current = trackedWallets;
  const onDormantWalletEvent = useCallback((event: WalletActivityEvent) => {
    // The subscription is the SUPERSET of tracked wallets; the chime is
    // a toast-surface side effect, so a wallet with toasts muted must
    // not ring here.
    if (!trackedWalletsRef.current.toastAddressSet.has(event.wallet)) return;
    // Connection-backfill frames replay recent history with a fresh
    // receivedAtMs — never ring for them (cold load played the last few
    // trades as a loud burst).
    if (event.replayed) return;
    const now = Date.now();
    if (now - event.receivedAtMs > LIVE_TRADE_TOAST_MAX_AGE_MS) return;
    if (event.blockTimeMs !== null && now - event.blockTimeMs > LIVE_TRADE_TOAST_MAX_BLOCK_AGE_MS) {
      return;
    }
    playWalletToastSoundFor(
      resolveWalletToastSound(trackedWalletsRef.current.lookup(event.wallet)),
      // Same ring key the toast stacks use (trade:<sig>:<wallet>), so a
      // stack that also sees this event can't double-ring in stack mode.
      `trade:${event.signature}:${event.wallet}`,
    );
  }, []);
  // ONE shared superset stream; feed/toast scoping is client-side
  // filtering below. Keying the subscription on the alert sets used to
  // mint up to 3 concurrent EventSources (each with its own server
  // backfill) and re-connect on every flag toggle.
  const { events: walletActivityEvents } = useWalletActivity(trackedWallets.addressSet, {
    dormant: paneHidden,
    onDormantEvent: onDormantWalletEvent,
  });
  const feedWalletActivityEvents = useMemo(
    () => walletActivityEvents.filter((event) => trackedWallets.feedAddressSet.has(event.wallet)),
    [walletActivityEvents, trackedWallets.feedAddressSet],
  );
  const [walletNoticeToasts, setWalletNoticeToasts] = useState<WalletNoticeToast[]>([]);
  const walletMintToastsSeen = useRef(loadSeenWalletMints());
  const walletMintToastsPrimed = useRef(false);
  const seenTradeSignatures = useRef<Set<string>>(new Set());
  const seenFlashTradeKeys = useRef<Set<string>>(new Set());
  // Toast-dismiss timers must die with this subtree — a bare setTimeout
  // would fire setState on an unmounted tree (mirrors TradePage).
  const walletToastTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = walletToastTimersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
    };
  }, []);

  // Toast candidates are scoped to the toast set — a feed-only wallet
  // (alertsOnToast=false) must never toast or ring. The old feed ∪ toast
  // union silently toasted feed-only wallets.
  const toastCandidateEvents = useMemo(
    () =>
      walletActivityEvents
        .filter((event) => trackedWallets.toastAddressSet.has(event.wallet))
        .sort((a, b) => {
          const aTime = a.blockTimeMs ?? a.receivedAtMs;
          const bTime = b.blockTimeMs ?? b.receivedAtMs;
          return bTime - aTime;
        }),
    [walletActivityEvents, trackedWallets.toastAddressSet],
  );
  const baseTickerByMint = useMemo(() => {
    const map = new Map(coinTickerByMint);
    for (const event of toastCandidateEvents) {
      const cached = tokenTickerFromNavigationHint(event.mint);
      if (cached) map.set(event.mint, cached);
    }
    return map;
  }, [coinTickerByMint, toastCandidateEvents]);
  const lazyTickerByMint = useWalletTokenTickers(toastCandidateEvents, baseTickerByMint);
  const tickerByMint = useMemo(() => {
    const map = new Map(baseTickerByMint);
    for (const [mint, ticker] of lazyTickerByMint) map.set(mint, ticker);
    return map;
  }, [baseTickerByMint, lazyTickerByMint]);
  const visibleCoinByMint = useMemo(() => {
    const byMint = new Map<string, MockCoin>();
    for (const coin of visibleNewPairs) {
      if (coin.id) byMint.set(coin.id, coin);
    }
    return byMint;
  }, [visibleNewPairs]);
  const visibleCoinByMintRef = useRef(visibleCoinByMint);
  visibleCoinByMintRef.current = visibleCoinByMint;

  const dismissWalletToast = useCallback((id: string) => {
    setWalletNoticeToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    setWalletNoticeToasts((current) => {
      let changed = false;
      const next = current.map((toast) => {
        if (toast.kind !== 'trade' || toast.ticker !== 'UNKNOWN') return toast;
        const ticker = resolveTickerForMint(toast.mint, tickerByMint);
        if (!ticker) return toast;
        changed = true;
        return { ...toast, ticker };
      });
      return changed ? next : current;
    });
  }, [tickerByMint]);

  useEffect(() => {
    const isTracked = (coin: MockCoin) =>
      Boolean(coin.creator) && trackedWallets.toastAddressSet.has(coin.creator!);
    const matches = liveActiveNewPairs.filter(isTracked);
    if (!walletMintToastsPrimed.current) {
      if (liveActiveNewPairs.length === 0) return;
      walletMintToastsPrimed.current = true;
      for (const coin of matches) {
        if (!coin.id) continue;
        const shouldToastInitial =
          !walletMintToastsSeen.current.has(coin.id) &&
          (coin.ageMs ?? Number.POSITIVE_INFINITY) <= INITIAL_RECENT_TOAST_MS;
        if (shouldToastInitial) {
          requestMintFlash(coin.id);
          maybePushMintToast(
            coin,
            trackedWallets.lookup(coin.creator),
            dismissWalletToast,
            setWalletNoticeToasts,
            walletMintToastsSeen.current,
            walletToastTimersRef,
          );
        } else markWalletMintSeen(coin.id, walletMintToastsSeen.current);
      }
      return;
    }

    for (const coin of matches) {
      if (!coin.id || walletMintToastsSeen.current.has(coin.id)) continue;
      // Post-prime recency gate (same window as priming): the tracked-wallet
      // set hydrates asynchronously (DB-registry merge lands after mount) and
      // grows mid-session (popover/import). A wallet added AFTER its coin has
      // been sitting on the board must not fire a stale "new mint" toast +
      // flash + chime burst presented as if the mint just happened — old
      // matches are marked seen silently, exactly like pre-prime rows.
      if ((coin.ageMs ?? Number.POSITIVE_INFINITY) > INITIAL_RECENT_TOAST_MS) {
        markWalletMintSeen(coin.id, walletMintToastsSeen.current);
        continue;
      }
      requestMintFlash(coin.id);
      maybePushMintToast(
        coin,
        trackedWallets.lookup(coin.creator),
        dismissWalletToast,
        setWalletNoticeToasts,
        walletMintToastsSeen.current,
        walletToastTimersRef,
      );
    }
  }, [dismissWalletToast, liveActiveNewPairs, requestMintFlash, trackedWallets]);

  useEffect(() => {
    if (toastCandidateEvents.length === 0) return;
    const now = Date.now();
    for (const event of toastCandidateEvents) {
      const flashKey = `${event.signature}:${event.wallet}`;
      if (seenFlashTradeKeys.current.has(flashKey)) continue;
      seenFlashTradeKeys.current.add(flashKey);
      // Same freshness gate as the toast effect below: events accumulated
      // while the pane was dormant (and mount-time cached history) are not
      // live — draining them on reveal must not fire a backlog of flashes.
      if (event.replayed) continue;
      if (now - event.receivedAtMs > LIVE_TRADE_TOAST_MAX_AGE_MS) continue;
      const visibleCoin = visibleCoinByMintRef.current.get(event.mint);
      if (visibleCoin?.id) requestMintFlash(visibleCoin.id);
    }
    if (seenFlashTradeKeys.current.size > 4_000) {
      seenFlashTradeKeys.current = new Set([...seenFlashTradeKeys.current].slice(-2_000));
    }
  }, [requestMintFlash, toastCandidateEvents]);

  useEffect(() => {
    if (toastCandidateEvents.length === 0) return;
    const now = Date.now();
    for (const event of toastCandidateEvents) {
      const seenKey = `${event.signature}:${event.wallet}`;
      if (seenTradeSignatures.current.has(seenKey)) continue;
      // Mark every observed trade as seen up front — even ones we skip —
      // so a stale backfilled trade can never re-trigger on a later
      // render (e.g. when ticker resolution re-runs this effect).
      seenTradeSignatures.current.add(seenKey);
      // Freshness gate: skip replayed history. `receivedAtMs` is stamped
      // by the same clock as `now`, so this comparison is skew-free; the
      // block-time check only rejects events that are unambiguously old
      // even under generous clock-skew assumptions.
      // Connection-backfill replay: fresh receivedAtMs defeats the arrival
      // gate below, so skip explicitly — history must never toast/ring.
      if (event.replayed) continue;
      if (now - event.receivedAtMs > LIVE_TRADE_TOAST_MAX_AGE_MS) continue;
      if (event.blockTimeMs !== null && now - event.blockTimeMs > LIVE_TRADE_TOAST_MAX_BLOCK_AGE_MS) continue;
      const visibleCoin = visibleCoinByMintRef.current.get(event.mint);
      const wallet = trackedWallets.lookup(event.wallet);
      const walletLabel = wallet
        ? displayNameWithEmoji(wallet)
        : `${event.wallet.slice(0, 4)}…${event.wallet.slice(-4)}`;
      const ticker = resolveTickerForMint(event.mint, tickerByMint, visibleCoin) ?? 'UNKNOWN';
      pushTradeToast(
        event,
        ticker,
        walletLabel,
        wallet,
        visibleCoin?.ageLabel ?? null,
        dismissWalletToast,
        setWalletNoticeToasts,
        walletToastTimersRef,
      );
    }
    // Garbage-collect dedupe set to bound memory.
    if (seenTradeSignatures.current.size > 4_000) {
      seenTradeSignatures.current = new Set([...seenTradeSignatures.current].slice(-2_000));
    }
  }, [tickerByMint, toastCandidateEvents, trackedWallets, dismissWalletToast]);

  return (
    <>
      <WalletNoticeToastStack
        toasts={walletNoticeToasts}
        onDismiss={dismissWalletToast}
        onMuteWallet={(address) => trackedWallets.updateWalletPrefs(address, { alertsOnToast: false })}
      />
      <WalletActivityFeed
        dockContext="discover"
        events={feedWalletActivityEvents}
        trackedWallets={trackedWallets}
        tickerByMint={tickerByMint}
      />
    </>
  );
}

const isActiveCoin = (coin: MockCoin): boolean => !coin.graduated;
const keepAlways = (): boolean => true;

/**
 * Rough estimate of whether the viewport (rows mode) has vertical room for a
 * second card row on the target section, after every visible section has its
 * first row. Constants mirror the design tokens (card heights, section
 * chrome, handles); intentionally conservative so the 2nd row only appears
 * when there is clearly space, never pushing a section off-screen.
 */
function computeExtraRowRoom(layout: DiscoverLayout): boolean {
  if (typeof window === 'undefined') return false;
  if (layout.mode !== 'rows' || !layout.autoSecondRow) return false;
  if (!layout.visible[layout.secondRowTarget]) return false;
  const flexIds: SectionId[] = ['new-pairs', 'almost-graduated', 'graduated'];
  const nFlex = flexIds.filter((id) => layout.visible[id]).length;
  if (nFlex === 0) return false;
  const zoom = CARD_ZOOM_BY_SIZE[layout.cardSize] ?? 1;
  const cardRow = 100 * zoom + 12; // regular card row (--card-h-reg) + lane padding
  const sectionOverhead = 64; // header + section padding
  const alphaBlock = layout.visible.alpha ? 192 + sectionOverhead : 0;
  const panelCount = nFlex + (layout.visible.alpha ? 1 : 0);
  const handles = Math.max(panelCount - 1, 0) * 14;
  const base = alphaBlock + nFlex * (sectionOverhead + cardRow) + handles;
  const available = window.innerHeight - 56 - 24; // topnav + main padding
  return available >= base + cardRow + 8;
}

function compareNewPairCoins(a: MockCoin, b: MockCoin): number {
  // Sort ONLY by the creation stamp, tie-broken by the immutable mint key
  // (same rule as compareGraduatedCoins, and the null handling the EVM
  // comparator documents in laneState.ts). The previous `?? lastTradeAtMs`
  // fallback sorted stamp-less rows by a PER-TRADE field, so they climbed
  // to the top of New Pairs on every trade — cards flip-flopping to weird
  // positions under the cursor. Stamp-less rows now sink below stamped
  // ones in a stable key order instead.
  const aTime = a.createdAtMs;
  const bTime = b.createdAtMs;
  if (aTime != null && bTime != null && aTime !== bTime) return bTime - aTime;
  if (aTime != null && bTime == null) return -1;
  if (aTime == null && bTime != null) return 1;
  return coinKey(a).localeCompare(coinKey(b));
}

function compareGraduatedCoins(a: MockCoin, b: MockCoin): number {
  const aTime = a.graduatedAtMs ?? 0;
  const bTime = b.graduatedAtMs ?? 0;
  // Sort ONLY by the immutable graduation time, tie-broken by the immutable
  // mint key. The previous `lastTradeAtMs` tie-break changed on every trade and
  // re-sorted graduated coins that share a graduation millisecond — graduation
  // ordering must be stable (a graduated coin never moves rows).
  return bTime - aTime || coinKey(a).localeCompare(coinKey(b));
}

/** What a section lane iterates: standard sections render structural KEY
 *  slices (stable references across content-only ticks); the Alpha lane
 *  renders its props-fed coins directly. */
type LaneItem = CardItem | string;

/** Module-level (stable identity) lane key — a prop of the memoized
 *  CardLane. Coin items key per call via `coinKey`. */
function laneItemKey(item: LaneItem): string {
  return typeof item === 'string' ? item : coinKey(item);
}

// Retain a buffer above the 50-row display so boundary jitter + user filters
// never starve the row; pruned to the most-recent graduations by time.
// 3x the render limit per bucket: mirrors the backend's 150-deep frame pool
// (select_graduated_broadcast_cards ships top-150 overall UNION top-150
// non-mayhem). This is the graduated lane's FILTER POOL — capping it at the
// old 2x50 silently rebuilt the "filters only match within the batch"
// defect for this one lane while the other three drew from 150.
const STICKY_GRADUATED_RETAIN = DISCOVER_ROW_RENDER_LIMIT * 3;
// Backend-retraction guard: a sticky row absent from this many consecutive
// non-empty live frames (~10s at the ~4 frames/s apply cadence) is treated
// as server-retracted and dropped, instead of surviving the whole session.
// Transient hot-engine eviction churn at the rank boundary is 1-frame-scale,
// so the window smooths it with a wide margin while still honoring the
// applyFreshDiscoverRows invariant ("a bad graduation must not survive
// DB/cache cleanup" — e.g. a mayhem-tombstone false graduation the backend
// later retracts).
const STICKY_GRADUATED_MAX_MISSED_FRAMES = 40;

/**
 * Stable graduated set. `graduatedAtMs` is immutable and graduation almost
 * never reverses, so a graduated coin that transiently drops out of the capped
 * backend frame — hot-engine eviction churn at the rank boundary — must not
 * flash out of the row or resort. We retain graduated coins we have seen,
 * refresh those present in the latest frame, and re-derive a stable top-N
 * ordered by the immutable graduation time. Coins fall off when genuinely
 * displaced by newer graduations (pruned past the retain cap) or when the
 * backend retracts them (absent from many consecutive frames — retention must
 * not defeat server-side cleanup of false graduations, and retained-only rows
 * would otherwise re-persist into the boot cache with permanently frozen
 * stats).
 *
 * The retain cap mirrors the backend's broadcast union (top-N overall PLUS
 * top-N non-mayhem): pruning by recency alone let a mayhem-heavy graduation
 * streak evict exactly the non-mayhem cards the Mayhem-off row needs, undoing
 * the server's non-mayhem headroom.
 */
function useStickyGraduatedCoins(liveGraduated: readonly MockCoin[]): MockCoin[] {
  const retainedRef = useRef<Map<string, { coin: MockCoin; missedFrames: number }>>(new Map());
  return useMemo(() => {
    const retained = retainedRef.current;
    // Only a non-empty live list counts as a frame: an empty array here is
    // "feed not ready yet" (cold mount), not evidence of retraction.
    if (liveGraduated.length > 0) {
      const present = new Set<string>();
      for (const coin of liveGraduated) {
        if (!coin.graduated) continue;
        const key = coinKey(coin);
        retained.set(key, { coin, missedFrames: 0 });
        present.add(key);
      }
      for (const [key, entry] of retained) {
        if (present.has(key)) continue;
        entry.missedFrames += 1;
        if (entry.missedFrames > STICKY_GRADUATED_MAX_MISSED_FRAMES) retained.delete(key);
      }
    }
    const sorted = [...retained.values()].map((entry) => entry.coin).sort(compareGraduatedCoins);
    const capped: MockCoin[] = [];
    let nonMayhemKept = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const coin = sorted[index];
      const mayhem = isMayhemCoin(coin);
      if (index >= STICKY_GRADUATED_RETAIN) {
        if (nonMayhemKept >= STICKY_GRADUATED_RETAIN) break;
        if (mayhem) continue;
      }
      if (!mayhem) nonMayhemKept += 1;
      capped.push(coin);
    }
    if (retained.size > capped.length) {
      const keep = new Set(capped.map(coinKey));
      for (const id of [...retained.keys()]) {
        if (!keep.has(id)) retained.delete(id);
      }
    }
    return capped;
  }, [liveGraduated]);
}

function DiscoverMayhemToggle({
  showMayhem,
  onChange,
}: {
  showMayhem: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={showMayhem}
      onClick={() => onChange(!showMayhem)}
      className="inline-flex h-[22px] shrink-0 items-center gap-2 rounded-full px-2 transition-colors"
      style={{
        color: showMayhem ? 'var(--ink-0)' : 'var(--ink-2)',
        background: showMayhem
          ? 'color-mix(in srgb, #fb5374 16%, var(--input-bg))'
          : 'var(--input-bg)',
        border: `1px solid ${showMayhem ? 'color-mix(in srgb, #fb5374 48%, var(--hairline))' : 'var(--input-border)'}`,
        boxShadow: showMayhem
          ? '0 0 12px -5px #fb5374, inset 0 1px 0 rgba(255,255,255,0.05)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{
          width: 7,
          height: 7,
          background: showMayhem ? '#fb5374' : 'var(--ink-3)',
          boxShadow: showMayhem ? '0 0 8px #fb5374' : 'none',
        }}
      />
      Mayhem {showMayhem ? 'on' : 'off'}
    </button>
  );
}

function isMayhemCoin(coin: MockCoin): boolean {
  // `mode` is the canonical mutex field; fall through to legacy
  // `kinds` for old cached payloads that haven't been re-hydrated by
  // the live-data adapter yet.
  return coin.mode === 'mayhem' || coin.kinds?.includes('mayhem') === true;
}

function queueWalletMintFlash(
  mint: string,
  newPairsPaused: MutableRefObject<boolean>,
  pending: MutableRefObject<Set<string>>,
  setFlashIds: Dispatch<SetStateAction<Set<string>>>,
  timers: MutableRefObject<number[]>,
): void {
  pending.current.add(mint);
  if (!newPairsPaused.current) {
    pending.current.delete(mint);
    startWalletMintFlash(mint, setFlashIds, timers);
  }
}

function startWalletMintFlash(
  mint: string,
  setFlashIds: Dispatch<SetStateAction<Set<string>>>,
  timers: MutableRefObject<number[]>,
): void {
  setFlashIds((current) => {
    const next = new Set(current);
    next.add(mint);
    return next;
  });
  timers.current.push(
    window.setTimeout(() => {
      setFlashIds((current) => {
        const next = new Set(current);
        next.delete(mint);
        return next;
      });
    }, 2400),
  );
}

function maybePushMintToast(
  coin: MockCoin,
  wallet: TrackedWallet | undefined,
  dismissWalletToast: (id: string) => void,
  setWalletNoticeToasts: Dispatch<SetStateAction<WalletNoticeToast[]>>,
  seen: Set<string>,
  timers: MutableRefObject<number[]>,
): void {
  if (!coin.id) return;
  markWalletMintSeen(coin.id, seen);
  const walletLabel = wallet ? displayNameWithEmoji(wallet) : 'Wallet';
  const toast: WalletNoticeToast = {
    id: `mint:${coin.id}`,
    kind: 'mint',
    mint: coin.id,
    ticker: coin.ticker.replace(/^\$/, '') || coin.name,
    devBuySol: coin.devBuySol && coin.devBuySol > 0 ? coin.devBuySol : null,
    tradeIsBuy: null,
    tradeSolLamports: null,
    walletLabel,
    soundId: resolveWalletToastSound(wallet),
    walletAddress: wallet?.address ?? coin.creator ?? null,
  };
  setWalletNoticeToasts((current) =>
    [toast, ...current.filter((t) => t.id !== toast.id)].slice(0, 4),
  );
  timers.current.push(
    window.setTimeout(() => dismissWalletToast(toast.id), walletToastTtlMs(TOAST_TTL_MS)),
  );
}

function pushTradeToast(
  event: WalletActivityEvent,
  ticker: string,
  walletLabel: string,
  wallet: TrackedWallet | undefined,
  ageLabel: string | null,
  dismissWalletToast: (id: string) => void,
  setWalletNoticeToasts: Dispatch<SetStateAction<WalletNoticeToast[]>>,
  timers: MutableRefObject<number[]>,
): void {
  const toast = createTradeToast(event, ticker, walletLabel, wallet, ageLabel);
  setWalletNoticeToasts((current) =>
    [toast, ...current.filter((t) => t.id !== toast.id)].slice(0, 4),
  );
  timers.current.push(
    window.setTimeout(() => dismissWalletToast(toast.id), walletToastTtlMs(TRADE_TOAST_TTL_MS)),
  );
}

function setTicker(
  map: Map<string, string>,
  mint: string,
  ticker?: string | null,
  name?: string | null,
): void {
  const resolved = cleanToastTicker(ticker, mint) ?? cleanToastTicker(name, mint);
  if (resolved) map.set(mint, resolved);
}

function resolveTickerForMint(
  mint: string,
  tickerByMint: ReadonlyMap<string, string>,
  visibleCoin?: MockCoin,
): string | null {
  return resolveSharedTicker(mint, tickerByMint, visibleCoin?.ticker);
}

function cleanToastTicker(value: string | null | undefined, mint: string): string | null {
  const cleaned = value?.trim().replace(/^\$/, '');
  if (!cleaned) return null;
  if (cleaned === mint) return null;
  if (/^(unknown|loading|loading metadata)$/i.test(cleaned)) return null;
  return cleaned;
}

function markWalletMintSeen(mint: string, seen: Set<string>): void {
  seen.add(mint);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(WALLET_TOAST_SEEN_KEY, JSON.stringify([...seen].slice(-100)));
  } catch {
    // sessionStorage can be unavailable in restricted browser contexts.
  }
}

function loadSeenWalletMints(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(WALLET_TOAST_SEEN_KEY) ?? '[]',
    ) as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function scheduleDeferredPrefetch(work: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(work, { timeout: 1_200 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 350);
  return () => window.clearTimeout(handle);
}

function readShowMayhem(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SHOW_MAYHEM_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeShowMayhem(show: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHOW_MAYHEM_KEY, show ? 'true' : 'false');
  } catch {
    // Local preference only.
  }
}
