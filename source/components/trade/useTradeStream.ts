import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { fetchAuthenticatedApi, isTradingApiConfigured } from '@/lib/api/trading';
import {
  submitOrder,
  type OrderIntentRequest,
  type OrderSubmitResult,
} from '@/lib/api/orders';
import { useConnectionStore } from '@/lib/state/connection-store';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { useSeededAuth } from '@/lib/auth/useSeededAuth';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import {
  acquireWalletBalanceStream,
  mintStreamState,
  streamedTokenBalance,
  walletStreamState,
} from '@/lib/state/wallet-balance-stream';
import { fetchHotTradePoll } from './tradeApi';
import { rememberDisplayBalance } from './balanceDisplayCache';
import { useTradeActivityStore } from '@/lib/state/trade-activity-store';
import { tradeTimingNow, type TradePressTiming } from '@/lib/telemetry/tradeTiming';

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Base58, Solana mint length. Mirrors `useUrlMint`'s `validMint` so a
// blank or malformed mint can never compose a `?mint=` request that the
// api/ would only reject with a 400 anyway.
const MINT_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/**
 * Composes the `/api/v1/trade/token-balance` URL. Returns `null` for a
 * blank or malformed mint so callers never fire a `?mint=` request that
 * the api/ would 400 (the symptom behind the trade-page request spam).
 * When the caller supplies a valid UUID for `walletAccountId`, the api/
 * resolves that specific wallet (ownership + Solana + active + not
 * archived + enabled) instead of falling back to the user's primary.
 * Exported for unit tests.
 */
export function buildTokenBalanceUrl(
  mint: string,
  walletAccountId: string | null,
): string | null {
  if (!MINT_REGEX.test(mint)) return null;
  const base = `/api/v1/trade/token-balance?mint=${encodeURIComponent(mint)}`;
  if (walletAccountId !== null && UUID_REGEX.test(walletAccountId)) {
    return `${base}&wallet_account_id=${encodeURIComponent(walletAccountId)}`;
  }
  return base;
}

/**
 * Composes the `/api/v1/trade/positions` URL. The api/ resolves the
 * user's primary wallet when `wallet_account_id` is omitted; malformed
 * UUIDs are dropped (the api/ would 400 them). Exported for unit tests.
 */
export function buildPositionsUrl(walletAccountId: string | null): string {
  const base = '/api/v1/trade/positions';
  if (walletAccountId !== null && UUID_REGEX.test(walletAccountId)) {
    return `${base}?wallet_account_id=${encodeURIComponent(walletAccountId)}`;
  }
  return base;
}

/**
 * Pure `/api/v1/trade/positions` wire row (snake_case `portfolio.positions`
 * columns) → `TradePosition` projection. Rows without the two fields every
 * consumer needs (`mint`, `tokens`) are dropped. Exported for unit tests.
 */
export function mapWirePosition(raw: unknown): TradePosition | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { [key: string]: unknown };
  const mint = row['mint'];
  const tokens = row['tokens'];
  if (typeof mint !== 'string' || typeof tokens !== 'string') return null;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '0');
  const provenance = row['cost_basis_provenance'];
  return {
    mint,
    tokens,
    costBasisLamports: str(row['cost_basis_lamports']),
    costBasisProvenance:
      provenance === 'observed_fill' || provenance === 'imported_from_db'
        ? provenance
        : 'imported_unknown',
    realizedPnlLamports: str(row['realized_pnl_lamports']),
    unrealizedPnlLamports: str(row['unrealized_pnl_lamports']),
    avgEntryPriceLamports: str(row['avg_entry_price_lamports']),
    fillCount: typeof row['fill_count'] === 'number' ? row['fill_count'] : 0,
    venue: row['venue'] === 'pump_amm' ? 'pump_amm' : 'bonding_curve',
  };
}

// Trading lab live data hook. Connects to the /api/v1/trade/stream SSE
// endpoint, tracks a per-mint Position (replacing MockPnL when present),
// and exposes a submit() function that POSTs to /api/v1/trade/orders.
//
// TRD#2 Phase 2: every read here goes through the Clerk-gated
// /api/v1/... routes on api/. The legacy public /api/trade/* routes on
// the backend service are being retired (POST /api/trade/orders is already 403
// at the the edge edge and HMAC-gated at the server).

