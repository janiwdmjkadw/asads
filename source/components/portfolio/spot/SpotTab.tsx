'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  coldBootRetry,
  throwOnColdBootReauth,
  withColdBootAuth,
} from '@/lib/api/cold-boot-auth';
import { fetchSpot, type SpotResult } from '@/lib/api/portfolio-spot';
import {
  fetchSpotTransactions,
} from '@/lib/api/portfolio-transactions';
import {
  fetchSpotPerformance,
  type SpotRange,
  type SpotPerfResult,
} from '@/lib/api/portfolio-performance';
import { useMe } from '@/lib/api/me';
import { usePersistentTabVisible } from '@/components/listen/PersistentTabPane';
import { SpotHeader } from './SpotHeader';
import { PerformanceChart } from './PerformanceChart';
import { BalanceBuckets } from './BalanceBuckets';
import { HoldingsTape } from './HoldingsTape';
import { TransactionsRail } from './TransactionsRail';
import { SpotEmpty } from './SpotEmpty';
import { WalletSelect } from './WalletSelect';
import { narrowSpot } from './walletSubset';
import { EvmSpotTab } from './EvmSpotTab';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import type { EvmPortfolioChain } from '@/lib/api/evm-positions';
import type { CSSProperties } from 'react';

/**
 * Slice "Portfolio Spot tab": orchestrator. Owns three react-query
 * subscriptions:
 *
 *   - `spot`         current totals + treemap (15s refetch)
 *   - `performance`  chart series (refetch on range change only)
 *   - `transactions` last 100 txs (60s refetch)
 *
 * Pre-provisioning users (no wallets) get the `SpotEmpty` empty
 * state instead. Coverage warnings (partial backfill, degraded
 * prices) propagate into the header.
 */

const SPOT_REFETCH_MS = 15_000;
type PortfolioSpotChain = 'solana' | EvmPortfolioChain;

