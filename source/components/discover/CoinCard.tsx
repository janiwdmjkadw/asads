'use client';

import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useAuth } from '@clerk/nextjs';
import { Users } from '@/components/listen/icons/Icons';
import { HairlineDivider } from '@/components/listen/primitives';
import {
  hrefForToken,
  navigateToTerminalHref,
  navigateToToken,
  prefetchToken,
} from '@/components/listen/navigation';
import {
  openInNewTab,
  useCardLinkInteractions,
  wantsNewTab,
} from '@/components/discover/cardLinkInteractions';
import { useTokenTradePrewarm } from '@/components/trade/useTokenTradePrewarm';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { unlockTradeSuccessSound } from '@/components/trade/tradeSound';
import { EvmSparkline } from './EvmSparkline';
import { HideTokenButton } from './HideTokenButton';
import {
  deriveChildClientOrderId,
  submitBatchOrder,
  submitOrder,
  type BatchOrderInput,
  type BatchOrderResult,
} from '@/lib/api/orders';
import { routeForWalletCount } from '@/components/trade/walletCountRoute';
import { resolveFailedBatchChildren } from '@/components/trade/batchChildToasts';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import {
  resolveOrderAuthToken,
  orderTokenErrorMessage,
  warmOrderAuthToken,
} from '@/lib/auth/orderAuthToken';
import {
  quickBuyLamports,
  selectActivePresetForSection,
  useTradeStore,
} from '@/lib/state/trade-store';
import { isUsdcPair } from '@/lib/trade/spend-currency';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import { compactNumberCoarse } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { useResolvedTokenImage } from '@/lib/token-image';
import { DiscoverCoinStoreContext } from './discoverFeedStore';
import {
  CardLiveContext,
  readCardCoin,
  useCardCoinSlice,
  useCardLiveHandle,
  useCoinSliceWithHandle,
} from './cardLiveSlice';
import { isFeedScrollActive } from './feedNavigationPause';
import { useCardVisibility } from './layout/cardVisibility';
import { useDiscoverPaneHidden } from './discoverPaneVisibility';
import type { MockCoin } from './mockCoins';
import {
  marketCapColorForSection,
  marketCapUnknownReason,
  quickbuyIsEnabled,
  scoreUnknownReason,
  txnsQualifier,
  volumeUnknownReason,
} from './cardPresentation';
import {
  tradeBlockedLabel,
  tradeBlockedText,
  type ChainBinding,
} from './chainBinding';
import {
  parseEvmQuickbuyAmount,
  submitEvmQuickbuy,
  useEvmQuickbuyAmountText,
  waitForEvmQuickbuyFinality,
} from '@/lib/evm/quickbuy';
import { browserEvmOrderStorage } from '@/lib/evm/orderStatusApi';
import { useTrackedWalletsContext } from './TrackedWalletsProvider';
import { MetaRow, IconRow, MetricsRow } from './CardMetaRows';

/*
 * ── TWO ROWS ARE OFF WHILE THEY ARE REDESIGNED ───────────────────────
 *
 * `SHOW_META_ROWS` is the pair under the ticker — age, link glyphs,
 * search, crown, holder count, and the @handle line. `SHOW_HOLDINGS_CHIPS`
 * is the four percentage chips under the card: dev, sniper, insider,
 * bundler.
 *
 * Both were clutter under the one thing the board is read for, and four
 * glyph-and-figure pairs on ~130 live cards is the densest and least read
 * thing on the page.
 *
 * TYPED `boolean`, NOT LEFT AS `false`. A `const x = false` narrows to the
 * literal type, TypeScript then treats everything past the guard as
 * unreachable, and the `coin` narrowing above it is discarded — which
 * turns the render below into three type errors. Annotating widens it back
 * to a real branch, so the markup stays live code that still typechecks.
 *
 * Nothing is deleted: every import, selector and subcomponent is still
 * wired, so putting either row back is flipping one flag.
 */
const SHOW_META_ROWS: boolean = false;
const SHOW_HOLDINGS_CHIPS: boolean = false;
import { CardArmedProvider } from './cardArming';
import { BondingBorder, PumpBadge } from './bonding';
import { TokenImagePreview } from './TokenImagePreview';
import { TickerActionsPopover } from './TickerActionsPopover';
import type { QuickBuySectionId } from '@/lib/state/trade-store';

function buildQuickbuyClientOrderId(mint: string): string {
  // Format: qb-<mint-first-8>-<timestamp>-<rand>. Unique per click,
  // short enough to fit api/'s 128-char cap, traceable in logs.
  const shortMint = mint.slice(0, 8);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `qb-${shortMint}-${ts}-${rand}`;
}

// Bounded cold-window token resolution shared with every trade submit
// surface — see lib/auth/orderAuthToken.ts.
const quickbuyAuthToken = resolveOrderAuthToken;
const quickbuyTokenErrorMessage = orderTokenErrorMessage;

// Graduated coins already warmed on first sight — one entry per mint so
// re-mounts / re-scrolls don't refire the hint (the discovered AMM pool
// structure persists process-wide on the engine, so once is enough).
// Bounded prune (same pattern as warm-mints.ts) keeps a long session
// over a churning feed from growing this without limit.
const GRADUATED_WARM_TTL_MS = 10 * 60_000;
const GRADUATED_WARM_MAX_ENTRIES = 1_000;
const graduatedWarmedAt = new Map<string, number>();

function pruneGraduatedWarmed(now: number): void {
  if (graduatedWarmedAt.size <= GRADUATED_WARM_MAX_ENTRIES) return;
  for (const [mint, warmedAt] of graduatedWarmedAt) {
    if (now - warmedAt >= GRADUATED_WARM_TTL_MS) graduatedWarmedAt.delete(mint);
  }
}

/* Module-level hydration latch. Flips true once the FIRST card's mount
   effect runs (i.e. React hydration has completed for this page load),
   so cards mounted later — SPA navigations, feed inserts — skip the
   pre-hydration fallback anchor entirely and never pay the extra
   post-mount re-render. */
let pageHydrated = false;

function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(pageHydrated);
  useEffect(() => {
    pageHydrated = true;
    setHydrated(true);
  }, []);
  return hydrated;
}

interface CoinCardProps {
  /** Stable feed-store key (`tokenCardKey`) this card subscribes to. */
  cardKey: string;
  /** Fallback row data for static fixtures or transient store/order races. */
  fallbackCoin?: MockCoin;
  /**
   * Which Solana Discover section this card lives in, or `null` when the row
   * does not belong to one.
   *
   * `null` is how a NON-SOLANA row opts out of the whole per-section
   * quick-buy apparatus: the amount slot, the active-preset resolver and the
   * market-cap colour thresholds are all keyed by a Solana section, and there
   * is no honest value to pass for a BSC row. Widening the closed union with
   * fake EVM members would have made every one of those lookups silently
   * return a Solana preset for a BSC token — a money bug wearing a type.
   *
   * Solana call sites pass exactly what they always passed.
   */
  sectionId: QuickBuySectionId | null;
  flash?: boolean;
  /** One-shot cyan attention sweep (fresh graduation) — pairs with the
      graduation bell in attentionSounds; distinct from the amber wallet
      `flash` above. */
  attentionFlash?: boolean;
  imageLoading?: 'eager' | 'lazy';
}

/* ---- Phase-1 live-island slices (see cardLiveSlice.ts) ----------------
 *
 * The card is a static SHELL (structural, low-churn fields only) plus
 * grouped live islands, each subscribing to exactly the field subset it
 * renders. Selectors are module-level (identity-stable, required by the
 * slice cache) and each returns a fresh record whose CONTENT is compared
 * against the previous slice — unchanged islands skip re-rendering, so a
 * market-cap tick re-renders ~30 nodes instead of the whole card tree.
 * Grouping follows the DOM (islands must be contiguous subtrees) and the
 * churn correlation: everything in the stats column moves on the same
 * trade anyway, so splitting it finer buys nothing.
 */

/** Structural slice the shell renders. Changes rarely: metadata resolve
 *  (name/handle upgrade), graduation, mode correction. */
interface ShellCoin {
  id?: string;
  creator?: string;
  ticker: string;
  name: string;
  handle: string;
  quoteMint?: string | null;
  graduated?: boolean;
  /** Absent on every Solana row — see `MockCoin.chainBinding`. */
  chainBinding?: ChainBinding;
}

const selectShellCoin = (coin: MockCoin | undefined): ShellCoin | undefined =>
  coin === undefined
    ? undefined
    : {
        id: coin.id,
        creator: coin.creator,
        ticker: coin.ticker,
        name: coin.name,
        handle: coin.handle,
        quoteMint: coin.quoteMint,
        graduated: coin.graduated,
        /* STRUCTURAL, so it belongs in the shell slice: a row's chain never
           changes under it. Always `undefined` for Solana, so the slice's
           content compare and the shell's re-render cadence are unchanged. */
        chainBinding: coin.chainBinding,
      };

/** Media island: token image + bonding border + pump badge. Churn:
 *  thumb-mirror upgrade (once), octant crossings, graduation. The title
 *  pre-rounds progress so per-trade sub-percent moves don't re-render. */
const selectMediaCoin = (coin: MockCoin | undefined) =>
  coin === undefined
    ? undefined
    : {
        id: coin.id,
        ticker: coin.ticker,
        imageUrl: coin.imageUrl,
        imageFallbackUrl: coin.imageFallbackUrl,
        imagePreviewUrl: coin.imagePreviewUrl,
        bondingProgressBucket: coin.bondingProgressBucket,
        graduated: coin.graduated,
        progressPctRounded:
          typeof coin.bondingProgressPct === 'number' && Number.isFinite(coin.bondingProgressPct)
            ? Math.round(coin.bondingProgressPct)
            : null,
      };

/** Meta stack island: MetaRow (age + link/mode/fee badges) + IconRow
 *  (crown/holders/search) + HandleRow (handle chip + followers). Churn:
 *  age label per second/minute; holders/followers per trade. */
const selectMetaStackCoin = (coin: MockCoin | undefined) =>
  coin === undefined
    ? undefined
    : {
        id: coin.id,
        creator: coin.creator,
        /* The launch tally when the ROW carries one. A chain-bound row does;
           the crown badge must read it from here rather than query the Solana
           creator endpoint, which knows nothing about a `0x` address. */
        creatorStats: coin.creatorStats,
        ticker: coin.ticker,
        handle: coin.handle,
        ageLabel: coin.ageLabel,
        txns: coin.txns,
        score: coin.score,
        holderCount: coin.holderCount,
        viewers: coin.viewers,
        followers: coin.followers,
        links: coin.links,
        mode: coin.mode,
        kinds: coin.kinds,
        quoteMint: coin.quoteMint,
        feeShareRecipients: coin.feeShareRecipients,
        feeShareLocked: coin.feeShareLocked,
        feeShareAuthority: coin.feeShareAuthority,
        /* The ADDRESS only, not the binding object: the binding is rebuilt per
           clock tick by `cardAdapter`, and this slice must not churn once a
           second. `undefined` on every Solana row, so the compare is unchanged
           there. IconRow needs it to withhold the holder ESTIMATE off Solana
           and to search the bare contract address rather than the
           chain-qualified store key — see `MetaRowCoin.chainAddress`. */
        chainAddress: coin.chainBinding?.address,
        chain: coin.chainBinding?.chain,
        evmLaunchpad: coin.evmLaunchpad,
        evmLaunchVariant: coin.evmLaunchVariant,
        evmLaunchProfile: coin.evmLaunchProfile,
      };