const TOKEN_BALANCE_IDLE_POLL_MS = 2_000;
const TOKEN_BALANCE_HOT_POLL_MS = 250;

export interface TradePosition {
  readonly mint:                 string;
  readonly tokens:               string;       // decimal lamports / base units
  readonly costBasisLamports:    string;
  readonly costBasisProvenance:  'observed_fill' | 'imported_from_db' | 'imported_unknown';
  readonly totalBoughtLamports?: string;
  readonly totalSoldLamports?:   string;
  readonly realizedPnlLamports:  string;
  readonly unrealizedPnlLamports: string;
  readonly avgEntryPriceLamports: string;
  readonly fillCount:            number;
  readonly venue:                'bonding_curve' | 'pump_amm';
}

export interface TradeOrderResult {
  readonly accepted: boolean;
  readonly key?:     { seq: string; tsMs: number };
  readonly events?:  TradeOrderEvent[];
  readonly error?:   { kind: string; [k: string]: unknown };
}

export interface TradeOrderKey {
  readonly seq:  string;
  readonly tsMs: number;
}

export interface TradeOrderIntent {
  readonly clientOrderId:  string;
  readonly side:           'buy' | 'sell';
  readonly type:           'market';
  readonly mint:           string;
  readonly solIn:          string | null;
  readonly tokensIn:       string | null;
  readonly sellPctBps:     number | null;
  readonly maxSlippageBps: number;
  readonly sendMode:       'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  readonly origin:         'manual_ui' | 'automated_trigger' | 'replay';
}

export interface TradeOrderFill {
  readonly orderKey:      TradeOrderKey;
  readonly signature:     string;
  readonly slot:          number;
  readonly side:          'buy' | 'sell';
  readonly mint:          string;
  readonly solDelta:      string;
  readonly tokenDelta:    string;
  readonly feeLamports:   string;
  readonly tipLamports:   string;
  readonly venue:         'bonding_curve' | 'pump_amm';
  readonly confirmedAtMs: number;
}

export type TradeOrderEvent =
  | { readonly v: '1'; readonly kind: 'accepted';  readonly key: TradeOrderKey; readonly tsMs: number; readonly intent: TradeOrderIntent }
  | { readonly v: '1'; readonly kind: 'resolved';  readonly key: TradeOrderKey; readonly tsMs: number; readonly resolved: unknown }
  | { readonly v: '1'; readonly kind: 'submitted'; readonly key: TradeOrderKey; readonly tsMs: number; readonly signature: string }
  | { readonly v: '1'; readonly kind: 'confirmed'; readonly key: TradeOrderKey; readonly tsMs: number; readonly signature: string }
  | { readonly v: '1'; readonly kind: 'fill_pending'; readonly key: TradeOrderKey; readonly tsMs: number; readonly signature: string }
  | { readonly v: '1'; readonly kind: 'filled';    readonly key: TradeOrderKey; readonly tsMs: number; readonly fill: TradeOrderFill }
  | { readonly v: '1'; readonly kind: 'partial';   readonly key: TradeOrderKey; readonly tsMs: number; readonly fill: TradeOrderFill; readonly remaining: unknown }
  | { readonly v: '1'; readonly kind: 'failed';    readonly key: TradeOrderKey; readonly tsMs: number; readonly error: { kind: string; [k: string]: unknown } }
  | { readonly v: '1'; readonly kind: 'cancelled'; readonly key: TradeOrderKey; readonly tsMs: number; readonly reason: string };