export function SpotTab(): React.ReactElement {
  const { getToken } = useAuth();
  const { data: me } = useMe();
  // Cookie-optimistic: fire immediately with the mirrored token (or
  // session cookie) instead of waiting for clerk.browser.js; bail only
  // on a POSITIVE signed-out. Cold-boot reauth answers throw + retry
  // (see cold-boot-auth.ts) so they never cache as a false empty state.
  const mirrorSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const paneVisible = usePersistentTabVisible();
  const enabled = mirrorSignedIn !== false;
  const [portfolioChain, setPortfolioChain] = useState<PortfolioSpotChain>('solana');
  const solanaEnabled = enabled && portfolioChain === 'solana';
  const [range, setRange] = useState<SpotRange>('30d');
  /*
   * Ticked wallet ids. EMPTY MEANS ALL — the same view, and the state
   * the page opens in.
   *
   * `/spot` and `/performance` each take one optional
   * `wallet_account_id`, so a subset of three cannot be requested. It
   * does not have to be: the "all" snapshot carries a
   * `wallet_breakdown` on every holding, and `narrowSpot` reads three
   * of twenty straight out of it. See `walletSubset.ts`.
   */
  const [selectedWallets, setSelectedWallets] = useState<ReadonlyArray<string>>([]);

  /*
   * What the ENDPOINTS get. Exactly one wallet is a request the API can
   * answer; anything else asks for everything and is narrowed here.
   */
  const selectedWallet = selectedWallets.length === 1 ? selectedWallets[0]! : null;
  /* `olderCursor` / `loadedOlder` / `olderRows` / `loadingOlder` are
     gone with the activity rail's pagination. */
  const selectedWalletRef = useRef<string | null>(null);
  /* Named `AndReset` because it used to clear the activity rail's
     pagination too. That is gone; switching wallets is now just
     switching wallets, and every query keys off `selectedWallet`. */
  const setSelectedWalletAndReset = (next: ReadonlyArray<string>): void => {
    selectedWalletRef.current = next.length === 1 ? next[0]! : null;
    setSelectedWallets(next);
  };

  const spotQ = useQuery<SpotResult>({
    queryKey: ['api', 'v1', 'portfolio', 'spot', selectedWallet],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(
          await fetchSpot({ walletAccountId: selectedWallet }, { signal, authToken: token }),
          token,
        ),
      ),
    enabled: solanaEnabled,
    refetchInterval: paneVisible ? SPOT_REFETCH_MS : false,
    refetchOnWindowFocus: paneVisible,
    staleTime: 8_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
    placeholderData: keepPreviousData,
  });

  const perfQ = useQuery<SpotPerfResult>({
    queryKey: ['api', 'v1', 'portfolio', 'spot', 'performance', range, selectedWallet],
    queryFn: ({ signal }) =>
      withColdBootAuth(async (token) =>
        throwOnColdBootReauth(
          await fetchSpotPerformance(
            { range, walletAccountId: selectedWallet },
            { signal, authToken: token },
          ),
          token,
        ),
      ),
    enabled: solanaEnabled,
    refetchInterval: paneVisible
      ? range === '1d'
        ? SPOT_REFETCH_MS * 4
        : SPOT_REFETCH_MS * 12
      : false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    retry: coldBootRetry,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
    placeholderData: keepPreviousData,
  });

  /*
   * The transactions query is gone with the rail it fed. It was a
   * 100-row fetch on a 60-second poll, refetched on every wallet
   * filter change and on every return to the pane, for a panel this
   * page no longer draws.
   */
  const wasPaneVisible = useRef(paneVisible);
  useEffect(() => {
    if (paneVisible && !wasPaneVisible.current && solanaEnabled) {
      void Promise.all([spotQ.refetch(), perfQ.refetch()]);
    }
    wasPaneVisible.current = paneVisible;
  }, [paneVisible, perfQ, solanaEnabled, spotQ]);

  // Derive view state.
  const spot = spotQ.data;
  const perf = perfQ.data;
  /*
   * Narrowed to the ticked wallets. A subset of two or more is computed
   * from the "all" snapshot; one wallet came back filtered from the
   * endpoint already, and zero is the whole thing untouched.
   */
  const spotRaw = spot && spot.kind === 'ok' ? spot : null;
  const spotOk = useMemo(
    () => (spotRaw === null || selectedWallets.length < 2 ? spotRaw : narrowSpot(spotRaw, selectedWallets)),
    [spotRaw, selectedWallets],
  );
  const perfOk = perf && perf.kind === 'ok' ? perf : null;

  // Range-scoped delta — for `1d` we prefer the snapshot endpoint's
  // 24h delta (it's exact from the live aggregate row); for longer
  // ranges, use the perf endpoint's range delta (computed from the
  // first vs last bucket).
  const headerChangeUsd =
    range === '1d'
      ? spotOk?.change24hUsd ?? null
      : perfOk?.changeUsd ?? null;
  const headerChangePct =
    range === '1d'
      ? spotOk?.change24hPct ?? null
      : perfOk?.changePct ?? null;

  // Derive the solana wallet list off /me so the picker renders even
  // before the first /spot response is back. Keep archived wallets in
  // the strip — they still hold funds.
  const solanaWallets =
    me && !me.reauth_required ? me.wallets.filter((w) => w.chain === 'solana') : [];

  // Pre-provisioning / no-wallets state.
  const noWallets = me && !me.reauth_required && me.wallets.length === 0;
  if (noWallets) {
    return (
      <section
        role="tabpanel"
        aria-label="Spot tab"
        className="panel portfolio-panel flex-1 min-h-0 p-3 lg:p-4 overflow-hidden flex flex-col"
      >
        <SpotEmpty kind="no_wallets" />
      </section>
    );
  }

  if (portfolioChain !== 'solana') {
    return (
      <section
        role="tabpanel"
        aria-label="Spot tab"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
      >
        <PortfolioChainTabs selected={portfolioChain} onSelect={setPortfolioChain} />
        <EvmSpotTab chain={portfolioChain} />
      </section>
    );
  }

  const totalUsd = spotOk?.totalUsd ?? 0;
  const degraded = (spotOk?.degradedReasons.length ?? 0) > 0;
  // No wallets is handled above. If wallets exist but every value is
  // zero, render the "fund your wallet" empty state. We still show
  // the chart shell so the user sees the surface.
  const allZero =
    spotOk !== null && totalUsd === 0 && spotOk.holdings.length === 0;

  const liveHoldings = (spotOk?.holdings ?? []).filter((h) => h.amount_ui > 0);

  return (
    /*
     * ── THE WHOLE PANE IS THE CONTAINER ───────────────────────────────
     *
     * Every responsive rule on this page measures THIS box, not the
     * window: a docked tracker takes up to 480px off the side, so a
     * `@media` rule keyed to the viewport would not fire while the thing
     * it is measuring is half the width the rule is reading.
     *
     * It was on the header's wrapper alone, which meant the header
     * responded and the split and the holdings tape below it did not —
     * they were reading a container that was not their ancestor and so
     * never narrowed at all.
     *
     * Safe here because nothing in this subtree is `position: fixed`; an
     * inline-size container becomes the containing block for one.
     */
    <section
      role="tabpanel"
      aria-label="Spot tab"
      className="spl-spot"
      style={{ containerType: 'inline-size', containerName: 'portfolio' }}
    >
      <style>{SPOT_TAB_CSS}</style>

      <PortfolioChainTabs selected={portfolioChain} onSelect={setPortfolioChain} />

      <div className="spot-rise">
        <SpotHeader
          totalUsd={totalUsd}
          changeUsd={headerChangeUsd}
          changePct={headerChangePct}
          range={range}
          onRangeChange={setRange}
          degraded={degraded}
          snapshotAtMs={spotOk?.snapshotAtMs ?? Date.now()}
        />
      </div>

      {/*
        * ── THE CHART IS NOT IN A BOX ─────────────────────────────────
        *
        * It was a 300px `.panel`: a bordered plate with its own ground,
        * holding the line, with the wallet filter chips floating over
        * its top band. Two grounds and a border between the total and
        * the line the total drew.
        *
        * Now it runs on the page itself, directly under the total, at
        * the height the line needs and no more. Nothing frames it; the
        * figures under it and the rule under those are what say where
        * it stops.
        */}
      <div className="spl-chart spot-rise spot-rise-1">
        <PerformanceChart
          points={perfOk?.points ?? []}
          range={range}
          partial={perfOk?.chartPartial ?? false}
          trackingStartedMs={perfOk?.trackingStartedMs ?? null}
          /*
           * THE CHART IS THE ONE THING A SUBSET CANNOT BE COMPUTED FOR.
           * `/performance` returns a series, not a per-wallet
           * decomposition of one, so two or more ticked wallets get the
           * whole book's history under a filtered set of figures. The
           * flag says the chart is showing something narrower than the
           * page only when it truly is.
           */
          walletFiltered={selectedWallets.length > 0}
        />
      </div>

      {/* The wallet filter, on the line under the chart. Realized and
          unrealized used to sit at the other end of it; the line is the
          filter's now. */}
      <div className="spl-under spot-rise spot-rise-1">
        <WalletSelect
          wallets={solanaWallets}
          aggregates={spotOk?.walletAggregates ?? []}
          /* Every wallet's total, always — it is the figure on the
             `All wallets` row, and it has to keep saying what the whole
             book is worth while a subset is being looked at. */
          totalUsd={spotRaw?.walletAggregates.reduce((s, w) => s + w.total_usd, 0) ?? totalUsd}
          selected={selectedWallets}
          onChange={setSelectedWalletAndReset}
        />
      </div>

      <div className="spot-rise spot-rise-2">
        <BalanceBuckets
          solUsd={spotOk?.solUsd ?? 0}
          stableUsd={spotOk?.stableUsd ?? 0}
          splUsd={spotOk?.splUsd ?? 0}
          totalUsd={totalUsd}
        />
      </div>

      {allZero ? (
        <section
          className="panel portfolio-panel spot-rise spot-rise-3"
          style={{
            flex: 1,
            minHeight: 0,
            padding: 16,
            overflow: 'hidden',
          }}
        >
          <SpotEmpty kind="fund" />
        </section>
      ) : (
        /*
         * ── ONE COLUMN, AND IT IS THE HOLDINGS ────────────────────────
         *
         * This was a 1.7 / 1 grid: the token map on the left, `Recent
         * activity` down the right. The activity rail is gone — see
         * below — so the tape takes the width, which is what it wanted:
         * seven columns of figures were being asked to fit in 62% of
         * the page.
         */
        /* Layout in the stylesheet, not inline: the phone rules have to
           be able to turn `flex: 1` and `overflow: hidden` off, and an
           inline style beats any media query that tries. */
        <div className="spl-body spot-rise spot-rise-3">
          {/*
            * ── THE TOKEN MAP IS A TAPE ─────────────────────────────
            *
            * It was a squarified treemap: every holding a rectangle
            * sized by value and filled on a red-to-green ramp, under a
            * section head with an amber tick and `TOKEN MAP` in mono
            * capitals on a 0.14em track, plus three filter chips —
            * a colour-mode toggle, hide dust, hide unknown.
            *
            * A treemap is right at ten thousand rows. A portfolio has
            * fifteen, and at fifteen it is a wall of colour that cannot
            * tell you what anything is worth without a hover. The three
            * chips went with it: dust and unknown sort to the bottom by
            * value on their own, and the 24h column says in figures
            * what the colour ramp was saying in hue.
            */}
          {/*
            * `Recent activity` used to be beside this: a rail of the
            * last hundred transactions, grouped by day, with a
            * `Load older` at the foot.
            *
            * It is a transaction log, and a portfolio is a statement of
            * what you hold — the history is already the chart above,
            * and every one of those rows is one click away on the token
            * itself. What it cost here was the right-hand third of the
            * page and a 60-second poll of an endpoint whose answer
            * nobody was reading.
            */}
          <div className="spl-tape-wrap">
            <HoldingsTape holdings={spotOk?.holdings ?? []} totalUsd={totalUsd} />
          </div>
        </div>
      )}
    </section>
  );
}