/** Stats island: the right column's MC / V / TX readouts. Churn: every
 *  trade (these values are why the card ticks at all). */
const selectStatsCoin = (coin: MockCoin | undefined) =>
  coin === undefined
    ? undefined
    : {
        marketCap: coin.marketCap,
        marketCapUsd: coin.marketCapUsd,
        bondingProgressPct: coin.bondingProgressPct,
        volume: coin.volume,
        txns: coin.txns,
        score: coin.score,
        /* Carried so the island can EXPLAIN an absent figure instead of
           printing a bare dash — or, better, render the NATIVE figure it is
           holding instead of an unknown. All of these are `undefined` on every
           Solana row, so the slice's content compare is unchanged there. */
        volumeNativeText: coin.volumeNativeText,
        marketCapNativeText: coin.marketCapNativeText,
        nativeUnitSymbol: coin.nativeUnitSymbol,
        usdBasisText: coin.usdBasisText,
        priceText: coin.priceText,
        priceSourceText: coin.priceSourceText,
        countsArePartial: coin.countsArePartial,
        chainBinding: coin.chainBinding,
      };

/**
 * Score island: the big number inside the quickbuy button.
 *
 * `value: null` = UNSCORED, which is not the same as scored zero — 0.0 is the
 * worst possible reading and would libel an unscored token. The
 * `coin === undefined` branch keeps its historical `0` so the transient
 * store/removal race renders exactly as it did before; only a coin that is
 * genuinely present WITHOUT a score reaches the unscored branch.
 *
 * `unavailableReason` rides ALONGSIDE rather than replacing the null, because
 * a chain-bound producer refuses a score it cannot compute and says why. The
 * dash is the same dash; what changes is that a user can now find out it means
 * "this market is priced in NVDA" rather than "something is broken".
 */
const selectScore = (coin: MockCoin | undefined) =>
  coin === undefined
    ? { value: 0, unavailableReason: undefined }
    : { value: coin.score ?? null, unavailableReason: coin.scoreUnavailableReason };

/** Holdings island: MetricsRow percentages (backend hydration + refresh). */
const selectHoldingsCoin = (coin: MockCoin | undefined) =>
  coin === undefined
    ? undefined
    : {
        creator: coin.creator ?? null,
        devHoldingsPct: coin.devHoldingsPct,
        sniperHoldingsPct: coin.sniperHoldingsPct,
        bundlerHoldingsPct: coin.bundlerHoldingsPct,
        insiderHoldingsPct: coin.insiderHoldingsPct,
        /* WHY the four above are dashes, so the row's absence is legible.
           Without it an `unanchored` token — one whose shares can never be
           measured — renders identically to one the backfill has simply not
           reached yet, and only the second improves by waiting. */
        holdingsUnavailableReason: coin.holdingsUnavailableReason,
        holdingsQualifier: coin.holdingsQualifier,
      };

interface CoinCardViewProps {
  shell: ShellCoin;
  /**
   * Which Discover section this card lives in. Drives the per-section
   * quick-buy amount: each section maintains its own
   * `quickBuyAmountsBySection[sectionId]` slot in the trade-store and
   * server-side `quick_buy_lamports` JSONB. Required because there is
   * no longer a single global amount — the empty/null state must
   * scope to a section so a user's "no Alpha QB" doesn't disable
   * Graduated QB. `null` for a row outside the Solana sections — see
   * `CoinCardProps.sectionId`.
   */
  sectionId: QuickBuySectionId | null;
  flash?: boolean;
  attentionFlash?: boolean;
  imageLoading?: 'eager' | 'lazy';
}

/* Handle truncation is JS-driven so the cap is deterministic and the
   HandleRow never overflows the stat column at runtime. The cap slides
   based on the followers value's character count — wider followers
   leave less room for the chip, so the chip yields more chars to keep
   the row inside its budget.

   Decimal-bearing values like `1.51K` / `99.9K` carry visual density
   that pure char count under-weights, so they shave an extra char off
   the chip's allowance via the dot penalty below. CSS-only truncation
   proved unreliable in the nested inline-flex layout (text-overflow on
   a flex container with anonymous text children doesn't take effect
   across browsers). */
const HANDLE_MAX_BASE = 14;
const HANDLE_MAX_FLOOR = 8;
const FOLLOWERS_BASELINE_CHARS = 3;

function truncateHandle(handle: string, followers: string): string {
  const reserve = Math.max(0, followers.length - FOLLOWERS_BASELINE_CHARS);
  const dotPenalty = followers.includes('.') ? 1 : 0;
  const max = Math.max(HANDLE_MAX_FLOOR, HANDLE_MAX_BASE - reserve - dotPenalty);
  return handle.length > max ? `${handle.slice(0, max - 1)}…` : handle;
}

function ScoreValue({
  value,
  unavailableReason,
}: {
  value: number | null;
  unavailableReason?: string;
}) {
  if (value === null) {
    /* UNSCORED. Rendering "0.0" here would put the worst possible reading on a
       token nobody scored. A muted dash at the same optical weight keeps the
       card's vertical rhythm without making a claim.

       THE REASON IS RENDERED WHEN THE ROW CARRIES ONE. This used to state a
       single generic — "signals this chain does not publish" — which was a
       guess about why, and by the time chain-bound rows arrived it was the
       WRONG guess: the producer computes the same score Solana does and
       REFUSES it in named cases (a market quoted in a stock token, a partial
       tape, an unmeasured volume window). Each calls for a different response
       from the reader, and each is on the row. The generic survives only for a
       row that carries no reason at all. The choice lives in
       `cardPresentation.ts` with the card's other absence rules, because this
       component cannot be linked by the test suite (Clerk's ESM entry). */
    const title = scoreUnknownReason(unavailableReason);
    return (
      <span
        aria-label="not scored"
        title={title}
        className="inline-flex items-baseline justify-center"
        style={{ opacity: 0.35 }}
      >
        —
      </span>
    );
  }
  const [whole, fraction = '0'] = value.toFixed(1).split('.');

  return (
    <span aria-label={`${whole}.${fraction}`} className="inline-flex items-baseline justify-center">
      <span aria-hidden>{whole}</span>
      <span
        aria-hidden
        className="inline-flex justify-center overflow-visible"
        style={{ width: '0.34em' }}
      >
        .
      </span>
      <span aria-hidden>{fraction}</span>
    </span>
  );
}

function HandleRow({ coin }: { coin: { handle: string; followers: string } }) {
  /* Explicit 16px heights (not `h-5` ≈ 17.5px at the 14px root font):
     the row sits in a whole-pixel 16px grid track in CoinCard's stat
     column, tightened when MetricsRow joined the stack. */
  return (
    <div className="flex items-center gap-1 h-[16px]">
      {/* Neutral chrome at all times — no hover effect. Chrome matches
          Trade's age pill (rgba-white 4% bg + var(--hairline) + ink-1),
          tightened down for the compact Discover card footer. */}
      <span
        className="handle-chip inline-flex items-center h-[16px] px-2 rounded text-[9px] leading-none whitespace-nowrap shrink-0"
        title={coin.handle}
        style={{
          color: 'var(--ink-1)',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--hairline)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          fontWeight: 500,
        }}
      >
        {truncateHandle(coin.handle, coin.followers)}
      </span>
      <span className="w-px h-[12px] bg-[var(--hairline)] shrink-0" />
      <span
        className="inline-flex items-center gap-0.5 tabular-nums text-[9px] leading-none shrink-0"
        style={{ color: 'var(--ink-1)' }}
      >
        <Users
          style={{ width: 10, height: 10, display: 'block' }}
        />
        <span>{coin.followers}</span>
      </span>
    </div>
  );
}

/**
 * No-flash token artwork: a neutral surface holds the slot while bytes
 * arrive, then the image fades in 120ms instead of popping. `loaded` is
 * React state (NOT an inline style mutation) so per-tick card re-renders
 * can never reset a painted image back to transparent; it resets only when
 * the src actually changes (fallback-chain swap / card recycled). The ref
 * check covers cache hits whose load event fires before React attaches
 * onLoad. First-row eager images hint the network scheduler.
 */
function FadeInTokenImage({
  src,
  alt,
  loading,
  onError,
  onLoad,
}: {
  src: string;
  alt: string;
  loading: 'eager' | 'lazy';
  onError: () => void;
  onLoad?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [src]);
  return (
    <img
      ref={(el) => {
        if (el && el.complete && el.naturalWidth > 0) {
          setLoaded(true);
          onLoad?.();
        }
      }}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      fetchPriority={loading === 'eager' ? 'high' : 'auto'}
      className="w-full h-full object-cover"
      style={{
        background: 'var(--surface-3)',
        opacity: loaded ? 1 : 0,
        transition: 'opacity 120ms ease-out',
      }}
      onLoad={() => {
        setLoaded(true);
        onLoad?.();
      }}
      onError={onError}
    />
  );
}

/**
 * Per-coin subscriber wrapper. Subscribes to ONLY the STRUCTURAL slice
 * of this coin (`selectShellCoin`) — churny value ticks notify the
 * card's live islands directly and never re-render the shell. `memo`
 * skips the re-render the parent `RowSection` would otherwise force
 * every tick (props are the stable `cardKey` + flash/section). Returns
 * null only on a transient removal race.
 */
export const CoinCard = memo(function CoinCard({
  cardKey,
  fallbackCoin,
  sectionId,
  flash = false,
  attentionFlash = false,
  imageLoading = 'lazy',
}: CoinCardProps) {
  // Off-screen cards stay mounted but pause their feed subscriptions, so
  // they stop re-rendering on every tick. On re-entering view the
  // subscriptions resume and read the latest snapshot, so the card is
  // never stale. The hidden persistent Discover pane also freezes cards
  // directly: a display:none subtree's IntersectionObserver never fires,
  // so the cards visible at hide time would otherwise keep re-rendering
  // invisibly at full feed rate for the whole trade-page dwell.
  const visible = useCardVisibility();
  const paneHidden = useDiscoverPaneHidden();
  const live = useCardLiveHandle(cardKey, fallbackCoin, !visible || paneHidden);
  const shell = useCoinSliceWithHandle(live, selectShellCoin);
  // Graduated-only one-shot warm on first sight. AMM pool discovery is
  // the one remaining multi-hundred-ms cold path (p50 130ms / p90 381ms
  // / max ~2.9s in prod), so a graduated coin scrolling into view fires
  // the graduation hint once — the backend service discovers the pool before any
  // click. Everything else the engine needs is a ~1ms loopback read of
  // ingestion's snapshot at click time, so non-graduated coins get no
  // visibility warm at all.
  const graduatedWarmMint =
    visible && !paneHidden && shell?.graduated === true ? (shell.id ?? null) : null;
  useEffect(() => {
    if (!graduatedWarmMint) return;
    if (document.hidden) return;
    const now = Date.now();
    const warmedAt = graduatedWarmedAt.get(graduatedWarmMint);
    if (warmedAt !== undefined && now - warmedAt < GRADUATED_WARM_TTL_MS) return;
    const session = getClerkSession();
    if (session.isSignedIn !== true) return;
    graduatedWarmedAt.set(graduatedWarmMint, now);
    pruneGraduatedWarmed(now);
    prewarmMints([graduatedWarmMint], session.token, {
      graduatedMints: [graduatedWarmMint],
    });
  }, [graduatedWarmMint]);
  if (!shell) return null;
  return (
    <CardLiveContext.Provider value={live}>
      <CoinCardView
        shell={shell}
        sectionId={sectionId}
        flash={flash}
        attentionFlash={attentionFlash}
        imageLoading={imageLoading}
      />
    </CardLiveContext.Provider>
  );
});