export interface SubmitArgs {
  readonly clientOrderId: string;
  readonly side:          'buy' | 'sell';
  readonly mint:          string;
  readonly solIn?:        number;     // SOL (will be converted to lamports server-side)
  /**
   * USDC pair support: buy size as an integer micro-USDC decimal
   * string (6dp). Mutually exclusive with `solIn`; the api/v1 body
   * carries it as `amount_usdc_micro` + `spend_currency: 'usdc'`.
   */
  readonly usdcIn?:       string;
  /**
   * Cross-quote sells: explicit spend-currency marker. Sells on a
   * bonding-curve SOL pair in USDC mode pass `'usdc'` so the engine
   * appends the SOL→USDC proceeds swap. Buys never need this — the
   * `usdcIn` field implies it.
   */
  readonly spendCurrency?: 'usdc';
  readonly tokensIn?:     string;     // decimal base units
  readonly sellPctBps?:   number;
  readonly sellTokenBalanceHint?: string; // latest 50ms token-balance poll base units for percentage sells
  readonly maxSlippageBps: number;
  readonly sendMode?:     'auto' | 'rpc' | 'jito' | 'zeroslot' | 'nozomi' | 'nonceSpray';
  readonly origin?:       'manual_ui' | 'automated_trigger' | 'replay';
  /**
   * Slice "Terminal wallet selector": when set, the order intent
   * carries an explicit `wallet_account_id` so the api/ resolves
   * THIS wallet's TradingContext (slice 2 path) instead of falling
   * back to the user's primary. UUID validation is enforced by the
   * api/ Ajv schema.
   */
  readonly walletAccountId?: string;
  readonly graduated?: boolean;
  /**
   * Latency-tracing: `Date.now()` captured at the Buy/Sell button press,
   * before any pre-submit work (balance polls, quote reads). Forwarded to
   * the api/ as `client_ts` and stamped into the trace as `clickedAtMs`, so
   * end-to-end latency can be measured from the click. Optional; when the
   * caller omits it, `submitViaApiV1` falls back to its own `Date.now()`
   * (still pre-network, just past the click).
   */
  readonly clientTsMs?: number;
  /**
   * Slice "Trading Settings Presets": active preset's fee overrides
   * for this trade. Both fields are integer lamports in [0, 1e10].
   * See `OrderIntentRequest` in lib/api/orders.ts for unit semantics
   * (priority is total lamports; engine derives µLamports/CU at
   * compose time. Bribe is the Jito/0slot tip lamports). Optional —
   * absent fields fall through to engine defaults.
   */
  readonly priorityLamports?: number;
  readonly bribeLamports?:    number;
  /**
   * E2E latency waterfall: per-surface press stamps on the
   * performance.now() clock. `submit` fills `tokenReadyAtMs` after the
   * auth-token resolve and threads the object to `submitOrder`, which
   * owns the rest of the timeline (see lib/telemetry/tradeTiming.ts).
   */
  readonly timing?: TradePressTiming;
}

export interface UseTradeStream {
  readonly position:    TradePosition | null;
  readonly tokenBalance: string | null;
  readonly tokenBalanceInfo: TradeTokenBalanceInfo | null;
  readonly allPositions: ReadonlyArray<TradePosition>;
  readonly lastEvent:   TradeOrderEvent | null;
  readonly orderEvents: ReadonlyArray<TradeOrderEvent>;
  readonly connected:   boolean;
  readonly inFlight:    number;
  refreshPositions(): Promise<ReadonlyArray<TradePosition>>;
  submit(args: SubmitArgs): Promise<TradeOrderResult>;
}

export interface TradeTokenBalanceInfo {
  readonly mint: string;
  readonly tokens: string;
  readonly known: boolean;
  readonly source: 'live' | 'position' | 'unknown';
  readonly lastFillAtMs: number | null;
  readonly lastReconciledAtMs: number | null;
  readonly quote: TradeSellQuoteInfo | null;
}

export type TradeSellQuoteInfo =
  | {
      readonly venue: 'bonding_curve';
      readonly readAtMs: number;
      readonly vsr: string;
      readonly vtr: string;
      readonly complete: boolean;
    }
  | {
      readonly venue: 'pump_amm';
      readonly readAtMs: number;
      readonly poolBaseReserves: string;
      readonly poolQuoteReserves: string;
    };

