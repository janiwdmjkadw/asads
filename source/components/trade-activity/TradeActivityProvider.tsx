'use client';

import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/lib/api/me';
import { tradingApiUrl } from '@/lib/api/trading';
import { warmAuthCaches } from '@/lib/api/auth-prewarm';
import { getClerkSession, useClerkSessionStore } from '@/lib/state/clerk-session-store';
import { useStreamGeneration } from '@/lib/state/stream-generation';
import {
  useTradeActivityStore,
  type IncomingOrderEvent,
} from '@/lib/state/trade-activity-store';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import { formatAutomatedFillAmounts, shortMint } from '@/components/trade/orders-tab/format';
import { recordOrderSseEvent } from '@/lib/telemetry/tradeTiming';
import { TradeActivityToasts } from './TradeActivityToasts';
import { TradeTimingPaintProbe } from './TradeTimingPaintProbe';
import { parseSseEventId } from './sseEventId';
import { claimTerminalFlush, isTerminalOrderKind } from './terminalEventFlush';

// A 5-wallet batch emits a burst of confirmed/filled events within ~1s;
// debouncing each key-group to one trailing invalidation replaces up to
// 3×N refetch rounds. Data still converges on the trailing edge.
const INVALIDATE_DEBOUNCE_MS = 600;
const INVALIDATION_KEY_GROUPS = {
  balances: ['api', 'v1', 'wallets', 'balances'],
  positions: ['api', 'v1', 'trade', 'positions'],
  fills: ['api', 'v1', 'trade', 'fills'],
  // Prefix covers the Portfolio Spot tab's holdings/performance/transactions
  // keys (SpotTab.tsx) — without it a fill left Portfolio stale for 15-60s.
  portfolioSpot: ['api', 'v1', 'portfolio', 'spot'],
} as const;
type InvalidationGroup = keyof typeof INVALIDATION_KEY_GROUPS;

// Each auth-prewarm is a DB write server-side (upsertUserByAuthIdentity),
// so re-warms MUST stay throttled: at most one warm per WARM_THROTTLE_MS.
const WARM_THROTTLE_MS = 30_000;
// The shortest api-side warmed TTL is the 60s TradingContext cache; a 45s
// visible-tab cadence keeps it from ever expiring under an open tab.
const WARM_INTERVAL_MS = 45_000;
// On visibility return, wait for ClerkSessionSync's forced re-mint to
// rotate the mirrored token before warming; if no rotation lands within
// this window, fire anyway — the mirrored token may still be valid.
// 600ms (was 1500): the visibility force-mint typically lands in
// 200-800ms; if the rotation subscription hasn't fired by 600ms, warm
// with whatever the mirror holds rather than keep racing the user's
// first click. The server-side background warmer (order-auth-warm)
// keeps recent traders hot regardless, so this fallback is now a
// second line of defense, not the primary one.
const WARM_TOKEN_ROTATE_FALLBACK_MS = 600;
// Eager visibility-return warm requires this much remaining JWT life so
// the server-side verify cannot land negative even after network latency
// (a negative verify would be cached ~5s — the failure the rotation gate
// protects against).
const EAGER_WARM_MIN_TOKEN_LIFE_MS = 10_000;

/**
 * Mounts once inside `<TerminalShell />`. Responsibilities:
 *
 *   1. Open a single `EventSource` to `/api/v1/trade/stream`. Every
 *      order event flows through `applyOrderEvent`, which only
 *      updates toasts the local user actually triggered (filtered
 *      by `clientOrderId`).
 *   2. Keep `POST /api/v1/trade/auth-prewarm` warm: fire when the
 *      wallet-set/authz key changes, on visibility return, and on a
 *      ~45s cadence while visible (throttled to one warm per ~30s).
 *      That call warms the api/ side caches (Clerk JWT verify ~30s,
 *      TradingContext ≤60s, signer material) so the first order click
 *      after idle pays only 1–2 warm Aurora SELECTs (~5–30 ms)
 *      instead of the cold resolve.
 *   3. Render the global top-of-screen `<TradeActivityToasts />`.
 *
 * No component owns the SSE socket directly; only this provider
 * does, so we never accidentally fan out N parallel connections.
 */
