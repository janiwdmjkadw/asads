'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TweetTrackerDock } from '@/components/discover/dock/TweetTrackerDock';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import { displayNameWithEmoji, type UseTrackedWalletsResult } from '@/components/discover/trackedWallets';
import { useWalletActivity, type WalletActivityEvent } from '@/components/discover/useWalletActivity';
import { useWalletTokenTickers } from '@/components/discover/useWalletTokenTickers';
import { resolveSharedTicker } from '@/components/discover/tokenIdentityCache';
import { discoverFeedStore } from '@/components/discover/discoverFeedStore';
import { WalletActivityFeed } from '@/components/discover/WalletActivityFeed';
import {
  createTradeToast,
  WalletNoticeToastStack,
  type WalletNoticeToast,
} from '@/components/discover/WalletNoticeToasts';
import { walletToastTtlMs } from '@/lib/state/wallet-toast-style';

const TRADE_WALLET_TOAST_TTL_MS = 6_500;
/**
 * Only toast tracked-wallet trades that are genuinely live. Every fresh
 * SSE connect/reconnect replays the last ~30 persisted trades as history
 * (trading-server backfill, identical frame shape to live events). The
 * primary gate compares `receivedAtMs` (local arrival) against the SAME
 * local clock, so server⇄client clock skew can never reject live trades
 * or admit replays; `blockTimeMs` (validator clock) is kept only as a
 * generous secondary "very old event" rejection. Mirrors DiscoverPage.
 */
const LIVE_TRADE_TOAST_MAX_AGE_MS = 10_000;
const LIVE_TRADE_TOAST_MAX_BLOCK_AGE_MS = 5 * 60_000;

interface TradeWalletActivityProps {
  trackedWallets: UseTrackedWalletsResult;
  tradeMint: string | undefined;
  /** Adapted token identity for the CURRENT mint (only read when a
   *  snapshot exists — mirrors the old root-level ticker map). */
  tokenTicker: string;
  tokenName: string;
  hasSnapshot: boolean;
  /** Bumped by the page's token-hint listener; forces a hint re-read. */
  tokenHintVersion: number;
}

/**
 * Tracked-wallet activity coordinator for the trade page. Subscribes to
 * the wallet-activity SSE streams and owns every consumer of the events —
 * the toast stack, the floating activity feed, and the toast side
 * effects — so a trade event re-renders only this subtree, never the
 * TradePage root (mirrors DiscoverWalletActivity).
 */
export function TradeWalletActivity({
  trackedWallets,
  tradeMint,
  tokenTicker,
  tokenName,
  hasSnapshot,
  tokenHintVersion,
}: TradeWalletActivityProps) {
  // ONE shared superset stream (same entry as Discover/tracker/chart
  // consumers); feed/toast scoping is client-side filtering below.
  const { events: walletActivityEvents } = useWalletActivity(trackedWallets.addressSet);
  const feedWalletActivityEvents = useMemo(
    () => walletActivityEvents.filter((event) => trackedWallets.feedAddressSet.has(event.wallet)),
    [walletActivityEvents, trackedWallets.feedAddressSet],
  );
  const [walletNoticeToasts, setWalletNoticeToasts] = useState<WalletNoticeToast[]>([]);
  const seenTradeSignatures = useRef<Set<string>>(new Set());
  // Toast-dismiss timers must die with this subtree — a bare setTimeout
  // would fire setState on an unmounted tree (mirrors DiscoverPage).
  const walletToastTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = walletToastTimersRef.current;
    return () => {
      for (const handle of timers) window.clearTimeout(handle);
    };
  }, []);
  // Toast candidates are scoped to the toast set — a feed-only wallet
  // (alertsOnToast=false) must never toast or ring. The old feed ∪ toast
  // union silently toasted feed-only wallets (mirrors DiscoverPage).
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
    const map = new Map<string, string>();
    // Imperative read: the map only needs to be CURRENT when a consumer
    // (toast effect / activity feed) actually resolves a ticker, which always
    // follows a change to one of this memo's deps. Subscribing to the full
    // feed array here re-rendered on every SSE frame.
    for (const coin of discoverFeedStore.getSnapshot()) {
      if (coin.id) setTicker(map, coin.id, coin.ticker, coin.name);
    }
    if (tradeMint && hasSnapshot) {
      setTicker(map, tradeMint, tokenTicker, tokenName);
    }
    for (const event of toastCandidateEvents) {
      const cached = tokenTickerFromNavigationHint(event.mint);
      if (cached) map.set(event.mint, cached);
    }
    return tokenHintVersion >= 0 ? map : new Map<string, string>();
  }, [
    hasSnapshot,
    toastCandidateEvents,
    tokenHintVersion,
    tokenName,
    tokenTicker,
    tradeMint,
  ]);
  const lazyTickerByMint = useWalletTokenTickers(toastCandidateEvents, baseTickerByMint);
  const tickerByMint = useMemo(() => {
    const map = new Map(baseTickerByMint);
    for (const [mint, ticker] of lazyTickerByMint) map.set(mint, ticker);
    return map;
  }, [baseTickerByMint, lazyTickerByMint]);
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

  const dismissWalletToast = useCallback((id: string) => {
    setWalletNoticeToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

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
      // Connection-backfill replay carries a fresh receivedAtMs — skip
      // explicitly so history never toasts/rings (mirrors DiscoverPage).
      if (event.replayed) continue;
      if (now - event.receivedAtMs > LIVE_TRADE_TOAST_MAX_AGE_MS) continue;
      if (event.blockTimeMs !== null && now - event.blockTimeMs > LIVE_TRADE_TOAST_MAX_BLOCK_AGE_MS) continue;
      const wallet = trackedWallets.lookup(event.wallet);
      const walletLabel = wallet
        ? displayNameWithEmoji(wallet)
        : `${event.wallet.slice(0, 4)}…${event.wallet.slice(-4)}`;
      const ticker = resolveTickerForMint(event.mint, tickerByMint) ?? 'UNKNOWN';
      const toast = createTradeToast(event, ticker, walletLabel, wallet, null);
      setWalletNoticeToasts((current) =>
        [toast, ...current.filter((t) => t.id !== toast.id)].slice(0, 4),
      );
      walletToastTimersRef.current.push(
        window.setTimeout(() => dismissWalletToast(toast.id), walletToastTtlMs(TRADE_WALLET_TOAST_TTL_MS)),
      );
    }
    if (seenTradeSignatures.current.size > 4_000) {
      seenTradeSignatures.current = new Set([...seenTradeSignatures.current].slice(-2_000));
    }
  }, [dismissWalletToast, tickerByMint, toastCandidateEvents, trackedWallets]);

  return (
    <>
      <WalletNoticeToastStack
        toasts={walletNoticeToasts}
        onDismiss={dismissWalletToast}
        onMuteWallet={(address) => trackedWallets.updateWalletPrefs(address, { alertsOnToast: false })}
      />
      <TweetTrackerDock ctx="trade" />
      <WalletActivityFeed
        dockContext="trade"
        events={feedWalletActivityEvents}
        trackedWallets={trackedWallets}
        tickerByMint={tickerByMint}
      />
    </>
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
): string | null {
  return resolveSharedTicker(mint, tickerByMint);
}

function cleanToastTicker(value: string | null | undefined, mint: string): string | null {
  const cleaned = value?.trim().replace(/^\$/, '');
  if (!cleaned) return null;
  if (cleaned === mint) return null;
  if (/^(unknown|loading|loading metadata|metadata pending|metadata unavailable)$/i.test(cleaned))
    return null;
  return cleaned;
}