export function useTradeStream(
  mint: string | null,
  options: {
    /** Hidden persistent trade pane: pause the token-balance and in-flight
     *  polls (cached state keeps rendering; reveal re-runs the effects). */
    paused?: boolean;
  } = {},
): UseTradeStream {
  const paused = options.paused === true;
  const { getToken } = useAuth();
  // Seeded auth: the wallet-balance stream auths via cookie and the
  // token-balance poll carries the mirrored token — neither needs to
  // wait for clerk.browser.js on a cold boot.
  const { isLoaded, isSignedIn } = useSeededAuth();
  const queryClient = useQueryClient();
  const setTrading = useConnectionStore((state) => state.setTrading);
  const setInFlightOrders = useConnectionStore((state) => state.setInFlightOrders);
  const tradingConfigured = isTradingApiConfigured();
  // Slice "Terminal wallet selector": token-balance poll keys off
  // the selected wallet. Switching wallets re-runs the effect so
  // sell-percent UI never operates on a stale primary balance.
  const selectedWalletAccountId = useSelectedWalletStore(
    (s) => s.selectedWalletAccountId,
  );
  const [allPositions, setAllPositions] = useState<TradePosition[]>([]);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [tokenBalanceInfo, setTokenBalanceInfo] = useState<TradeTokenBalanceInfo | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const tokenBalanceKeyRef = useRef<string | null>(null);
  // De-dupes streamed-balance state writes so an unchanged streamed
  // balance never causes a 250ms re-render (the the chain stream balance
  // stream itself is owned by the shared `wallet-balance-stream` client).
  const lastAppliedStreamRef = useRef<string>('');
  // One-shot seed latch: the balanceKey we have already authoritatively
  // read while the stream was fresh-without-a-row (i.e. wallet does not
  // hold this mint). While latched we stop polling and defer to the
  // stream + optimistic floor; cleared on order events and key changes.
  const tokenSeededRef = useRef<string | null>(null);
  // Lets the order-event effect trigger an immediate re-read without
  // rebuilding the polling interval (avoids per-event teardown churn).
  const tokenTickRef = useRef<(() => void) | null>(null);
  const connected = useTradeActivityStore((s) => s.streamConnected);
  const lastEvent = useTradeActivityStore((s) => s.lastOrderEvent) as TradeOrderEvent | null;
  const orderEvents = useTradeActivityStore((s) => s.orderEvents) as TradeOrderEvent[];

  async function fetchPositions(signal?: AbortSignal): Promise<TradePosition[]> {
    // TRD#2 Phase 2: Clerk-gated per-wallet read of `portfolio.positions`
    // via api/, replacing the backend service's public global positions list. The
    // wallet-scoped rows come back unfiltered by mint; the per-mint row is
    // derived locally via `find` so one round trip serves both views.
    const url = buildPositionsUrl(selectedWalletAccountId);
    const session = getClerkSession();
    const r = await fetchAuthenticatedApi(
      url,
      {},
      { authToken: session.token, ...(signal ? { signal } : {}) },
    );
    if (!r.ok) return allPositions;
    const j = (await r.json()) as { reauth_required?: boolean; positions?: unknown[] };
    if (j.reauth_required === true || !Array.isArray(j.positions)) return allPositions;
    const positions = j.positions
      .map(mapWirePosition)
      .filter((p): p is TradePosition => p !== null);
    setAllPositions(positions);
    return positions;
  }

  // One positions fetch on mount and on mint/wallet change. Previously two
  // mount effects raced an unfiltered and a per-mint request — overlapping
  // data, two round trips (and the server ignored the mint filter anyway).
  useEffect(() => {
    if (!tradingConfigured) {
      setAllPositions([]);
      setTrading('offline');
      return;
    }
    // The v1 route is Clerk-gated: wait for the seeded auth mirror before
    // firing (a cookie-less signed-out fetch only round-trips to a reauth
    // envelope). Signed-out keeps the initial empty array.
    if (!isLoaded || isSignedIn !== true) return;
    const controller = new AbortController();
    void fetchPositions(controller.signal).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, setTrading, tradingConfigured, isLoaded, isSignedIn, selectedWalletAccountId]);

  // Join the shared the chain stream balance stream for the selected wallet.
  // Scoped to the wallet (NOT the mint) so switching trade pages on the
  // same wallet never reconnects; the token-balance poll below prefers
  // the streamed value. The shared client ref-counts the EventSource so
  // this hook + the multi-wallet hook never open duplicate connections.
  useEffect(() => {
    if (!tradingConfigured || !isLoaded || isSignedIn !== true) return;
    lastAppliedStreamRef.current = '';
    const release = acquireWalletBalanceStream(selectedWalletAccountId);
    return () => release();
  }, [tradingConfigured, isLoaded, isSignedIn, selectedWalletAccountId]);

  useEffect(() => {
    if (!mint || !tradingConfigured || !isLoaded || isSignedIn !== true) {
      setTokenBalance(null);
      setTokenBalanceInfo(null);
      return;
    }
    // Paused (hidden pane): keep the last-known balance rendered, poll
    // nothing; the reveal re-runs this effect and reads immediately.
    if (paused) return;
    // Clear stale per-wallet balance only when the actual balance key
    // changes. The seed latch is cleared on order events by a separate
    // effect; clearing on every order event makes Instant Trade's
    // Tokens/Value stats flicker between the last balance and zero.
    const balanceKey = `${mint}|${selectedWalletAccountId ?? 'primary'}`;
    if (tokenBalanceKeyRef.current !== balanceKey) {
      tokenBalanceKeyRef.current = balanceKey;
      tokenSeededRef.current = null;
      setTokenBalance(null);
      setTokenBalanceInfo(null);
    }
    let cancelled = false;
    let requestInFlight = false;
    const url = buildTokenBalanceUrl(mint, selectedWalletAccountId);

    const applyStreamed = (streamedTokens: string): void => {
      const applyKey = `${mint}|${streamedTokens}`;
      if (lastAppliedStreamRef.current === applyKey) return;
      lastAppliedStreamRef.current = applyKey;
      // Display-only cache of the last KNOWN balance, so a wallet/mint
      // switch (which nulls tokenBalance) can keep showing the last
      // confirmed value instead of flashing 0. Never feeds sizing.
      rememberDisplayBalance(selectedWalletAccountId, mint, streamedTokens);
      setTokenBalance(streamedTokens);
      setTokenBalanceInfo((prev) => ({
        mint,
        tokens: streamedTokens,
        known: true,
        source: 'live',
        lastFillAtMs: null,
        lastReconciledAtMs: Date.now(),
        quote: prev && prev.mint === mint ? prev.quote : null,
      }));
      setAllPositions((prev) => {
        const idx = prev.findIndex((p) => p.mint === mint);
        if (idx < 0) return prev;
        const nextArr = prev.slice();
        nextArr[idx] = { ...nextArr[idx]!, tokens: streamedTokens };
        return nextArr;
      });
    };

    const tick = async () => {
      if (requestInFlight) return;
      // the chain stream-first. Three cases drive whether we touch the network:
      //   fresh + row  → serve the streamed value, never poll.
      //   fresh + none → wallet does not hold this mint; seed ONCE then
      //                  defer to the stream + optimistic floor (no poll).
      //   stale / down → authoritative poll, because a lagging stream
      //                  must never serve a stale-high balance to a sell.
      const state = walletStreamState(selectedWalletAccountId);
      if (state === 'fresh') {
        const streamedTokens = streamedTokenBalance(selectedWalletAccountId, mint);
        if (streamedTokens !== null) {
          tokenSeededRef.current = balanceKey;
          applyStreamed(streamedTokens);
          return;
        }
        // No FRESH row for this mint. Honor the one-shot seed skip only when
        // the mint was NEVER observed (not held / held-but-quiet); a STALE row
        // means the balance may have moved without a refresh, so fall through
        // to the authoritative poll rather than trust a seeded-then-aged value
        // (finding #16 — the stream-wide `fresh` state alone defeated this).
        if (
          tokenSeededRef.current === balanceKey
          && mintStreamState(selectedWalletAccountId, mint) === 'unobserved'
        ) {
          return;
        }
      }
      if (url === null) return;
      requestInFlight = true;
      try {
        // Per-user wallet tracking + Slice "Terminal wallet
        // selector": the api/ resolves the user's selected wallet
        // when `wallet_account_id` is in the query, otherwise it
        // falls back to the primary. Response shape is unchanged.
        const session = getClerkSession();
        const r = await fetchHotTradePoll(url, { authToken: session.token });
        if (cancelled || !r.ok) return;
        const j = (await r.json()) as Partial<TradeTokenBalanceInfo>;
        if (cancelled) return;
        const tokens = j.tokens ?? '0';
        const known = j.known !== false;
        tokenSeededRef.current = balanceKey;
        // Same display-only cache as the streamed apply above.
        if (known) rememberDisplayBalance(selectedWalletAccountId, mint, tokens);
        setTokenBalance(known ? tokens : null);
        setTokenBalanceInfo({
          mint,
          tokens,
          known,
          source: j.source ?? (known ? 'position' : 'unknown'),
          lastFillAtMs: j.lastFillAtMs ?? null,
          lastReconciledAtMs: j.lastReconciledAtMs ?? null,
          quote: isTradeSellQuoteInfo(j.quote) ? j.quote : null,
        });
        setAllPositions(prev => {
          const idx = prev.findIndex(p => p.mint === mint);
          if (idx < 0) return prev;
          const next = prev.slice();
          next[idx] = { ...next[idx]!, tokens };
          return next;
        });
      } catch {
        // Keep the last balance/quote snapshot. A single slow poll must
        // not blank the UI or stop sell hints while the next tick catches up.
      } finally {
        requestInFlight = false;
      }
    };
    tokenTickRef.current = () => { tick().catch(() => undefined); };
    tick().catch(() => undefined);
    // The interval re-evaluates stream state cheaply (a map lookup) and
    // only hits the network for the stale/disconnected/un-seeded cases,
    // so steady state for a held or un-held mint is zero HTTP. Hidden
    // tabs skip the fallback ticks entirely; the visible-tab cadence
    // (including the hot active-mint poll) is unchanged.
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      tick().catch(() => undefined);
    }, inFlight > 0 ? TOKEN_BALANCE_HOT_POLL_MS : TOKEN_BALANCE_IDLE_POLL_MS);
    // Hidden tabs skip every fallback tick above, so on tab-return the
    // sell balance hint would otherwise stay pre-idle for up to a full
    // idle interval. Mirror the in-flight poll: re-read immediately on
    // visibility return, clearing the seed latch so the read is
    // authoritative even when the stream reports fresh-with-no-row.
    const onVisible = () => {
      if (!document.hidden) {
        tokenSeededRef.current = null;
        tick().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      tokenTickRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [inFlight, isLoaded, isSignedIn, mint, tradingConfigured, selectedWalletAccountId, paused]);

  // Order events can change the on-chain balance — most importantly a
  // sell-to-zero that CLOSES the token account, which the stream then
  // drops from its snapshot (no row). Clear the seed latch and fire one
  // immediate re-read so the displayed/hinted balance reflects the new
  // truth instead of carrying a stale-high value forward.
  // Keyed on event identity, not orderEvents.length — the store caps that
  // array at MAX_ORDER_EVENTS, so its length goes constant in long
  // sessions and a length dep would silently stop firing.
  useEffect(() => {
    tokenSeededRef.current = null;
    tokenTickRef.current?.();
  }, [lastEvent]);

  useEffect(() => {
    if (!tradingConfigured) {
      setTrading('offline');
      return;
    }
    if (!isLoaded || isSignedIn !== true) {
      setTrading('syncing');
      return;
    }
    setTrading(connected ? 'connected' : 'syncing');
  }, [connected, isLoaded, isSignedIn, setTrading, tradingConfigured]);

  // This hook is the ONLY writer of the connection-store trading status,
  // and it mounts only on the trade page — without cleanup the last value
  // (possibly 'syncing' mid-reconnect) leaks to every other page forever.
  // No current consumer gates on it off the trade page, but reset to
  // 'offline' so future consumers can't inherit the stale state.
  useEffect(() => {
    return () => {
      setTrading('offline');
      setInFlightOrders(0);
    };
  }, [setTrading, setInFlightOrders]);

  useEffect(() => {
    if (!tradingConfigured) {
      setInFlight(0);
      setInFlightOrders(0);
      return;
    }
    if (paused) return; // hidden pane: no in-flight badge polling
    // TRD#2 Phase 2: Clerk-gated api/ proxy of the engine's in-flight
    // count, replacing the public the backend service route. Signed-out sessions
    // would only round-trip to a reauth envelope — skip until the seeded
    // auth mirror reports signed-in.
    if (!isLoaded || isSignedIn !== true) {
      setInFlight(0);
      setInFlightOrders(0);
      return;
    }
    let cancelled = false;
    // Single-flight + timeout: when the trading server stalls, the bare
    // 1.5s interval would otherwise pile up unbounded pending requests.
    let pollInFlight = false;
    const tick = async () => {
      // Hidden tabs don't need the in-flight badge or the hot/idle poll
      // cadence hint — skip the request entirely until visibility returns.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const session = getClerkSession();
        const r = await fetchAuthenticatedApi(
          '/api/v1/trade/inflight',
          {},
          { authToken: session.token, signal: AbortSignal.timeout(5_000) },
        );
        if (cancelled || !r.ok) return;
        const j = (await r.json()) as { inFlight?: number };
        if (cancelled) return;
        const nextInFlight = j.inFlight ?? 0;
        setInFlight(nextInFlight);
        setInFlightOrders(nextInFlight);
      } catch {
        /* ignore */
      } finally {
        pollInFlight = false;
      }
    };
    const safeTick = () => { tick().catch(() => undefined); };
    safeTick();
    // 5s, not 1.5s: this feeds a cosmetic in-flight badge, and per-user
    // polls multiply on shared infra (1.5s = ~33k req/s at 50k trade-page
    // users). Order lifecycle freshness rides the order SSE, not this.
    const t = setInterval(safeTick, 5_000);
    const onVisible = () => {
      if (!document.hidden) safeTick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [setInFlightOrders, tradingConfigured, paused, isLoaded, isSignedIn]);

  const submit = async (args: SubmitArgs): Promise<TradeOrderResult> => {
    // All orders POST to the Clerk/Turnkey-gated `/api/v1/trade/orders`.
    // The old NEXT_PUBLIC_TRADE_ORDER_INTAKE_VIA_API=false direct path to
    // the backend service is GONE and was never a rollback option once the server
    // overhaul shipped: /api/trade/orders is 403 at the the edge edge and
    // internal-HMAC 401 at the backend service.
    //
    // Warm mirror resolves synchronously; the cold window right after a
    // refresh races getToken() against a 1s bound instead of firing a
    // cookie-only POST that can never authenticate cross-site.
    const authToken = await resolveOrderAuthToken(getToken);
    // Waterfall: token resolve settled (shared seam — every single-order
    // surface routes through here). Keeps a surface-provided stamp.
    const timing =
      args.timing !== undefined && args.timing.tokenReadyAtMs === undefined
        ? { ...args.timing, tokenReadyAtMs: tradeTimingNow() }
        : args.timing;
    const result = await submitViaApiV1(args, authToken, timing);
    // Reauth dead-end fix: refresh /me so the trading-ready gate flips
    // to needs_sign_in and handles re-auth on the user's next click.
    // Centralised here so every single-order submit surface (TradePanel,
    // InstantTradeBox, quickbuy) gets it without duplicating the wiring.
    if (!result.accepted && result.error?.kind === 'reauth_required') {
      void queryClient.invalidateQueries({ queryKey: ['api', 'v1', 'me'] });
    }
    return result;
  };

  const position = mint ? (allPositions.find(p => p.mint === mint) ?? null) : null;

  return {
    position,
    tokenBalance,
    tokenBalanceInfo,
    allPositions,
    lastEvent,
    orderEvents,
    connected,
    inFlight,
    refreshPositions: () => fetchPositions(),
    submit,
  };
}

// Guarded like the InstantTradeBox copy: huge inputs make `toFixed(9)`
// emit scientific notation, and `BigInt('1e+21')` throws.
function solToLamportsDecimalString(sol: number): string {
  if (!Number.isFinite(sol) || sol < 0) return '0';
  const [whole, frac = ''] = sol.toFixed(9).split('.');
  const padded = (frac ?? '').padEnd(9, '0').slice(0, 9);
  try {
    return (BigInt(whole ?? '0') * 1_000_000_000n + BigInt(padded || '0')).toString(10);
  } catch {
    return '0';
  }
}

/**
 * Pure `SubmitArgs` → api/v1 order-intent body projection. Extracted
 * from `submitViaApiV1` so the request-body shape per (mode × pair ×
 * venue) cell is unit-testable without `fetch`.
 */
export function buildOrderIntentBody(args: SubmitArgs): OrderIntentRequest {
  const body: OrderIntentRequest = {
    client_order_id: args.clientOrderId,
    side: args.side,
    mint: args.mint,
    slippage_bps: args.maxSlippageBps,
    send_mode: args.sendMode ?? 'auto',
    origin: args.origin ?? 'manual_ui',
    background_ack: true,
    // Latency head stamp. Prefer the click-time captured by the handler;
    // fall back to now (still pre-network) so the field is never absent
    // for a manual UI order.
    client_ts: args.clientTsMs ?? Date.now(),
  };
  if (args.solIn !== undefined) {
    body.amount_lamports = solToLamportsDecimalString(args.solIn);
  }
  if (args.usdcIn !== undefined) {
    // USDC spend (native USDC pair OR cross-quote bonding-curve buy):
    // micro-USDC amount + explicit spend marker. SOL buys never set
    // these fields, keeping their bodies unchanged.
    body.amount_usdc_micro = args.usdcIn;
    body.spend_currency = 'usdc';
  }
  if (args.spendCurrency !== undefined) {
    // Cross-quote sells: usual sizing fields + the marker so the
    // engine appends the SOL→USDC proceeds swap.
    body.spend_currency = args.spendCurrency;
  }
  if (args.graduated === true) {
    body.graduated = true;
  }
  if (args.tokensIn !== undefined) {
    body.tokens_in = args.tokensIn;
  }
  if (args.sellPctBps !== undefined) {
    body.sell_percent_bps = args.sellPctBps;
  }
  if (args.sellTokenBalanceHint !== undefined) {
    body.sell_token_balance_hint = args.sellTokenBalanceHint;
  }
  // Slice "Terminal wallet selector": when a selected wallet is
  // bound, the order intent carries its UUID so the api/ Slice-2
  // resolver targets THIS wallet's TradingContext. When omitted the
  // api/ keeps its primary-fallback behaviour.
  if (typeof args.walletAccountId === 'string' && args.walletAccountId.length > 0) {
    body.wallet_account_id = args.walletAccountId;
  }
  /* Trading Settings Presets fee overrides. Snake_case for the api/
     Fastify schema (which strips unknown keys via
     `additionalProperties: false`). Both fields are integer lamports
     in [0, 1e10]; the api/ + engine validate again defensively. */
  if (args.priorityLamports !== undefined) {
    body.priority_lamports = args.priorityLamports;
  }
  if (args.bribeLamports !== undefined) {
    body.bribe_lamports = args.bribeLamports;
  }
  return body;
}

async function submitViaApiV1(
  args: SubmitArgs,
  authToken: string | null,
  timing?: TradePressTiming,
): Promise<TradeOrderResult> {
  const result: OrderSubmitResult = await submitOrder(buildOrderIntentBody(args), {
    authToken,
    ...(timing !== undefined ? { timing } : {}),
  });
  return mapOrderSubmitResultToTradeOrderResult(result, args);
}

function mapOrderSubmitResultToTradeOrderResult(
  result: OrderSubmitResult,
  args: SubmitArgs,
): TradeOrderResult {
  if (result.kind === 'ok') {
    return {
      accepted: true,
      key: {
        seq: result.order.order_seq ?? '0',
        tsMs: result.order.ts_ms ?? Date.now(),
      },
      // The api/ envelope does NOT echo the full SSE event stream;
      // downstream observers (`lastEvent`, fills) hydrate from the
      // already-open SSE socket. We synthesise an `accepted` event so
      // the toast stack and statusMessage transitions immediately.
      events: [
        {
          v: '1',
          kind: 'accepted',
          key: { seq: result.order.order_seq ?? '0', tsMs: result.order.ts_ms ?? Date.now() },
          tsMs: result.order.ts_ms ?? Date.now(),
          intent: {
            clientOrderId: args.clientOrderId,
            side: args.side,
            type: 'market',
            mint: args.mint,
            solIn: args.solIn !== undefined ? solToLamportsDecimalString(args.solIn) : null,
            tokensIn: args.tokensIn ?? null,
            sellPctBps: args.sellPctBps ?? null,
            maxSlippageBps: args.maxSlippageBps,
            sendMode: args.sendMode ?? 'auto',
            origin: args.origin ?? 'manual_ui',
          },
        },
      ],
    };
  }
  if (result.kind === 'reauth') {
    return {
      accepted: false,
      error: { kind: 'reauth_required', reason: result.reason },
    };
  }
  if (result.kind === 'network_error') {
    return {
      accepted: false,
      error: { kind: 'network_error', cause: result.reason },
    };
  }
  return {
    accepted: false,
    error: {
      kind: result.errorCode,
      message: result.message,
      ...result.extras,
    },
  };
}

function isTradeSellQuoteInfo(value: unknown): value is TradeSellQuoteInfo {
  if (!value || typeof value !== 'object') return false;
  const quote = value as { [key: string]: unknown };
  if (quote['venue'] === 'bonding_curve') {
    return typeof quote['readAtMs'] === 'number'
      && typeof quote['vsr'] === 'string'
      && typeof quote['vtr'] === 'string';
  }
  if (quote['venue'] === 'pump_amm') {
    return typeof quote['readAtMs'] === 'number'
      && typeof quote['poolBaseReserves'] === 'string'
      && typeof quote['poolQuoteReserves'] === 'string';
  }
  return false;
}