export function TradeActivityProvider() {
  const queryClient = useQueryClient();
  const applyOrderEvent = useTradeActivityStore((s) => s.applyOrderEvent);
  const setStreamConnected = useTradeActivityStore((s) => s.setStreamConnected);
  const isLoaded = useClerkSessionStore((s) => s.isLoaded);
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const { data: me } = useMe({ enabled: isSignedIn === true });
  // Bumped once per bfcache restore: the frozen EventSource is typically
  // CLOSED on restore, so the SSE effect must re-run to reconnect.
  const streamGeneration = useStreamGeneration();

  // ── SSE: order event stream ───────────────────────────────────────
  // Connect as soon as the provider mounts — do NOT wait for Clerk's client
  // SDK to finish initialising. This stream authenticates via the session
  // COOKIE (`withCredentials`), which is already present on a hard refresh,
  // and middleware guarantees a signed-in session on every terminal route. We
  // only bail when Clerk has positively reported "signed out" (`=== false`);
  // during the brief unknown window (`null`) on cold boot we connect
  // optimistically so fills/toasts are live seconds sooner.
  useEffect(() => {
    if (isSignedIn === false) return;
    const url = tradingApiUrl('/api/v1/trade/stream');
    if (!url) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let retryDelayMs = 1_000;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    const invalidateTimers = new Map<InvalidationGroup, ReturnType<typeof setTimeout>>();
    const scheduleInvalidate = (group: InvalidationGroup) => {
      const pending = invalidateTimers.get(group);
      if (pending !== undefined) clearTimeout(pending);
      invalidateTimers.set(
        group,
        setTimeout(() => {
          invalidateTimers.delete(group);
          void queryClient.invalidateQueries({ queryKey: INVALIDATION_KEY_GROUPS[group] });
        }, INVALIDATE_DEBOUNCE_MS),
      );
    };
    const flushInvalidations = () => {
      for (const [group, pending] of invalidateTimers) {
        clearTimeout(pending);
        void queryClient.invalidateQueries({ queryKey: INVALIDATION_KEY_GROUPS[group] });
      }
      invalidateTimers.clear();
    };

    const connect = () => {
      if (cancelled) return;
      es = new EventSource(url, { withCredentials: true });
      // Replay guard, scoped to THIS EventSource object: if the server
      // stamps monotonic `id:` fields and the browser's built-in
      // auto-reconnect replays frames (Last-Event-ID), skipping
      // `id <= lastApplied` prevents a double-apply — which would
      // double-count the optimistic-balance floor on a replayed `filled`.
      // A fresh EventSource (our manual reconnect) starts a new window.
      // Streams that don't stamp ids leave `lastEventId` empty and the
      // guard never engages.
      let lastAppliedEventId: bigint | null = null;
      es.addEventListener('open', () => {
        retryDelayMs = 1_000;
        setStreamConnected(true);
      });
      es.addEventListener('order', (rawEvent) => {
        try {
          const eventId = parseSseEventId((rawEvent as MessageEvent).lastEventId);
          if (eventId !== null) {
            if (lastAppliedEventId !== null && eventId <= lastAppliedEventId) return;
            lastAppliedEventId = eventId;
          }
          const raw = JSON.parse((rawEvent as MessageEvent).data as string) as Record<string, unknown>;
          const event = toIncomingOrderEvent(raw);
          if (event) {
            // E2E waterfall: SSE-delivery stamps for orders this tab is
            // timing. Non-accepted events carry only the OrderKey, so
            // resolve the clientOrderId via the ack/accepted-populated
            // map (a miss means "not one of ours" — no-op). Stamped
            // BEFORE the store update: on the flushSync fast path the
            // paint probe's layout effect runs synchronously inside the
            // commit, so the terminal stamp must already exist by then.
            const timingCid =
              event.clientOrderId ??
              useTradeActivityStore
                .getState()
                .keyToClientId.get(`${event.key.seq}:${event.key.tsMs}`);
            if (timingCid !== undefined) recordOrderSseEvent(timingCid, event.kind);
            // Render fast path: a terminal event for an order THIS tab
            // submitted commits synchronously (flushSync) so the
            // confirmation catches the next frame instead of waiting for
            // React's scheduled render. claimTerminalFlush coalesces —
            // one sync pass per window — so a multi-wallet burst of ~5
            // confirmed/filled events costs at most one sync layout pass
            // (the rest ride the normal batched scheduling, as before).
            // The ownership check reads keyToClientId BEFORE the update,
            // which is safe: terminal kinds are never 'accepted', so the
            // map entry (written on our own 'accepted') already exists.
            const flushNow =
              isTerminalOrderKind(event.kind) &&
              useTradeActivityStore
                .getState()
                .keyToClientId.has(`${event.key.seq}:${event.key.tsMs}`) &&
              claimTerminalFlush(Date.now());
            if (flushNow) {
              flushSync(() => applyOrderEvent(event));
            } else {
              applyOrderEvent(event);
            }
            // The stream is not user-scoped; mirror the toast path's
            // ownership filter (keyToClientId is populated on our own
            // `accepted`, which applyOrderEvent just processed) so other
            // tabs'/users' fills never trigger refetch rounds here.
            const isOurs = useTradeActivityStore
              .getState()
              .keyToClientId.has(`${event.key.seq}:${event.key.tsMs}`);
            if (isOurs) {
              if (event.kind === 'confirmed' || event.kind === 'filled' || event.kind === 'partial') {
                scheduleInvalidate('balances');
              }
              if (event.kind === 'filled' || event.kind === 'partial') {
                scheduleInvalidate('positions');
                scheduleInvalidate('fills');
                scheduleInvalidate('portfolioSpot');
              }
              // Post-commit marker: the fill row is now readable, so a
              // refetch can't race the DB write anymore — refresh the
              // fill-derived views one more time.
              if (event.kind === 'fill_committed') {
                scheduleInvalidate('positions');
                scheduleInvalidate('fills');
              }
            }
          }
        } catch {
          // Malformed SSE frame — ignore, the next one will be fine.
        }
      });
      es.addEventListener('error', () => {
        if (cancelled) return;
        flushInvalidations();
        setStreamConnected(false);
        try { es?.close(); } catch { /* ignore */ }
        es = null;
        retryHandle = setTimeout(connect, retryDelayMs);
        // Cap exponential backoff at 8 s — a downed SSE on the engine
        // side should never block UI rendering.
        retryDelayMs = Math.min(retryDelayMs * 2, 8_000);
      });
    };

    // Backgrounded tabs silently lose the SSE socket (network path change,
    // proxy idle close) without an `error` event ever firing — and the
    // manual reconnect above only runs ON `error`, after up to 8s backoff.
    // The first buy after returning to the tab then submits into a dead
    // stream: its `submitted`/`confirmed` frames are delivered to no one
    // (the api hop has no replay) and the toast strands on "sending" until
    // the fills poll rescues it. Reconnect proactively the moment the tab
    // is visible again: kill any pending backoff, drop the stale socket,
    // and dial fresh — the handshake (~100-300ms) comfortably beats the
    // fastest possible click. A healthy-looking socket (readyState OPEN)
    // is reconnected too: OPEN only means the browser hasn't noticed the
    // half-dead TCP path yet, and a redundant reconnect costs one cheap
    // handshake while a missed dead socket costs a stranded order toast.
    const reconnectOnReturn = () => {
      if (cancelled || document.hidden) return;
      if (retryHandle !== null) {
        clearTimeout(retryHandle);
        retryHandle = null;
      }
      retryDelayMs = 1_000;
      try { es?.close(); } catch { /* ignore */ }
      es = null;
      connect();
    };
    document.addEventListener('visibilitychange', reconnectOnReturn);
    window.addEventListener('pageshow', reconnectOnReturn);

    connect();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', reconnectOnReturn);
      window.removeEventListener('pageshow', reconnectOnReturn);
      if (retryHandle !== null) clearTimeout(retryHandle);
      flushInvalidations();
      setStreamConnected(false);
      try { es?.close(); } catch { /* ignore */ }
    };
    // `streamGeneration` bumps once per bfcache restore so the connect re-runs.
  }, [applyOrderEvent, isSignedIn, queryClient, setStreamConnected, streamGeneration]);

  // ── auth-prewarm: throttled keep-warm ─────────────────────────────
  // Fire when the wallet set changes so newly-created multi-wallets
  // get their per-wallet TradingContext/signing material cached before
  // the first click, then re-warm on visibility return and on a 45s
  // cadence while visible — the warmed caches TTL out within 30-60s,
  // so the old one-shot left every click after >60s idle on the cold
  // path. Do NOT key this by Clerk token rotation: the token mirror
  // force-refreshes in the background, but signer/KMS material is
  // keyed by wallet authorization, not by JWT value.
  const lastWarmedKeyRef = useRef<string | null>(null);
  const lastWarmedAtMsRef = useRef(0);
  const warmKey =
    me && !me.reauth_required
      ? me.wallets
          .map((wallet) => `${wallet.wallet_account_id}:${wallet.trading_authorization.expires_at ?? ''}`)
          .join('|')
      : 'no-wallets-yet';
  useEffect(() => {
    if (!isLoaded || isSignedIn !== true) return;

    // Fire-and-forget — failures are benign (the order path still
    // works cold). Logging is intentionally absent: this is a
    // perf-warming side request, not user-visible. Each warm is a DB
    // write server-side (upsertUserByAuthIdentity), so re-warms are
    // throttled to one per WARM_THROTTLE_MS; a key change (new wallet
    // or re-authorization — rare) bypasses the throttle so fresh
    // signer material is warmed immediately, as before.
    const warm = (bypassThrottle: boolean) => {
      const now = Date.now();
      if (!bypassThrottle && now - lastWarmedAtMsRef.current < WARM_THROTTLE_MS) return;
      const session = getClerkSession();
      if (session.token === null) return;
      lastWarmedAtMsRef.current = now;
      void warmAuthCaches(session.token).catch(() => undefined);
    };

    if (lastWarmedKeyRef.current !== warmKey) {
      lastWarmedKeyRef.current = warmKey;
      warm(true);
    }

    // Steady-state cadence. Skip hidden ticks: browsers throttle them
    // anyway, and a hidden tab shouldn't hold DB caches warm.
    const interval = setInterval(() => {
      if (document.hidden) return;
      warm(false);
    }, WARM_INTERVAL_MS);

    // Visibility return: after idle the mirrored Clerk JWT is likely
    // expired, and a warm carrying it would cache a 5s NEGATIVE verify
    // entry server-side. ClerkSessionSync already force-mints on
    // visibility, so wait for the mirror's tokenVersion to bump and
    // warm with the fresh token — with a short fallback if no rotation
    // lands (the mirrored token may still be valid).
    let unsubscribe: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelPendingWarm = () => {
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };
    const onVisibilityChange = () => {
      cancelPendingWarm();
      if (document.visibilityState !== 'visible') return;
      // Eager parallel warm when the mirrored JWT is still comfortably
      // valid: verify is guaranteed POSITIVE (no negative-cache risk —
      // the reason the rotation gate below exists), and the api caches
      // land warm ~0.5-1.5s earlier than waiting on the force-mint —
      // ahead of the fastest first click after returning to the tab.
      // Near-expiry/expired tokens skip this and take the gated path
      // below exactly as before. The eager warm stamps the throttle, so
      // the rotation warm that follows becomes a no-op (caches are
      // already warm and TTL 30-60s) rather than a duplicate DB write.
      const session = getClerkSession();
      if (
        session.token !== null
        && session.tokenExpMs !== null
        && session.tokenExpMs - Date.now() > EAGER_WARM_MIN_TOKEN_LIFE_MS
      ) {
        warm(false);
        return;
      }
      unsubscribe = useClerkSessionStore.subscribe((state, prev) => {
        if (state.tokenVersion === prev.tokenVersion) return;
        cancelPendingWarm();
        warm(false);
      });
      fallbackTimer = setTimeout(() => {
        cancelPendingWarm();
        warm(false);
      }, WARM_TOKEN_ROTATE_FALLBACK_MS);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelPendingWarm();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isLoaded, isSignedIn, warmKey]);

  return (
    <>
      <TradeTimingPaintProbe />
      <TradeActivityToasts />
    </>
  );
}