/* `memo`: the subscriber wrapper above re-renders on every visibility flip
   (freeze/unfreeze as the card crosses the lane's overscan boundary — dozens
   of flips during a fast scroll) and on fallback-prop churn from order
   commits. The structural slice keeps its reference across both, so those
   re-renders bail out here instead of re-rendering the shell tree. */
const CoinCardView = memo(function CoinCardView({
  shell,
  sectionId,
  flash = false,
  attentionFlash = false,
  imageLoading = 'lazy',
}: CoinCardViewProps) {
  const hydrated = useHydrated();
  // Click-time reads of the card's current coin (see readCardCoin): the
  // navigate/quickbuy handlers need churny fields (marketCap, txns,
  // imageUrl…) exactly once per click, so they read the store instead of
  // subscribing the shell to every tick.
  const store = useContext(DiscoverCoinStoreContext);
  const liveHandle = useContext(CardLiveContext);
  // Phase 7C: clickable when the row carries a real mint id (live
  // pairs only — static mock rows leave `coin.id` undefined).
  const mint = shell.id;
  /* Chain binding decides which of the two action paths this card offers.
     `undefined` on every Solana row, so everything below it is dead weight
     there and the Solana branches are the ones that already existed. */
  const binding = shell.chainBinding;
  const quickBuyAmountSol = useTradeStore(
    (s) => (sectionId === null ? null : s.quickBuyAmountsBySection[sectionId]),
  );
  /* USDC pair: quick-buy is pair-native — it spends USDC from the
     `usdc_trade.default_buy_usdc_micro` preset regardless of the
     global mode, and the hover amount renders in dollars. */
  const pairIsUsdc = isUsdcPair(shell.quoteMint);
  const defaultBuyUsdcMicro = useTradeStore((s) => s.usdcTrade.default_buy_usdc_micro);
  const hasMint = typeof mint === 'string' && mint.length > 0;
  /* The metrics row moves beside the image only when it FITS there. A
     tracked-wallet dev chip adds up to ~90px to the row, so cards that
     carry one need a wider container (560px vs 430px) before the row
     leaves the full-width bottom band. Presence is knowable at render
     (tracker lookup), so the breakpoint is picked per card — content-
     aware without measuring. */
  const trackedWallets = useTrackedWalletsContext();
  const hasTrackedDev = Boolean(shell.creator && trackedWallets.lookup(shell.creator));
  const metricsBesideMin = hasTrackedDev ? 560 : 430;
  /* Real account = `@handle` parsed from a twitter link. The live adapter
     falls back to a shortened mint/creator address when there is none —
     that carries no signal, so the handle row is omitted entirely. */
  const hasAccount = shell.handle.startsWith('@');
  /* Two independent gates:
       - `clickable` (card navigation + prewarm + heartbeat): only
         requires a real mint. The chart should always be reachable;
         a missing QuickBuy amount must not block navigation.
       - `quickbuyEnabled` (the lightning button): requires BOTH a
         mint AND a configured per-section amount. Without an amount
         the button is disabled, the hover state renders only the
         lightning glyph, and a click is a no-op (no toast, no
         fallback default). */
  const hasQuickBuyAmount = quickBuyAmountSol != null;
  const clickable = hasMint;
  // USDC pairs are always pressable: the server-defaulted
  // `default_buy_usdc_micro` is the amount, no per-section setup needed.
  const quickbuyEnabled = quickbuyIsEnabled({
    hasMint,
    sectionId,
    isChainBound: binding !== undefined,
    pairIsUsdc,
    hasQuickBuyAmount,
  });
  /* Prewarm is a SOLANA engine hint: it asks the backend service/the execution engine to
     discover an AMM pool and warm quote/cashback caches for a base58 mint.
     Firing it with a chain-qualified EVM key would be a pointless round trip
     at best and a lookup for a mint that cannot exist at worst, so a bound
     row warms nothing. (The EVM engine has no equivalent hint endpoint; when
     one lands this is where it attaches.) */
  const { prewarmNow, startHeartbeat, stopHeartbeat, visibleRef } = useTokenTradePrewarm(
    hasMint && binding === undefined ? mint : null,
    { graduated: shell.graduated === true },
  );
  const { getToken } = useAuth();
  // Optimistic quickbuy: a click attempts the order as soon as Clerk is
  // signed in, without waiting on the /me round-trip or trading-authorization
  // sync; intake validates server-side and prompts only if truly needed.
  const { decision: tradingReadyDecision, requireTradingReady } = useRequireTradingReady({
    optimistic: true,
  });
  const pushPendingActivity = useTradeActivityStore((s) => s.pushPending);
  const markActivityError = useTradeActivityStore((s) => s.markError);
  const dismissActivity = useTradeActivityStore((s) => s.dismiss);
  // Slice "Multi-wallet split buy/sell orders": QuickBuy honors the
  // current multi-wallet selection. With 1 wallet selected we pass
  // `wallet_account_id` explicitly (previously the field was
  // omitted, which made the api/ silently fall back to the user's
  // primary even when a non-primary wallet was selected). With 2+
  // wallets, we route through `/api/v1/trade/batch-orders` with
  // equal split — total spend equals the QuickBuy preset, divided
  // across selected wallets, same semantics as the Buy tab.
  const multiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );

  // Quickbuy is fire-and-forget by design — the button label NEVER
  // changes after a click. Per-card progress lives in the global
  // top-of-screen toast stack (see `<TradeActivityToasts />` in
  // `<TerminalShell />`) so a user can spam-click without the chip
  // morphing under their pointer.
  //
  // Routing forks on `routeForWalletCount(multi.length)`:
  //   - 'single' → POST /api/v1/trade/orders with explicit
  //     `wallet_account_id` (no more "silently falls back to
  //     primary" bug).
  //   - 'batch'  → POST /api/v1/trade/batch-orders with equal split
  //     across the selected wallets, total = the QuickBuy preset.
  const handleQuickbuy = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    // Latency head stamp: capture the press clock before any other work so
    // the trace's `clickedAtMs` is the true press time (matches TradePanel /
    // InstantTradeBox sending `clientTsMs`).
    const clickedAtMs = Date.now();
    e.stopPropagation();
    if (!quickbuyEnabled || typeof mint !== 'string') return;
    /* HARD money guard. A row outside the Solana sections has no
       `quickBuyAmountsBySection` slot and no Solana mint; submitting here
       would post a Solana order for another chain's token. `quickbuyEnabled`
       is already false in that case — this is the belt to that braces, sited
       where the spend happens rather than where the button is styled. */
    if (sectionId === null || binding !== undefined) return;
    // Press-time token warm (fire-and-forget, single-flight): quickbuy
    // submits at pointerdown; a cold Clerk mint starts here so the
    // submit's `resolveOrderAuthToken` joins the same in-flight request.
    warmOrderAuthToken(getToken);
    /* `quickbuyEnabled` already implies a non-null amount for SOL
       pairs, but TypeScript can't see through the composite boolean.
       Re-narrow explicitly so the rest of the handler can do
       arithmetic on a `number`. USDC pairs size from the
       `default_buy_usdc_micro` preset instead (read at click time
       below), so they skip this gate. */
    if (!pairIsUsdc && quickBuyAmountSol == null) return;
    /* Trading-presets slice: every buy trade reads its slippage,
       priority fee, bribe, and send mode from the per-section ACTIVE
       preset's `buy` block. Read at CLICK time via
       getState() — these values are only used to build the order body,
       never rendered, so subscribing ~200 mounted cards to every store
       update was pure overhead (same pattern as QuickBuyPanel's preset
       click handler). The resolver prefers the
       `active_by_section[sectionId]` override, falling back to the
       global `active_index` for sections without an override. */
    const tradeState = useTradeStore.getState();
    const buyPreset = tradeState.tradePresets.presets[
      selectActivePresetForSection(tradeState.tradePresets, sectionId)
    ].buy;
    const slippageBps = buyPreset.slippage_bps;
    const priorityLamports = buyPreset.priority_lamports;
    const bribeLamports = buyPreset.bribe_lamports;
    const sendMode = buyPreset.send_mode;
    // Self-warm: fire an IMMEDIATE prewarm before any other work so the
    // engine's quote/cashback caches start warming in parallel with the
    // order POST. The card's pointer-down already warms on mouse clicks
    // (~80ms head start), but this also covers keyboard/programmatic
    // clicks that never emit pointer-down — and the order path no longer
    // depends on a bubbled event firing first. The TRAILING_REFIRE_MS
    // cooldown dedups it against a recent pointer-down warm, so no
    // double POST.
    prewarmNow();
    // The press IS the user gesture — arm the success chime now so the
    // async confirmation (TradeActivityToasts) is allowed to play it.
    unlockTradeSuccessSound();
    // Synchronous gate check — opens Clerk modal / wallet panel when
    // needed. Already-cached useMe() makes this an in-memory check.
    if (!requireTradingReady()) return;

    // On a cold boot the multi-selection store may not have hydrated yet. The
    // readiness gate above already resolved (and approved) the effective wallet
    // via the same reconciled default, so submit against THAT wallet rather
    // than letting the empty set fall through to api/'s implicit primary
    // resolution — this stays correct even when the default eligible wallet is
    // not the primary (e.g. primary archived). A real multi-selection is used
    // as-is.
    const walletIds =
      multiSelectedWalletAccountIds.length > 0
        ? multiSelectedWalletAccountIds
        : tradingReadyDecision.kind === 'ready' && tradingReadyDecision.walletAccountId !== null
          ? [tradingReadyDecision.walletAccountId]
          : multiSelectedWalletAccountIds;
    const route = routeForWalletCount(walletIds.length);
    const ticker = (shell.ticker || '').replace(/^\$/, '') || shell.name;
    // USDC pair: spend the micro-USDC preset (read at click time, like
    // the fee preset above). SOL pair: the per-section SOL amount.
    const totalUsdcMicro = pairIsUsdc
      ? String(tradeState.usdcTrade.default_buy_usdc_micro)
      : null;
    const totalLamports = pairIsUsdc ? '0' : quickBuyLamports(quickBuyAmountSol!);
    // Activity toasts display SOL; USDC quickbuys omit the amount.
    const toastSolAmount = pairIsUsdc ? null : quickBuyAmountSol;

    if (route === 'batch') {
      // Equal-split batch quickbuy. Pre-derive each child's
      // clientOrderId and push one pending activity entry per child
      // BEFORE firing the HTTP call so the global toast stack shows
      // one row per wallet immediately (matches the TradePanel batch
      // buy flow).
      const clientParentId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `qb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const perChildSol =
        toastSolAmount === null ? null : toastSolAmount / walletIds.length;
      const input: BatchOrderInput = {
        side: 'buy',
        clientParentId,
        walletAccountIds: [...walletIds],
        mint,
        graduated: shell.graduated === true,
        ...(pairIsUsdc
          ? { amountUsdcMicro: totalUsdcMicro! }
          : { amountLamports: totalLamports }),
        maxSlippageBps: slippageBps,
        priorityLamports,
        bribeLamports,
        sendMode,
        origin: 'manual_ui',
        clientTsMs: clickedAtMs,
      };
      // The POST body only needs `clientParentId` (child ids are derived
      // server-side with the same SHA-256 scheme), so fire it IMMEDIATELY
      // and run the SubtleCrypto child-id derivation + toast pushes
      // concurrently — the order no longer serializes behind digest work.
      const resultPromise: Promise<BatchOrderResult | null> = (async () => {
        const authToken = await quickbuyAuthToken(getToken);
        if (authToken === null) return null;
        return submitBatchOrder(input, { authToken });
      })();
      void (async () => {
        let childIds: string[];
        try {
          childIds = await Promise.all(
            walletIds.map((wid) => deriveChildClientOrderId(clientParentId, wid)),
          );
        } catch (err) {
          // Couldn't compute child ids (SubtleCrypto missing). Fall
          // back to a single pending entry surfacing the error.
          resultPromise.catch(() => undefined);
          const fallbackId = buildQuickbuyClientOrderId(mint);
          pushPendingActivity({
            id: fallbackId,
            mint,
            ticker,
            side: 'buy',
            solAmount: toastSolAmount,
          });
          markActivityError(fallbackId, (err as Error).message ?? 'network error');
          return;
        }
        childIds.forEach((cid, i) => {
          pushPendingActivity({
            id: cid,
            mint,
            ticker,
            side: 'buy',
            solAmount: perChildSol,
            walletAccountId: walletIds[i] ?? null,
          });
        });
        try {
          const result = await resultPromise;
          if (result === null) {
            const msg = quickbuyTokenErrorMessage();
            for (const cid of childIds) markActivityError(cid, msg);
            return;
          }
          if (result.kind === 'reauth') {
            // Context-aware copy: mid-bootstrap users get "still signing
            // in — tap again" instead of a misleading 'sign in required'.
            const msg = quickbuyTokenErrorMessage();
            for (const cid of childIds) markActivityError(cid, msg);
          } else if (result.kind === 'invalid_input') {
            for (const cid of childIds) markActivityError(cid, result.reason);
          } else if (result.kind === 'error') {
            for (const cid of childIds) markActivityError(cid, result.errorCode);
          } else if (result.kind === 'network_error') {
            for (const cid of childIds) markActivityError(cid, 'network error');
          } else if (result.kind === 'unknown_outcome') {
            // B3: aborted batch POST — the engine may be filling the
            // children. Leave every toast PENDING; the reconciliation
            // flow (fills lookup + order-status fallback) resolves the
            // real outcome. Marking failed here baited double-buys.
          } else if (result.kind === 'failed') {
            const code = result.parent.error_code ?? 'failed';
            for (const cid of childIds) markActivityError(cid, code);
          } else if (result.kind === 'partial_failed') {
            // Children rejected BEFORE engine accept (failed /
            // gate_rejected states) never produce SSE events — resolve
            // their toasts from the POST result (mirrors
            // TradePanel.markFailedBatchChildren). Dispatched children
            // still advance via the SSE feed.
            resolveFailedBatchChildren(result.children, {
              markError: markActivityError,
              dismiss: dismissActivity,
            });
          }
          // 'ok': SSE feed will drive child toasts through
          // submitted → confirmed → filled.
        } catch (err) {
          const msg = (err as Error).message ?? 'network error';
          for (const cid of childIds) markActivityError(cid, msg);
        }
      })();
      return;
    }

    // Single-wallet path (route === 'single' or 'none'). When 'none'
    // (zero selected wallets — shouldn't happen in practice given the
    // store invariant), fall through to api/'s primary-wallet
    // resolution by omitting `wallet_account_id`.
    const clientOrderId = buildQuickbuyClientOrderId(mint);
    const walletAccountId = walletIds[0];
    pushPendingActivity({
      id: clientOrderId,
      mint,
      ticker,
      side: 'buy',
      solAmount: toastSolAmount,
      walletAccountId: walletAccountId ?? null,
    });
    const body = {
      client_order_id: clientOrderId,
      side: 'buy' as const,
      mint,
      graduated: shell.graduated === true,
      ...(pairIsUsdc
        ? { amount_usdc_micro: totalUsdcMicro!, spend_currency: 'usdc' as const }
        : { amount_lamports: totalLamports }),
      slippage_bps: slippageBps,
      priority_lamports: priorityLamports,
      bribe_lamports: bribeLamports,
      send_mode: sendMode,
      origin: 'manual_ui' as const,
      background_ack: true,
      client_ts: clickedAtMs,
      ...(typeof walletAccountId === 'string' && walletAccountId.length > 0
        ? { wallet_account_id: walletAccountId }
        : {}),
    };
    // Fire-and-forget. The handler returns synchronously to the click
    // event so the button is never "busy" — subsequent clicks queue
    // their own orders independently.
    void (async () => {
      try {
        const authToken = await quickbuyAuthToken(getToken);
        if (authToken === null) {
          markActivityError(clientOrderId, quickbuyTokenErrorMessage());
          return;
        }
        const result = await submitOrder(body, { authToken });
        if (result.kind === 'reauth') {
          markActivityError(clientOrderId, quickbuyTokenErrorMessage());
        } else if (result.kind === 'error') {
          markActivityError(clientOrderId, result.errorCode);
        } else if (result.kind === 'network_error') {
          markActivityError(clientOrderId, 'network error');
        }
        // result.kind === 'ok' just means api/ acked. The SSE feed
        // will drive the toast through submitted → confirmed →
        // filled. Nothing else to do here.
      } catch (err) {
        markActivityError(clientOrderId, (err as Error).message ?? 'network error');
      }
    })();
  }, [
    quickbuyEnabled,
    shell.graduated,
    shell.name,
    shell.ticker,
    markActivityError,
    dismissActivity,
    mint,
    multiSelectedWalletAccountIds,
    pairIsUsdc,
    prewarmNow,
    pushPendingActivity,
    quickBuyAmountSol,
    requireTradingReady,
    tradingReadyDecision,
    sectionId,
    getToken,
    /* The chain guard reads this — without it in the deps a card could keep a
       handler closed over a stale `undefined` binding and submit a Solana
       order for a chain-bound row. Structural in practice (a card's chain
       never changes under it), but this handler spends money and must not
       rely on that. */
    binding,
  ]);

  /* THE destination for this row.
     `hrefForToken` builds the single-segment Solana shape (`/trade/<mint>`),
     which is unroutable for a token whose identity is (chain, address) — the
     same address exists on four EVM chains. A bound row therefore carries its
     own href and every link/new-tab/prefetch site below reads this one
     value. Solana rows resolve to exactly `hrefForToken(mint)` as before. */
  const cardHref = !hasMint
    ? null
    : binding !== undefined
      ? binding.href
      : hrefForToken(mint);

  const navigateHere = () => {
    if (!mint) return;
    if (binding !== undefined) {
      /* Deliberately NOT `navigateToToken`: that writes Solana hint memory
         keyed by the mint (sessionStorage `trade:token-hint:<mint>`, the
         recent-mint list, the prewarm mark). Keying any of that by an EVM
         address poisons the Solana trade page's hint lookup for a base58
         string that will never exist. The EVM trade page reads its own
         snapshot from the chain-qualified route instead. */
      // Commit-intent route warm. Unlike the Solana prewarm this only asks
      // Next for the chain-qualified route payload; it never sends the 0x
      // address through Solana's mint caches.
      prefetchToken(binding.address, { chain: binding.chain });
      navigateToTerminalHref(binding.href);
      return;
    }
    // Hint fields (market cap, txns, image) are churny — read the CURRENT
    // coin once at click time instead of subscribing the shell to ticks.
    const coin = liveHandle !== null ? readCardCoin(store, liveHandle) : undefined;
    navigateToToken(mint, {
      name: shell.name,
      symbol: shell.ticker.replace(/^\$/, ''),
      imageUrl: coin?.imageUrl,
      imageFallbackUrl: coin?.imageFallbackUrl ?? null,
      twitterUrl: coin?.links?.twitter ?? null,
      telegramUrl: coin?.links?.telegram ?? null,
      websiteUrl: coin?.links?.website ?? null,
      marketCap: coin?.marketCap,
      txns: coin?.txns,
      sourceSection: sectionId ?? undefined,
      quoteMint: shell.quoteMint ?? null,
    });
  };
  const onCardClick = clickable && cardHref !== null
    ? (e: MouseEvent<HTMLDivElement>) => {
        // Ctrl/Cmd/Shift-click behaves like a browser link: new tab.
        if (wantsNewTab(e)) {
          openInNewTab(cardHref);
          return;
        }
        navigateHere();
      }
    : undefined;
  // Right-click / middle-click → open the chart in a new tab — the card
  // can't be a real anchor (it nests links/buttons).
  const cardLink = useCardLinkInteractions({
    href: clickable ? cardHref : null,
  });
  // Heartbeat-driven server-side prewarm: server polls this mint only
  // WHILE the card is being engaged (pointerEnter/focus → coalesced
  // heartbeat). Pointer-down fires an IMMEDIATE warm (prewarmNow) that
  // skips the 250ms coalesce — on a click the order POST follows ~80ms
  // later, so the immediate warm gets a real head start instead of
  // racing behind its own coalesced batch.
  //
  // Scroll guard: cards sweeping under a stationary cursor fire
  // pointerEnter per card, each starting a heartbeat (3 prefetch GETs +
  // main-thread JSON parses) — a measured frame-drop source while
  // scrolling. Incidental enters during an active lane scroll are
  // skipped; real engagement still warms via pointer-down (immediate)
  // and the next deliberate hover/focus.
  // Hover-machinery arming (see `cardArming.tsx`): the card's tooltips /
  // hover-cards render bare triggers until real hover/focus intent, so
  // feed-tick re-renders skip the Radix wrapper cost entirely. One-way.
  // Enter events during an active lane scroll are skipped (same guard as
  // the heartbeat — cards sweeping under a stationary cursor would arm en
  // masse on the scroll frames); the cursor settling on a card still arms
  // via the one-shot pointer-move below.
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);
  const onCardPointerEnter = () => {
    if (isFeedScrollActive()) return;
    arm();
    if (clickable) startHeartbeat();
  };
  const onCardPointerLeave = clickable ? stopHeartbeat : undefined;
  const onCardFocus = clickable
    ? () => {
        arm();
        startHeartbeat();
      }
    : arm;
  const onCardBlur = clickable ? stopHeartbeat : undefined;
  const onCardPointerDown = clickable
    ? () => {
        arm();
        if (binding === undefined) {
          prewarmNow();
        } else {
          prefetchToken(binding.address, { chain: binding.chain });
        }
      }
    : arm;
  const onCardKeyDown = clickable
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        // Only handle keys aimed at the card itself. Focusable descendants
        // (the quickbuy button) own their Enter/Space activation — without
        // this guard the card-level preventDefault swallowed the button's
        // keyboard click (0 orders) and navigated away instead.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigateHere();
        }
      }
    : undefined;

  return (
    /* Outer Card primitive provides accessibility-aware container
       semantics; visual chrome (gradients / halos / hover lift) keeps
       coming from `discover.css` via the `coin-card` class hook, and
       the explicit inline `style` overrides win over Card's shadcn
       defaults via `tailwind-merge`'s deduplication of rounded/border/
       shadow utilities. */
    <CardArmedProvider value={armed}>
    <Card
      ref={visibleRef}
      /* One-shot arming backstop: a scroll that ends with the cursor
         resting on a card fires no fresh pointer-enter, but the first
         real pointer movement inside the card arms it. The handler
         detaches once armed (prop flips to undefined), so there is no
         steady-state per-move work. */
      onPointerMove={armed ? undefined : arm}
      className="@container coin-card group/coin flex items-stretch h-[var(--card-h-reg)] rounded-[2px] overflow-hidden relative border-0 bg-transparent shadow-none p-0"
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        boxShadow: 'var(--card-shadow)',
        cursor: clickable ? 'pointer' : undefined,
      }}
      role={clickable ? 'button' : undefined}
      data-market-venue={binding?.marketVenue ?? undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onCardClick}
      onPointerDown={onCardPointerDown}
      onPointerEnter={onCardPointerEnter}
      onPointerLeave={onCardPointerLeave}
      onFocus={onCardFocus}
      onBlur={onCardBlur}
      onKeyDown={onCardKeyDown}
      {...cardLink.linkProps}
      aria-label={clickable ? `Open ${shell.ticker} trade page` : undefined}
    >
      {flash ? <span className="coin-card__wallet-flash" aria-hidden /> : null}
      {attentionFlash ? <span className="card-attention-flash" aria-hidden /> : null}
      {/* Pre-hydration navigation fallback: a REAL stretched anchor so a
          click during the cold-load window (server-painted HTML, React
          handlers not yet attached) falls back to the browser's native
          navigation to /trade/<mint>. The overlay sits above the card
          content (z-[2] > the content columns' z-[1]) and UNMOUNTS as
          soon as hydration completes, restoring today's wiring exactly:
          card-level onClick, link/quickbuy stopPropagation, image hover
          previews. In the one-frame window where handlers ARE attached
          but the latch hasn't re-rendered yet, the anchor's onClick
          preventDefault()s and routes through navigateToToken so SPA
          navigation + prewarm + hint memory still apply. aria-hidden +
          tabIndex=-1 keep the accessibility tree unchanged (the Card
          itself remains the role="button" surface). No visual impact:
          the anchor is transparent and absolutely positioned. */}
      {clickable && cardHref !== null && !hydrated ? (
        <a
          href={cardHref}
          aria-hidden
          tabIndex={-1}
          draggable={false}
          className="absolute inset-0 z-[2]"
          onClick={(event) => {
            // Modifier/middle clicks keep native anchor behavior (new
            // tab, window) — only plain left-clicks take the SPA path.
            if (
              event.defaultPrevented
              || event.button !== 0
              || event.metaKey
              || event.ctrlKey
              || event.shiftKey
              || event.altKey
            ) {
              event.stopPropagation();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            navigateHere();
          }}
        />
      ) : null}
      {/* Left ~70% — Axiom-shaped. Two grid rows, one flex stack:

            [ image ][ text stack: identity / meta / handle? ]   row 1 (1fr)
            [      metrics band  OR  · | metrics beside      ]   row 2 (auto)

          The image spans both rows (self-start, so it hugs the top inset).
          The metrics row is the ONLY container-query-adaptive piece:
          narrow cards give it col-span-2 (a full-width band under the
          image); at >= metricsBesideMin (430px, or 560px when a
          tracked-wallet dev chip rides along) it tucks into the text
          column and the image steps up 50 → 60 since it no longer has to
          clear the band. One DOM node, grid placement does the moving.

          Vertical arithmetic (no tuning, no content-between): row 2 is the
          16px metrics ink on a 4px gap-y; row 1 (1fr) absorbs the rest and
          must clear the 56px image frame (50 + 6 ring overhang). The text
          stack (13px identity ink + 16px meta + 16px handle on 4px gaps =
          53px) top-aligns with the frame; every row box equals its INK
          height, so the 4px gaps are what the eye actually sees.

          Insets are metered against VISIBLE edges (the image wrapper is
          ring-inclusive): 12px vertical / 6px horizontal per direct
          feedback ("it should be 12px"; horizontal "can stay how it is").
          EXCEPT the bottom inset in BAND form: with 12px there the fixed
          card height pinched the image→band gap to 2px while 13px sat
          under the band ("more space below than above"). pb 6px re-splits
          that slack evenly (6px above / 6px below the 18px capsule band);
          the beside tiers restore pb 12, where the metrics row self-ends
          onto the approved inset.

          Arbitrary px values (not the rem spacing scale) are deliberate:
          the app's root font is 14px, so scale utilities land on
          fractional pixels (h-4 = 14px, py-3 = 10.5px) and break the
          whole-pixel budget above. Same convention as the rest of the
          card tokens (--card-h-reg, --image-reg). */}
      <div
        className={`flex-1 min-w-0 px-[6px] pt-[12px] pb-[6px] relative z-[1] grid gap-x-[6px] gap-y-[4px] grid-cols-[calc(var(--image-reg)+6px)_1fr] grid-rows-[1fr_auto] ${
          hasTrackedDev
            ? '@[560px]:pb-[12px] @[560px]:[--image-reg:60px]'
            : '@[430px]:pb-[12px] @[430px]:[--image-reg:60px]'
        }`}
      >
        <div className="col-start-1 row-start-1 row-span-2 self-start min-w-0">
          <CardMediaIsland armed={armed} imageLoading={imageLoading} />
        </div>
        {/* Text stack — a plain flex column of ink-height rows on 4px
            gaps. Equal spacing between rows is guaranteed by `gap`, not
            tuned. The handle row renders only for a REAL account
            (`@handle` from a twitter link); mint-fallback handles omit
            the row and the stack simply top-clusters. */}
        <div className="col-start-2 row-start-1 min-w-0 flex flex-col gap-[4px]">
          {/* Identity row box = its INK height (13px ticker), not 16px:
              a 16px box left ~3px of dead space under the text, so the
              visible gap to the meta row read ~7px while meta→handle
              read 4px ("the box for the name goes further down before
              the next gap"). items-baseline keeps the box top at the
              frame's top edge and the smaller name on the ticker's
              baseline. Truncation priority: ticker is the identity, so
              it holds its natural width (`shrink-0`) up to a 60% cap;
              the name is supplementary and yields first via `min-w-0
              truncate` so the ticker-actions glyph sits right AFTER the
              text instead of at the row's far edge. */}
          <div className="h-[13px] flex items-baseline gap-1.5 min-w-0">
            <span
              className="text-[13px] font-semibold leading-none truncate shrink-0 max-w-[60%]"
              style={{ color: 'var(--ink-0)', letterSpacing: '0.02em' }}
            >
              {shell.ticker.replace(/^\$/, '')}
            </span>
            <span
              className="text-[10px] leading-none truncate min-w-0"
              style={{ color: 'var(--ink-2)' }}
            >
              {shell.name}
            </span>
            {hasMint ? (
              /* Icon-only button: its flex baseline is its BOTTOM edge, which
                 under items-baseline would hoist it above the row — so it
                 self-centers in the 16px row instead. */
              <span className="self-center inline-flex shrink-0">
                {/* COPY-ADDRESS must yield the CONTRACT ADDRESS, not the card's
                    chain-qualified store key: a user pasting `bsc:0x…` into a
                    block explorer or a wallet gets nothing. `mint` is already
                    the bare address on Solana, so this is a no-op there. */}
                <TickerActionsPopover mint={binding?.address ?? mint} ticker={shell.ticker.replace(/^\$/, '') || shell.name} />
              </span>
            ) : null}
          </div>
          <CardMetaStackIsland hasAccount={hasAccount} />
        </div>
        {/* Row 2 — the adaptive metrics row. Narrow: spans both columns
            (full-width band under the image). Wide enough to fit (430/560
            by tracked-chip presence): tucks into the text column beside
            the image. self-end pins the ink to the bottom inset. */}
        <div
          className={`row-start-2 self-end min-w-0 ${
            hasTrackedDev
              ? 'col-start-1 col-span-2 @[560px]:col-start-2 @[560px]:col-span-1'
              : 'col-start-1 col-span-2 @[430px]:col-start-2 @[430px]:col-span-1'
          }`}
        >
          <CardHoldingsIsland besideMin={metricsBesideMin} />
        </div>
      </div>

      {/* Right 26% (was 30) — MC + V/TX stats (info-only, click falls
          through to the card-level navigate handler), and the score area
          at the bottom which doubles as the Quickbuy click target. The
          4% went to the text side, funded by coarser V/TX formatting
          ("$83K" / "8.9K" — decimal digits were what forced this column
          wide). MC fit: compactUsd caps the value at 6 mono chars
          ("$99.9M" == "$2.53K" in width; "$999.9K" promotes to "$1M").
          Measured at the row-view minimum: 5-char values fit the cell,
          6-char values overhang it ~3px per side INTO the column's 8px
          x-pads — no clipping (nothing here is overflow-hidden), the
          centered cluster just runs tighter to the divider.

          The whole right column used to be a single `<button>` —
          we split that into a passive stats wrapper + a dedicated
          score-area button. Reason: the user's mental model is
          "the BIG number is the buy button"; making the whole right
          side a buy target made it impossible to skim stats without
          firing a buy on accidental click. */}
      <div
        className="coin-card__action shrink-0 w-[26%] flex flex-col items-stretch px-[8px] py-[12px] relative z-[1]"
        style={{ borderLeft: '1px solid var(--hairline)', background: 'transparent', color: 'inherit' }}
      >
        <CardStatsIsland sectionId={sectionId} />

        {/* PRICE SHAPE, chain-bound rows only. Rendered here and nowhere else
            so the Solana card's markup is untouched — the golden tests pin it
            byte for byte, and a Solana row never reaches this branch. It draws
            nothing (and occupies nothing) until a token has at least two
            priced candle buckets; see `EvmSparkline` for why an empty box
            would be a claim of its own. */}
        {binding !== undefined ? (
          <div className="flex shrink-0 items-center justify-center pb-[2px]">
            <EvmSparkline chain={binding.chain} address={binding.address} />
          </div>
        ) : null}

        <HairlineDivider orientation="h" className="shrink-0" />

        {binding === undefined ? (
          <QuickbuyScoreArea
            ticker={shell.ticker}
            amountSol={quickBuyAmountSol}
            usdcDollars={pairIsUsdc ? defaultBuyUsdcMicro / 1_000_000 : null}
            clickable={quickbuyEnabled}
            onClick={handleQuickbuy}
          />
        ) : (
          <ChainTradeArea
            ticker={shell.ticker}
            binding={binding}
            onOpen={navigateHere}
          />
        )}
      </div>
    </Card>
    </CardArmedProvider>
  );
});

/* The card's pure presentation rules live in `./cardPresentation`, which
   imports no hook, store or component — so they can be unit-tested without
   linking this file's Clerk/trade-store graph (which bun's ESM linker cannot
   load at all). Re-exported here so existing importers are unaffected.

   `marketCapColorForSection` moved there in the same window that the ladder
   itself moved to `./mcTone` for the wallet-activity ledger. Both survive:
   the function lives in `cardPresentation` and reads the ladder from
   `mcTone`, so a graduated card and a ledger row still paint an $86K token
   identically. */
export {
  marketCapColorForSection,
  quickbuyIsEnabled,
} from './cardPresentation';

/* BondingBorder / PumpBadge moved to `./bonding` so the token search
   results render the exact same graduation frame (one source of truth). */

/* ---- live islands ---------------------------------------------------- *
 *
 * Each island subscribes to its own field slice (module-level selectors
 * above) via `useCardCoinSlice` and re-renders only when that slice's
 * CONTENT changes. `memo` keeps shell re-renders (structural changes,
 * arming) from cascading into islands whose props didn't move. All DOM
 * inside the islands is byte-identical to the pre-island card. */

/** Token image + graduation border + pump badge. */
const CardMediaIsland = memo(function CardMediaIsland({
  armed,
  imageLoading,
}: {
  armed: boolean;
  imageLoading: 'eager' | 'lazy';
}) {
  const media = useCardCoinSlice(selectMediaCoin);
  // identityKey arms the painted-src latch: feed frames upgrade
  // imageUrl (source -> mirrored thumb seconds after CREATE) and the
  // latch keeps an already-painted image from refetching + reflashing.
  const {
    src: imageSrc,
    onError: onImageError,
    onLoad: onImageLoad,
  } = useResolvedTokenImage(media?.imageUrl, media?.imageFallbackUrl, media?.id ?? null);
  if (!media) return null;
  return (
    /* `disabled` until armed: the enlarged-preview HoverCard only
       mounts once the card has seen hover intent (cardArming). */
    <TokenImagePreview
      src={imageSrc}
      previewSrc={media.imagePreviewUrl}
      alt={media.ticker}
      disabled={!armed}
    >
      {/* OUTER box = image + the graduation border's 3px overhang per
          side, so the border's OUTERMOST pixel — not the image edge —
          is what obeys the card's 6px inset. Without this the border
          ate into the padding and the top/left visually read ~5px
          while the bottom read ~8px (the "unequal padding" report).
          The inner div is the 60px anchor the border/badge offset
          from; it is NOT clipped, so the border can straddle its
          edge. */}
      <div
        className="token-preview-trigger relative shrink-0 p-[3px]"
        style={{
          width: 'calc(var(--image-reg) + 6px)',
          height: 'calc(var(--image-reg) + 6px)',
        }}
        title={
          media.progressPctRounded !== null
            ? `${media.progressPctRounded}% to graduation`
            : undefined
        }
      >
        <div className="relative h-full w-full">
          <div className="token-img h-full w-full overflow-hidden">
            <FadeInTokenImage
              src={imageSrc}
              alt={media.ticker}
              loading={imageLoading}
              onError={onImageError}
              onLoad={onImageLoad}
            />
          </div>
          <BondingBorder
            bucket={media.bondingProgressBucket ?? null}
            graduated={media.graduated === true}
          />
          <PumpBadge graduated={media.graduated === true} />
          {media.id ? <HideTokenButton mint={media.id} ticker={media.ticker} /> : null}
        </div>
      </div>
    </TokenImagePreview>
  );
});

/** Merged meta row (age + link/mode/fee badges + crown/holders/search)
 *  plus the optional handle row. */
const CardMetaStackIsland = memo(function CardMetaStackIsland({
  hasAccount,
}: {
  hasAccount: boolean;
}) {
  const meta = useCardCoinSlice(selectMetaStackCoin);
  if (!meta) return null;

  /*
   * ── THE META ROWS ARE OFF ────────────────────────────────────────
   *
   * Pulled deliberately, not broken: these two rows are being redesigned
   * and the current pair reads as clutter under the ticker — an age, a
   * run of link glyphs, a search icon, a crown, a holder count and a
   * handle, all at 16px, none of them the thing anyone opens this board
   * to read.
   *
   * The whole render is returned early rather than deleted. Every
   * import, selector and subcomponent stays wired, so putting them back
   * is removing one `return null` — and whatever replaces them starts
   * from the markup below rather than from nothing.
   */
  if (!SHOW_META_ROWS) return null;

  return (
    <>
      {/* Merged meta row: MetaRow's age + link/mode slots keep their
          natural width (shrink-0); the IconRow cluster (search +
          crown + holders) clips first on narrow cards via the
          wrapper's overflow-hidden. */}
      <div className="h-[16px] flex items-center gap-1.5 min-w-0 overflow-hidden">
        <div className="shrink-0">
          <MetaRow coin={meta} />
        </div>
        <IconRow coin={meta} />
      </div>
      {hasAccount ? (
        <div className="h-[16px] min-w-0">
          <HandleRow coin={meta} />
        </div>
      ) : null}
    </>
  );
});

/**
 * THE deliberate unknown.
 *
 * Not a zero and not a dash pretending to be a value: a visibly muted mark
 * that carries WHY on hover and announces itself to assistive tech as
 * "unknown" rather than as punctuation. Every absent figure on a card routes
 * through this one component so the vocabulary cannot drift — the failure
 * this whole exercise exists to avoid is two renderers disagreeing about what
 * "we don't know" looks like.
 *
 * It renders ONLY in the `undefined` branch of a `??`, so a Solana row (which
 * always carries every figure) never reaches it and its DOM is untouched.
 */
function UnknownStat({ reason }: { reason: string }) {
  return (
    <span
      data-unknown="1"
      title={reason}
      aria-label={`unknown — ${reason}`}
      /* Muted and non-bold so it never reads as a magnitude sitting beside
         the real figures in the same column. */
      style={{ color: 'var(--ink-3)', fontWeight: 400, opacity: 0.75 }}
    >
      unknown
    </span>
  );
}

/** Right-column MC / V / TX readouts — the per-trade tick surface. */
const CardStatsIsland = memo(function CardStatsIsland({
  sectionId,
}: {
  sectionId: QuickBuySectionId | null;
}) {
  const stats = useCardCoinSlice(selectStatsCoin);
  if (!stats) return null;
  /* An UNSCORED row is not a badly-scored row. `score >= 7` on an absent
     score would paint the TX figure red — a negative signal invented from
     no signal — so absence takes the neutral ink instead. Solana rows
     always carry a score and are unaffected. */
  const txIsUp = stats.score !== undefined && stats.score >= 7;
  const barColor =
    stats.score === undefined ? 'var(--ink-3)' : txIsUp ? 'var(--up)' : 'var(--down)';
  const marketCapColor = marketCapColorForSection(stats, sectionId);
  /* THE NATIVE MARKET CAP, when there is no dollar one. Exactly the fallback
     the V slot has always had: a real BNB figure in a stated unit beats
     "unknown", and the reason string says the dollar conversion is what is
     missing so nobody reads "8.25 BNB" as "$8.25". Both operands must be
     strings — a figure with no unit label is the one thing worse than no
     figure, because it invites comparison with the USD rows beside it. */
  const marketCapNative =
    typeof stats.marketCapNativeText === 'string'
      && typeof stats.nativeUnitSymbol === 'string'
      ? `${stats.marketCapNativeText} ${stats.nativeUnitSymbol}`
      : null;
  const marketCapReason = marketCapUnknownReason(
    stats.chainBinding,
    stats.marketCapNativeText,
    stats.nativeUnitSymbol,
  );
  /* WHAT THE DOLLAR FIGURE WAS COMPUTED FROM — the oracle pair, its rate and
     its publish time — on the slot that shows the dollar figure. `undefined`
     (not `null`/`''`) when absent so React omits the attribute entirely and
     the Solana markup is byte-identical. */
  const marketCapTitle =
    stats.marketCap === undefined
      ? marketCapNative === null
        ? undefined
        : marketCapReason
      : (stats.usdBasisText ?? undefined);
  /* THE PRICE, which was adapted into `priceText` and then read by nobody.
     Rendered under the MC line rather than beside V/TX: the MC cell is a `1fr`
     row with vertical slack, and the V/TX row is already two clusters wide.
     `null` on every Solana row (no producer sets `priceText`), which is what
     keeps the golden markup below byte-exact — see the className note. */
  const priceLine =
    typeof stats.priceText === 'string' && stats.priceText.length > 0
      ? stats.priceText
      : null;
  return (
    <div className="flex-1 basis-0 min-h-0 grid grid-rows-[1fr_auto_1fr] pointer-events-none">
      {/* items-start (not center): MC's cap line shares the card's 12px
          top inset with the image frame and the identity line — the
          card's top edge reads as ONE line across both columns.
          Centering floated it ~3px lower than the frame.

          The className is CONDITIONAL, and only so that a row with no price
          renders the original string character-for-character: this cell is
          pinned byte-exact by `CoinCard.solanaGolden.tsx`, and a row that
          never has a second child has no reason to become a column. A row
          that DOES carry a price stacks the two lines instead of putting them
          shoulder to shoulder, which would crowd the 14px cap figure. */}
      <div
        className={
          priceLine === null
            ? 'flex min-w-0 items-start justify-center'
            : 'flex min-w-0 flex-col items-center justify-start gap-[2px]'
        }
      >
        <span className="inline-flex items-baseline justify-center gap-[2px] whitespace-nowrap">
          <span
            className="font-mono text-[14px] uppercase leading-none"
            style={{ color: 'var(--ink-3)' }}
          >
            MC
          </span>
          <span
            className="font-mono tabular-nums text-[14px] leading-none"
            style={{ color: marketCapColor, fontWeight: 600 }}
            title={marketCapTitle}
          >
            {stats.marketCap ?? marketCapNative ?? (
              <UnknownStat reason={marketCapReason} />
            )}
          </span>
        </span>
        {priceLine !== null && (
          <span
            className="font-mono tabular-nums text-[9px] leading-none whitespace-nowrap"
            style={{ color: 'var(--ink-3)' }}
            data-testid="card-price"
            /* The PROVENANCE of the number, since "last observed trade",
               "the pool's current tick" and "the launchpad bonding curve" are
               three different claims about how live it is. */
            title={
              typeof stats.priceSourceText === 'string'
                ? `Price from ${stats.priceSourceText}.`
                : undefined
            }
          >
            {priceLine}
            {typeof stats.nativeUnitSymbol === 'string' ? ` ${stats.nativeUnitSymbol}` : ''}
          </span>
        )}
      </div>
      <HairlineDivider orientation="h" />
      {/* V and TX share a single line, grouped and centered as one
          cluster inside the grid cell. Outer flex centers the
          cluster both vertically (`items-center`) and horizontally
          (`justify-center`) in its 1fr cell; inner `inline-flex
          items-baseline` baseline-aligns V (bigger) with TX
          (smaller) so the small TX glyphs sit on V's text baseline
          instead of floating mid-row.

          Type hierarchy: MC 14px / V 11px / TX 7/8px. V sits a
          step below MC, TX a step below V, keeping the visual
          hierarchy intact while leaving enough horizontal headroom
          for realistic magnitude pairs. */}
      <div className="flex min-w-0 items-center justify-center">
        {/* Outer cluster wrapper uses `items-center` (not
            `items-baseline`) so the smaller TX cluster sits at the
            vertical center of the bigger V cluster — same pattern
            the Trade page uses for `symbol + name`. Inner clusters
            stay `items-baseline` so each cluster's label and value
            still share a baseline. */}
        <span className="inline-flex items-center gap-[4px] whitespace-nowrap">
          <span className="inline-flex items-baseline gap-[2px]">
            <span
              className="font-mono text-[11px] uppercase leading-none"
              style={{ color: 'var(--ink-3)' }}
            >
              V
            </span>
            <span
              className="font-mono tabular-nums text-[11px] leading-none"
              style={{ color: 'var(--accent-primary)', fontWeight: 600 }}
              /* A native figure is a REAL measurement in a stated unit; only
                 the dollar conversion is missing. The title says so on both
                 branches, so nobody reads "1.2 BNB" as "$1.2". */
              title={
                stats.volume === undefined
                  ? volumeUnknownReason(
                      stats.chainBinding,
                      stats.volumeNativeText,
                      stats.nativeUnitSymbol,
                    )
                  : /* A dollar figure IS shown: say what rate produced it.
                       `?? undefined` keeps the attribute off the Solana row,
                       which carries no basis — the goldens pin its absence. */
                    (stats.usdBasisText ?? undefined)
              }
            >
              {stats.volume
                ?? (typeof stats.volumeNativeText === 'string'
                  && typeof stats.nativeUnitSymbol === 'string'
                  /* UNIT-LABELLED, always. A bare "1.24" beside a Solana card
                     reading in USD invites comparing two different currencies;
                     fabricating a dollar figure from no rate is worse still. */
                  ? `${stats.volumeNativeText} ${stats.nativeUnitSymbol}`
                  : (
                    <UnknownStat
                      reason={volumeUnknownReason(
                        stats.chainBinding,
                        stats.volumeNativeText,
                        stats.nativeUnitSymbol,
                      )}
                    />
                  ))}
            </span>
          </span>
          <span className="inline-flex items-baseline gap-[1px] font-mono tabular-nums leading-none">
            <span
              className="text-[7px] uppercase"
              style={{ color: 'var(--ink-3)', letterSpacing: '0.14em' }}
            >
              TX
            </span>
            {/* A PARTIAL count is a lower bound, not a measurement: it renders
                with a "≥" so it can never be read as authoritative, and the
                title says why. An ABSENT count renders the deliberate unknown
                rather than a zero. Solana rows are neither, and take the
                original byte-identical branch. */}
            <span
              className="text-[8px]"
              style={{ color: barColor, fontWeight: 600 }}
              title={txnsQualifier(stats.countsArePartial, stats.txns !== undefined) || undefined}
            >
              {stats.txns === undefined ? (
                <UnknownStat reason={txnsQualifier(stats.countsArePartial, false)} />
              ) : stats.countsArePartial === true ? (
                `≥${compactNumberCoarse(stats.txns)}`
              ) : (
                compactNumberCoarse(stats.txns)
              )}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
});

/** The big score number inside the quickbuy button. */
const CardScoreValue = memo(function CardScoreValue() {
  const score = useCardCoinSlice(selectScore);
  return <ScoreValue value={score.value} unavailableReason={score.unavailableReason} />;
});

/** MetricsRow holder percentages (dev/sniper/insider/bundler). */
const CardHoldingsIsland = memo(function CardHoldingsIsland({
  besideMin,
}: {
  besideMin: 430 | 560;
}) {
  const holdings = useCardCoinSlice(selectHoldingsCoin);
  if (!holdings) return null;

  /*
   * ── THE HOLDINGS CHIPS ARE OFF ───────────────────────────────────
   *
   * The four percentage chips under every card — dev, sniper, insider,
   * bundler. Off with the meta rows above and for the same reason: four
   * glyph-and-figure pairs on every one of ~130 cards is the densest
   * thing on the board and the least read.
   *
   * Same posture as the meta stack: an early return, nothing deleted.
   * The selector, the hydration and `MetricsRow` itself are untouched,
   * so this comes back by removing one line.
   */
  if (!SHOW_HOLDINGS_CHIPS) return null;

  return <MetricsRow coin={holdings} besideMin={besideMin} />;
});

/**
 * The action slot for a chain-bound row: open this token's trade page.
 *
 * WHY THIS IS NOT A ONE-CLICK BUY, and why that is a real answer rather than
 * a deferral. Quickbuy spends a per-section preset out of
 * `quickBuyAmountsBySection`, and every one of those amounts is a number of
 * SOL. There is no native-denominated preset for BNB or ETH anywhere in the
 * trade store, so a "0.5" quickbuy on a BSC row would either spend 0.5 BNB
 * where the user configured 0.5 SOL — roughly five times the intended value,
 * and about fifteen times on an ETH chain — or spend an amount the user never
 * chose. Neither is a thing to ship on a live-money control.
 *
 * What the slot does instead is open the page whose panel IS the production
 * buy surface for this chain (`components/trade/EvmTradePanel.tsx`): real
 * native presets, the wallet's real balance, slippage, BigInt-only amounts.
 * The affordance keeps the same optical mass and the same one-click reach.
 * Native-denominated quickbuy presets now exist (`lib/evm/quickbuy.ts`) and
 * attach exactly here — see the notes inside the component.
 *
 * It is DISABLED WITH A REASON whenever the chain says trading is
 * unavailable — a dead control with no explanation reads as breakage, and
 * migrating / underivable-depth / unindexed-venue are three genuinely
 * different situations for the person reading it.
 */
function ChainTradeArea({
  ticker,
  binding,
  onOpen,
}: {
  ticker: string;
  binding: ChainBinding;
  onOpen: () => void;
}) {
  // This slot is a BUY affordance. A buy-only venue must not inherit the
  // aggregate refusal that exists solely because its sell route is unproved.
  const blocked = binding.buyBlockedReason;
  const label = ticker.replace(/^\$/, '') || ticker;
  /* EVM QUICKBUY — the native-denominated preset, never the SOL one. The
     header comment above still holds word for word: `quickBuyAmountsBySection`
     amounts are numbers of SOL and may not size a BNB spend. What ships here
     is the per-chain preset from `lib/evm/quickbuy.ts`, configured explicitly
     on the Discover board, absent by default — so a user who never chose an
     EVM amount never sees a control that spends one. The submit rides the
     trade panel's own order core (same wire body, same pending-order
     correlation record, same no-retry rule on an unknown outcome), and its
     progress lands in the global toast stack like every Solana quickbuy.
     `useSyncExternalStore` serves `null` on SSR, so a static render carries
     no spend control and the Solana golden assertions are untouched. */
  const quickbuyText = useEvmQuickbuyAmountText(binding.chain);
  const { getToken } = useAuth();
  const pushPendingActivity = useTradeActivityStore((s) => s.pushPending);
  const markActivityError = useTradeActivityStore((s) => s.markError);
  const markActivityConfirmed = useTradeActivityStore((s) => s.markConfirmed);
  const markActivityStalled = useTradeActivityStore((s) => s.markStalled);
  const markActivityFinalizing = useTradeActivityStore((s) => s.markEvmFinalizing);
  const markActivityReorged = useTradeActivityStore((s) => s.markEvmReorged);
  const dismissActivity = useTradeActivityStore((s) => s.dismiss);
  const quickbuyWei = quickbuyText === null ? null : parseEvmQuickbuyAmount(quickbuyText);
  const handleEvmQuickbuy = useCallback(() => {
    if (quickbuyWei === null || !binding.quote.isNative) return;
    // The press is the user gesture — arm the confirmation chime now.
    unlockTradeSuccessSound();
    const clientOrderId = `evmqb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    // The toast is pushed BEFORE the async work so the press is acknowledged
    // immediately; `solAmount: null` because the amount is not SOL and the
    // toast must not claim it is (the USDC quickbuy sets the precedent).
    pushPendingActivity({
      id: clientOrderId,
      mint: binding.address,
      ticker: label,
      side: 'buy',
      solAmount: null,
    });
    void (async () => {
      try {
        const authToken = await quickbuyAuthToken(getToken);
        const outcome = await submitEvmQuickbuy({
          chain: binding.chain,
          address: binding.address,
          amountWei: quickbuyWei,
          authToken,
          newClientOrderId: () => clientOrderId,
        });
        switch (outcome.kind) {
          case 'accepted': {
            // Inclusion is immediate progress, not canonical completion. The
            // toast says both while the recovery record suppresses another
            // buy throughout the chain's finality window.
            markActivityFinalizing(clientOrderId);
            // Receipt inclusion is not canonical finality. EVM quickbuys do
            // not ride the terminal order SSE, so resolve them through the
            // chain-qualified durable order-status route. Only a persisted
            // fill earns the success toast.
            const finality = await waitForEvmQuickbuyFinality({
              chain: binding.chain,
              token: binding.address,
              clientOrderId,
              storage: browserEvmOrderStorage(),
              onTransition: (transition) => {
                if (transition.kind === 'reorged') markActivityReorged(clientOrderId);
                else markActivityFinalizing(clientOrderId);
              },
            });
            if (finality.kind === 'filled') {
              // Do not pass the EVM hash as a Solana signature link.
              markActivityConfirmed(clientOrderId);
            } else if (finality.kind === 'refused') {
              markActivityError(clientOrderId, finality.text);
            } else {
              // The bounded foreground watcher ended. Keep the explicit
              // included/finalizing state and durable record; neither is a
              // failure and neither permits another order.
            }
            return;
          }
          case 'reauth':
            markActivityError(clientOrderId, quickbuyTokenErrorMessage());
            return;
          case 'unresolved':
            // NOT a proven failure — the order may be live. The pending
            // record was retained, and the token's trade page restores and
            // reconciles it; this copy sends the user there instead of
            // inviting a second press.
            markActivityStalled(clientOrderId);
            return;
          case 'duplicate_pending':
            // The earlier order owns the one visible lifecycle. The safety
            // guard prevented a second POST, so remove this press's duplicate
            // placeholder instead of displaying a false failure.
            dismissActivity(clientOrderId);
            return;
          default:
            markActivityError(clientOrderId, outcome.text);
        }
      } catch (err) {
        markActivityError(clientOrderId, (err as Error).message ?? 'network error');
      }
    })();
  }, [
    quickbuyWei,
    binding.quote.isNative,
    binding.address,
    binding.chain,
    label,
    getToken,
    pushPendingActivity,
    markActivityError,
    markActivityConfirmed,
    markActivityStalled,
    markActivityFinalizing,
    markActivityReorged,
    dismissActivity,
  ]);
  if (blocked !== null) {
    const reason = tradeBlockedText(blocked);
    return (
      <div
        className="flex-1 basis-0 min-h-0 flex items-center justify-center"
        /* `title` AND an aria-label: the reason must reach a screen reader,
           not only a mouse. */
        title={reason}
        aria-label={`Trading unavailable for ${label}: ${reason}`}
        data-testid="chain-trade-blocked"
        data-blocked-reason={blocked}
      >
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-center leading-tight"
          style={{
            fontFamily: 'var(--mono)',
            color: 'var(--ink-3)',
            border: '1px solid var(--hairline)',
          }}
        >
          {tradeBlockedLabel(blocked)}
        </span>
      </div>
    );
  }
  return (
    /* The slot's geometry is unchanged when no preset is configured: the
       wrapper takes the `flex-1 basis-0` the button used to and the button
       fills it. A configured preset adds the narrow quickbuy control beside
       the TRADE morph. */
    <div className="flex-1 basis-0 min-h-0 flex items-stretch gap-1">
    <button
      type="button"
      data-testid="chain-trade-open"
      aria-label={`Open ${label} trade page on ${binding.chain}`}
      /* Deliberately NOT `.coin-card__quickbuy`: that class is the QUICKBUY
         control's hook — the scroll-time filter suppression keys off it, and
         more importantly a selector (or a test) that finds it has found a
         one-click SPEND affordance. This control spends nothing, so it must
         not answer to that name. It keeps the identical layout/focus classes,
         so the slot's geometry is unchanged. */
      className="coin-card__chain-trade flex-1 basis-0 min-h-0 flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 rounded-[6px]"
      style={{ background: 'transparent', color: 'inherit' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Stop the card-level handler so the page is opened exactly once.
        e.stopPropagation();
        prefetchToken(binding.address, { chain: binding.chain });
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {/* IDLE — THE SCORE, exactly as the Solana slot renders it.
          This slot used to be a static "TRADE" word in both states, so a
          chain-bound card had no score anywhere on it. That was correct while
          the score was Solana-only; `the ingestion service` computes the same score
          now (Solana's arithmetic term for term) and ships it, and a card that
          throws away its single most prominent signal to render a label the
          hover state already carries is spending the card's best real estate
          on nothing.

          The morph is the SAME one `QuickbuyScoreArea` does — idle: big score
          number with the accent glow; hover: the action — down to the size,
          the letter-spacing, the colour and the drop-shadow. That is the point:
          one presentation of one concept, differing only in which action the
          hover reveals, because a chain-bound row's action is opening the page
          whose panel is its real buy surface. Pure CSS, so hovering
          re-renders nothing.

          An UNSCORED row degrades to `ScoreValue`'s muted dash carrying its
          own refusal — never a 0.0, and never a blank slot. */}
      <span
        className="score-text leading-none font-normal group-hover/coin:hidden"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 30,
          letterSpacing: 0,
          color: 'var(--accent-primary)',
          filter: 'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
        }}
      >
        <CardScoreValue />
      </span>
      <span
        className="score-text hidden leading-none font-normal group-hover/coin:inline"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 15,
          letterSpacing: '0.06em',
          color: 'var(--accent-primary)',
          filter: 'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
        }}
      >
        TRADE
      </span>
    </button>
      {quickbuyWei !== null && (
        /* Rendered only with a configured preset — a control that cannot
           spend a chosen amount does not render at all. Deliberately NOT the
           `coin-card__quickbuy` class: that name is pinned by the golden
           tests as the SOL-denominated spend control, and this is not it. A
           non-native-quoted market keeps the button but disables it with the
           reason: the wire's only buy field is wei of the native coin, so a
           native-denominated preset cannot honestly size that market. */
        <button
          type="button"
          data-testid="evm-quickbuy"
          aria-label={
            binding.quote.isNative
              ? `Quick buy ${quickbuyText} ${binding.nativeSymbol} of ${label}`
              : `Quick buy unavailable for ${label}: market not quoted in ${binding.nativeSymbol}`
          }
          title={
            binding.quote.isNative
              ? `Buy ${quickbuyText} ${binding.nativeSymbol} at market (default slippage). Configured on the Discover board.`
              : 'This market is not quoted in the chain’s own coin, so the native-denominated quickbuy cannot size it.'
          }
          disabled={!binding.quote.isNative}
          className="coin-card__evm-quickbuy shrink-0 min-h-0 flex items-center justify-center px-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 rounded-[6px] disabled:cursor-default disabled:opacity-40"
          style={{ background: 'transparent', color: 'var(--up, #37c07a)' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Stop the card-level handler; the press must not also navigate.
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleEvmQuickbuy();
          }}
        >
          <span className="leading-none" style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
            ⚡{quickbuyText}
          </span>
        </button>
      )}
    </div>
  );
}