export function PortfolioChainTabs({
  selected,
  onSelect,
}: {
  selected: PortfolioSpotChain;
  onSelect: (chain: PortfolioSpotChain) => void;
}) {
  /* Gated HERE rather than at the two call sites, because this component is
     also the only way `portfolioChain` can ever leave `'solana'`: the state
     starts at `'solana'` and `setPortfolioChain` is passed nowhere else, so
     rendering nothing pins the Spot tab to the Solana branch and `EvmSpotTab`
     becomes unreachable without touching the branch itself. */
  const evmEnabled = useEvmEnabled();
  const chains: ReadonlyArray<{ id: PortfolioSpotChain; label: string }> = [
    { id: 'solana', label: 'Solana' },
    { id: 'bsc', label: 'BSC' },
    { id: 'robinhood_chain', label: 'Robinhood' },
  ];
  if (!evmEnabled) return null;
  return (
    <nav
      role="tablist"
      aria-label="Spot network"
      className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--hairline)] bg-[var(--input-bg)] p-1"
    >
      {chains.map((chain) => {
        const active = selected === chain.id;
        return (
          <button
            key={chain.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(chain.id)}
            className="rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={{
              color: active ? 'var(--ink-0)' : 'var(--ink-3)',
              background: active ? 'var(--section-bg)' : 'transparent',
              border: active ? '1px solid var(--hairline-2)' : '1px solid transparent',
            }}
          >
            {chain.label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Pill toggle used above the token map. `tone="warning"` paints the
 * border in `--down` so the "show unknown" affordance reads as a
 * caution surface — the user is opting in to inspect potentially
 * malicious airdrops.
 */
function FilterChip(props: {
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly label: string;
  readonly tone: 'neutral' | 'warning';
  readonly title?: string;
}): React.ReactElement {
  const warning = props.tone === 'warning';
  const style: CSSProperties = {
    height: 24,
    padding: '0 10px',
    borderRadius: 8,
    fontFamily: 'var(--mono, ui-monospace)',
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    lineHeight: 1,
    transition: 'background 80ms ease, color 80ms ease, border-color 80ms ease',
    border: warning
      ? `1px solid color-mix(in srgb, var(--down) ${
          props.active ? 65 : 35
        }%, var(--hairline))`
      : '1px solid var(--hairline)',
    background: props.active
      ? warning
        ? 'color-mix(in srgb, var(--down) 14%, transparent)'
        : 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
      : 'transparent',
    color: props.active
      ? warning
        ? 'var(--down)'
        : 'var(--ink-0)'
      : 'var(--ink-2)',
  };
  return (
    <button
      type="button"
      onClick={props.onToggle}
      role="switch"
      aria-checked={props.active}
      title={props.title}
      style={style}
    >
      {props.label}
    </button>
  );
}

/**
 * Page-scoped motion for the Spot tab. Kept in one injected sheet (the
 * same pattern PerformanceChart uses) so the slice stays liftable and
 * the keyframes interpolate through live theme vars:
 *
 *   - `spot-rise`        the surfaces assemble top-to-bottom on mount,
 *                        each section a beat behind the last.
 *   - `spot-live-pulse`  the header's LIVE dot breathes.
 *   - `spot-bucket-tile` allocation tiles lift on hover.
 *
 * Everything collapses to a still, fully-visible state under
 * `prefers-reduced-motion`.
 */
export const SPOT_TAB_CSS = `
@keyframes spot-rise {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.spot-rise {
  animation: spot-rise 560ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
}
.spot-rise-1 { animation-delay: 70ms; }
.spot-rise-2 { animation-delay: 140ms; }
.spot-rise-3 { animation-delay: 210ms; }
.spot-rise-4 { animation-delay: 280ms; }

/* Wallet filter floating over the chart, pinned to the top-left band.
   NOTE: the panel chrome sets \`.listen-root .panel > * { position: relative }\`
   (specificity 0,2,0), which would otherwise drop this overlay into
   normal flow at the bottom of the panel. We scope the selector through
   \`.listen-root .panel >\` so it outranks that guard and the absolute
   positioning actually sticks. */
.listen-root .panel > .spot-wallet-overlay {
  position: absolute;
  top: 8px;
  left: 10px;
  right: 56px;
  z-index: 6;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.spot-wallet-overlay::-webkit-scrollbar { display: none; }

/* Metallic shine on the hero balance. The base text is always rendered
   as real text; the animated shine is a duplicate absolutely layered on
   top. That makes the effect impossible to "clip out" or disappear: if
   the glint is offscreen, the solid base number is still visible. */
@keyframes spot-balance-shine {
  0%   { background-position: 170% 0; }
  100% { background-position: -70% 0; }
}
.spot-balance-stack {
  position: relative;
  display: inline-block;
}
.spot-balance-base {
  color: color-mix(in srgb, var(--ink-0) 68%, var(--ink-2));
}
.spot-balance-shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(
      100deg,
      transparent 0%,
      transparent 35%,
      color-mix(in srgb, white 72%, transparent) 45%,
      white 50%,
      color-mix(in srgb, white 72%, transparent) 55%,
      transparent 65%,
      transparent 100%
    );
  background-size: 230% 100%;
  background-repeat: no-repeat;
  background-position: 170% 0;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter:
    drop-shadow(0 0 5px color-mix(in srgb, white 28%, transparent))
    drop-shadow(0 0 12px color-mix(in srgb, var(--accent-primary) 18%, transparent));
  animation: spot-balance-shine 1.9s linear infinite;
}

.spot-bucket-tile {
  transition:
    transform 160ms var(--ease-out, ease),
    border-color 160ms var(--ease-out, ease),
    box-shadow 160ms var(--ease-out, ease);
}
.spot-bucket-tile:hover {
  transform: translateY(-2px);
  border-color: var(--hairline-2);
  box-shadow: 0 12px 28px -18px rgba(0, 0, 0, 0.65);
}

/* PnL mood companion — pops with a soft overshoot whenever the mood
   itself changes (timeframe switch or crossing a PnL threshold). */
@keyframes spot-mood-pop {
  0%   { opacity: 0; transform: translateY(2px) scale(0.92); }
  60%  { opacity: 1; transform: translateY(0) scale(1.04); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.spot-mood {
  animation: spot-mood-pop 420ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
  transform-origin: left center;
}

/* Angry tremble while hovered — a fast, small shake so the "don't
   touch me" face reads as genuinely indignant. */
@keyframes spot-mood-shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  20%      { transform: translateX(-1.5px) rotate(-4deg); }
  40%      { transform: translateX(1.5px) rotate(4deg); }
  60%      { transform: translateX(-1.2px) rotate(-3deg); }
  80%      { transform: translateX(1.2px) rotate(3deg); }
}
.spot-mood-mad {
  animation: spot-mood-shake 0.42s ease-in-out infinite;
  transform-origin: center;
}

/* THE STACK -- the portfolio's own art object. Coin-bars fall from
   above, land with a squash, rebound, settle; the gold coin drops last
   and flashes as it seats. One shot on mount, never loops, no sound. */
@keyframes spot-coin-drop {
  0%   { transform: translateY(var(--dropY, -70px)) scaleY(1); opacity: 0; }
  45%  { opacity: 1; }
  58%  { transform: translateY(0) scaleY(1); }
  72%  { transform: translateY(0) scaleY(0.68) scaleX(1.22); }
  86%  { transform: translateY(-4px) scaleY(1.05) scaleX(0.99); }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes spot-coin-flash {
  0%   { box-shadow: 0 0 0 0 transparent; }
  35%  { box-shadow: 0 0 6px 1px rgba(255,255,255,0.9), 0 0 16px 5px currentColor; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
.spot-coin {
  transform-origin: bottom center;
  animation:
    spot-coin-drop 640ms cubic-bezier(0.34, 0, 0.62, 1) var(--cd, 0ms) backwards,
    spot-coin-flash 520ms ease-out calc(var(--cd, 0ms) + 400ms) backwards;
}
@media (max-width: 980px) { .spot-stack { display: none; } }

/* Treemap tiles spring into place, staggered by rank. */
@keyframes spot-tile-pop {
  0%   { opacity: 0; transform: scale(0.82); }
  62%  { opacity: 1; transform: scale(1.025); }
  100% { opacity: 1; transform: none; }
}
.spot-tile-pop {
  animation: spot-tile-pop 440ms cubic-bezier(0.16, 1, 0.3, 1) var(--tp, 0ms) backwards;
}

@media (prefers-reduced-motion: reduce) {
  .spot-coin, .spot-tile-pop { animation: none; }
  .spot-rise { animation: none; opacity: 1; transform: none; }
  .spot-balance-shine { animation: none; background-position: 50% 0; }
  .spot-bucket-tile { transition: none; }
  .spot-bucket-tile:hover { transform: none; }
  .spot-mood { animation: none; opacity: 1; transform: none; }
  .spot-mood-mad { animation: none; }
}
`;