function toIncomingOrderEvent(raw: Record<string, unknown>): IncomingOrderEvent | null {
  const kindRaw = raw['kind'];
  if (typeof kindRaw !== 'string') return null;
  const allowed = new Set([
    'accepted',
    'resolved',
    'submitted',
    'confirmed',
    'fill_pending',
    'filled',
    'partial',
    'fill_committed',
    'failed',
    'cancelled',
  ]);
  if (!allowed.has(kindRaw)) return null;
  const keyRaw = raw['key'] as { seq?: unknown; tsMs?: unknown } | undefined;
  if (!keyRaw || typeof keyRaw.seq !== 'string' || typeof keyRaw.tsMs !== 'number') return null;

  // `IncomingOrderEvent` is `readonly` per the store contract, so we
  // assemble it via object-literal-with-conditional-spreads instead
  // of mutating after construction.
  const kind = kindRaw as IncomingOrderEvent['kind'];
  const key = { seq: keyRaw.seq, tsMs: keyRaw.tsMs };

  let clientOrderId: string | undefined;
  if (kind === 'accepted') {
    const intent = raw['intent'] as { clientOrderId?: unknown } | undefined;
    const cid = intent?.clientOrderId;
    if (typeof cid === 'string') clientOrderId = cid;
  }
  if (clientOrderId === undefined) {
    // Non-accepted events historically carry only the OrderKey, but the
    // advanced-orders api stamps the suborder's client_order_id on every
    // event it emits — surface it so the store can attribute `adv-`
    // suborders whose `accepted` frame landed before this client
    // connected (the stream is user-scoped, so the id is trustworthy).
    const cidRaw = raw['client_order_id'] ?? raw['clientOrderId'];
    if (typeof cidRaw === 'string') clientOrderId = cidRaw;
  }

  const sigRaw = raw['signature'];
  const signature = typeof sigRaw === 'string' ? sigRaw : undefined;

  let errorKind: string | undefined;
  if (kind === 'failed') {
    const errorRaw = raw['error'] as { kind?: unknown } | undefined;
    const ek = errorRaw?.kind;
    if (typeof ek === 'string') errorKind = ek;
  }

  let cancelReason: string | undefined;
  if (kind === 'cancelled') {
    const reasonRaw = raw['reason'];
    if (typeof reasonRaw === 'string') cancelReason = reasonRaw;
  }

  // `fill_committed`: minimal projection — the mint rides top-level (no
  // `fill` payload, no toast/phase semantics downstream).
  let mint: string | undefined;
  if (kind === 'fill_committed') {
    const mintRaw = raw['mint'];
    if (typeof mintRaw === 'string') mint = mintRaw;
  }

  // `filled`/`partial` carry the exact on-chain delta; surface it so the
  // store can maintain a wallet-scoped optimistic balance floor and the
  // pending ledger delta. `solDelta`/`signature` fall back to '0'/'' so a
  // malformed frame never drops the balance-floor behaviour.
  let fill: IncomingOrderEvent['fill'] | undefined;
  if (kind === 'filled' || kind === 'partial') {
    const fillRaw = raw['fill'] as {
      mint?: unknown;
      tokenDelta?: unknown;
      solDelta?: unknown;
      signature?: unknown;
      side?: unknown;
    } | undefined;
    if (
      fillRaw &&
      typeof fillRaw.mint === 'string' &&
      typeof fillRaw.tokenDelta === 'string' &&
      (fillRaw.side === 'buy' || fillRaw.side === 'sell')
    ) {
      fill = {
        mint: fillRaw.mint,
        tokenDelta: fillRaw.tokenDelta,
        solDelta: typeof fillRaw.solDelta === 'string' ? fillRaw.solDelta : '0',
        signature: typeof fillRaw.signature === 'string' ? fillRaw.signature : '',
        side: fillRaw.side,
      };
    }
  }

  // Pre-render the automated-fill toast strings here (the store is
  // dependency-free): ticker via the navigation-hint cache, amounts via
  // the bigint-safe orders-tab formatter. Only consumed when the store
  // attributes the event to an `adv-` order.
  let fillDisplay: IncomingOrderEvent['fillDisplay'] | undefined;
  if (fill !== undefined) {
    const ticker = tokenTickerFromNavigationHint(fill.mint) ?? shortMint(fill.mint);
    fillDisplay = {
      kindLabel: advancedKindLabel(raw),
      amountsLabel: formatAutomatedFillAmounts(fill.side, fill.solDelta, fill.tokenDelta, ticker),
      ticker,
    };
  }

  return {
    kind,
    key,
    raw,
    ...(clientOrderId !== undefined ? { clientOrderId } : {}),
    ...(signature !== undefined ? { signature } : {}),
    ...(errorKind !== undefined ? { errorKind } : {}),
    ...(cancelReason !== undefined ? { cancelReason } : {}),
    ...(mint !== undefined ? { mint } : {}),
    ...(fill !== undefined ? { fill } : {}),
    ...(fillDisplay !== undefined ? { fillDisplay } : {}),
  };
}

/** "DCA" vs "Limit" for the automated-fill toast title. The kind rides
 *  the deterministic id itself: `adv-r<hash>` recurring / `adv-l<hash>`
 *  limit (api advanced-orders/route-plan.ts deriveLegClientOrderId).
 *  Wire fields win when present; recurring is the fallback. */
function advancedKindLabel(raw: Record<string, unknown>): string {
  const kindRaw = raw['advanced_kind'] ?? raw['order_kind'];
  if (kindRaw === 'limit') return 'Limit';
  if (kindRaw === 'recurring') return 'DCA';
  const id = raw['client_order_id'];
  if (typeof id === 'string' && id.startsWith('adv-l')) return 'Limit';
  return 'DCA';
}