interface QuickbuyScoreAreaProps {
  /** Display ticker for the aria label (structural, from the shell). */
  ticker: string;
  /**
   * The active section's quick-buy amount in SOL, or `null` when the
   * user has not configured a value for this section. `null` short-
   * circuits the click handler upstream AND removes the amount from
   * the hover render (the user sees only ⚡, no number), per the
   * per-section state slice's empty-state UX.
   */
  amountSol: number | null;
  /**
   * USDC pair: the `default_buy_usdc_micro` preset as whole dollars.
   * Non-null overrides the SOL amount in the hover render ("$10") and
   * the aria copy — USDC pairs always spend USDC (pair-native rule).
   */
  usdcDollars: number | null;
  clickable: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Bottom-of-card score that morphs into a Quickbuy button on
 * card-hover. Two visual states:
 *
 *   idle (no hover): big score number, accent glow
 *   hover:          "BUY <amount>", up-green
 *
 * No in-flight state on the button — every click is fire-and-forget
 * and the chip never disables itself, so a user can spam-click and
 * each click submits its own order. Progress for each submission
 * lives in the global top-of-screen `<TradeActivityToasts />`.
 *
 * The hover swap is pure CSS (`group/coin` on the card outer +
 * `group-hover/coin:` Tailwind selectors), so the React tree
 * doesn't re-render on hover.
 */
function QuickbuyScoreArea({
  ticker,
  amountSol,
  usdcDollars,
  clickable,
  onClick,
}: QuickbuyScoreAreaProps) {
  /* Submit at pointerdown instead of click (same pattern as the Instant
     Trade box's QuickChip): a click waits for pointer-up, paying the
     60-120ms press duration on the order's critical path. The timestamp
     suppresses only the synthetic click of the SAME physical press
     (detail > 0 within the window) — a press whose pointerdown submitted
     but never produced a click (pointercancel, slide-off) clears or ages
     out, so the NEXT distinct press always submits. Keyboard activation
     (Enter/Space → click with detail === 0) always submits; the 750ms
     guard only dedups assistive tech that dispatches BOTH a pointerdown
     and a detail===0 click for one press. */
  const pointerFiredAtRef = useRef(0);
  /* Plain native <button> rather than shadcn Button: the score morph
     between idle and hover-BUY is entirely bespoke (custom font,
     clamp() font-size, drop-shadow filters, group-hover transitions
     keyed by `discover.css`). Wrapping in shadcn Button would bring
     `h-9 px-4 py-2 text-sm font-medium gap-2` defaults that we'd
     spend the entire className overriding. shadcn primitives are
     for surfaces that benefit from a uniform variant system; this
     one doesn't. */
  /* Aria label drops the amount fragment when amountSol is null —
     screen readers shouldn't announce "Quick buy null SOL". The
     button is also `disabled` in that case via `clickable=false`
     upstream, so the affordance is muted entirely. */
  const ariaLabel =
    usdcDollars != null
      ? `Quick buy $${usdcDollars} of ${ticker}`
      : amountSol == null
        ? `Quick buy ${ticker} (set amount above)`
        : `Quick buy ${amountSol} SOL of ${ticker}`;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      /* `suppressHydrationWarning`: `aria-label`, `disabled`, and
         the descendant amount text all depend on the client-only
         `tradePresets` / `quickBuyAmountsBySection` slices which
         are read synchronously from localStorage at module load.
         SSR renders the empty/null defaults; the client re-renders
         with the user's actual values. React's hydration warning
         flags this — we acknowledge the divergence is intentional. */
      suppressHydrationWarning
      className="coin-card__quickbuy flex-1 basis-0 min-h-0 flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 disabled:cursor-default rounded-[6px]"
      style={{ background: 'transparent', color: 'inherit' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Stop the card-level pointerdown (its prewarm is redundant —
        // the submit handler self-warms with the same dedup cooldown).
        e.stopPropagation();
        pointerFiredAtRef.current = Date.now();
        onClick(e);
      }}
      onPointerCancel={() => {
        pointerFiredAtRef.current = 0;
      }}
      onClick={(e) => {
        // Always swallow the click at this node so the card never
        // navigates on a quickbuy press, suppressed or not.
        e.stopPropagation();
        if (e.detail > 0 && Date.now() - pointerFiredAtRef.current < 500) {
          // Synthetic click of the same physical press — already
          // submitted at pointerdown. Consume the stamp so the next
          // activation of any kind submits.
          pointerFiredAtRef.current = 0;
          return;
        }
        if (e.detail === 0 && Date.now() - pointerFiredAtRef.current < 750) return;
        onClick(e);
      }}
      disabled={!clickable}
    >
      {/* Default (no hover) — big score, accent glow. */}
      <span
        className="qb-idle score-text leading-none font-normal group-hover/coin:hidden"
        style={{
          fontFamily: 'var(--mono)',
          // Fixed base size; the card-size preset scales it (and everything
          // else in the card) uniformly via `zoom` on the slot.
          fontSize: 30,
          letterSpacing: 0,
          color: 'var(--accent-primary)',
          filter:
            'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
        }}
      >
        <CardScoreValue />
      </span>
      {/* Card-hover — lightning glyph + amount, side-by-side. Mirrors
          the idle-state score's size, color, and glow exactly so the
          hover state reads as a direct substitute (same visual mass,
          same theme accent). Amount text picks up the `.score-text`
          class to get the same vertical accent → near-white gradient
          treatment the idle score uses; the SVG icon uses solid
          `var(--accent-primary)` (CSS background-clip text gradient
          doesn't apply to SVG path fills, but accent-primary alone
          carries the theme tint cleanly). Both share the score's
          `drop-shadow` glow keyed to `--score-glow`.
          No "◎" SOL marker after the amount: the idle state is the
          bare number ("8.8") with no trailing glyph, so the hover
          stays a clean ⚡+number pair. Adding ◎ at score size
          forced a wrap (`0.1 ◎` too wide for the narrow score column)
          and visually doubled the iconography for no extra
          information. */}
      {/* Hover state — single sub-box (`inline-flex`) holding the
          lightning icon + amount, centered inside the outer button
          (which already does `flex items-center justify-center`).
          One shared size token (`--qb-size`) drives both glyphs so
          they're literally the same height — no separate icon
          clamp. Sized below the idle score's clamp so `⚡ 0.1` fits
          the narrow column without overflowing. */}
      <span
        className="qb-swap hidden group-hover/coin:inline-flex items-center justify-center gap-0.5 leading-none whitespace-nowrap"
        style={
          {
            fontFamily: 'var(--mono)',
            // Fixed base; scaled with the rest of the card via slot `zoom`.
            '--qb-size': '24px',
          } as CSSProperties
        }
      >
        <svg
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          style={{
            width: 'calc(var(--qb-size) * 0.75)',
            height: 'calc(var(--qb-size) * 0.75)',
            display: 'block',
            flexShrink: 0,
            color: 'var(--accent-primary)',
            filter:
              'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
          }}
        >
          <path
            d="M7.92826 0.67044C7.92826 0.480261 7.80541 0.311865 7.62429 0.253817C7.44322 0.195771 7.24536 0.261371 7.13476 0.416118L1.59311 8.17289C1.49784 8.30624 1.48509 8.48165 1.56008 8.62737C1.63507 8.77309 1.78521 8.86467 1.9491 8.86467H5.59493V12.6288C5.59493 12.8196 5.71854 12.9883 5.90036 13.0459C6.08225 13.1035 6.28046 13.0366 6.39025 12.8806L11.9319 5.00555C12.0259 4.87198 12.0377 4.69718 11.9624 4.55221C11.8872 4.40725 11.7374 4.31627 11.5741 4.31627H7.92826V0.67044Z"
            fill="currentColor"
          />
        </svg>
        {/* Mirror the idle score's typography 1:1 — same class set
            (`score-text leading-none font-normal`), same inline
            `fontFamily: var(--mono)`, same `letterSpacing: 0`.
            Rendered UNCONDITIONALLY with empty content when
            `amountSol == null` so the DOM structure stays stable
            between SSR (null defaults) and the client-rehydrated
            tree (localStorage values). React's hydration walker
            requires identical element shape; only text content
            differs, which `suppressHydrationWarning` allows.
            An empty span has zero visible width, so the lightning
            glyph still renders alone in the unconfigured state. */}
        <span
          className="score-text leading-none font-normal"
          suppressHydrationWarning
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 'var(--qb-size)',
            color: 'var(--accent-primary)',
            letterSpacing: 0,
            filter:
              'drop-shadow(0 0 calc(var(--score-glow-intensity, 1) * 12px) var(--score-glow))',
          }}
        >
          {usdcDollars != null ? `$${usdcDollars}` : (amountSol ?? '')}
        </span>
      </span>
    </button>
  );
}
