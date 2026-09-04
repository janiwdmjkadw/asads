'use client';

import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  TERMINAL_NAVIGATE_EVENT,
  TERMINAL_PREFETCH_EVENT,
  type TerminalHrefDetail,
} from '@/lib/navigation-events';
import {
  pauseFeedForNavigation,
  resumeFeedAfterNavigation,
} from '@/components/discover/feedNavigationPause';
import { makeQueryClient } from '@/lib/query/query-client';
import { startPerfTelemetry } from '@/lib/perf/perfTelemetry';
import { startNavTelemetry } from '@/lib/perf/navTelemetry';
import { restorePersistedQueries, startPersistingQueries } from '@/lib/query/persist';
import { WalletPanelProvider } from '@/lib/wallet-panel-context';
import { ClerkSessionSync } from '@/components/auth/ClerkSessionSync';
import { TradingAuthorizationSync } from '@/components/auth/TradingAuthorizationSync';
import { ReferralBindSync } from '@/components/auth/ReferralBindSync';
import { applyStoredUiScale } from '@/lib/state/ui-scale';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  // Site-wide main-thread/memory telemetry (long tasks, script blame, worst
  // input latency, heap) — one sampled [perf-beacon] per 30s window — plus
  // per-navigation latency traces (one [nav-beacon] per route transition:
  // input→nav→push→paint→ready stage waterfall with in-flight blocking).
  useEffect(() => {
    startPerfTelemetry();
    startNavTelemetry();
    // Persisted low-DPI UI-scale preference: the module-eval application can
    // be dropped when React hydrates <html>'s style attribute; re-assert it
    // once the tree is live.
    applyStoredUiScale();
  }, []);

  // Restore the persisted token read cache on boot, then keep persisting it. Non-gated
  // (runs after mount) so it is SSR-safe; a chart open after a reload paints from the
  // restored snapshot the moment restore lands, ahead of the network.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void restorePersistedQueries(queryClient)
      .finally(() => {
        if (cancelled) return;
        stop = startPersistingQueries(queryClient);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <NavigationEventBridge />
      {/* Mirror the Clerk JWT into a global Zustand store so hot-path
          callers (Quickbuy click, prewarm interval, order submit)
          read the token synchronously instead of awaiting
          `getToken()`. Lives inside ClerkProvider (in app/layout.tsx)
          and outside the wallet panel — the order here doesn't
          matter, but must be inside ClerkProvider's tree. */}
      <ClerkSessionSync />
      <TradingAuthorizationSync />
      {/* Slice "Referral & Rewards": bind a captured /fren slug to the user
          once signed in (no-op when there's nothing captured). */}
      <ReferralBindSync />
      {/*
       * Slice "theme audit": the singleton `<WalletPanel/>` USED to be
       * rendered here as a sibling of `{children}`. That meant it sat
       * outside the `.listen-root` div created by `<ThemeProvider/>`
       * (which wraps the terminal shell), so the wallet modal could
       * not see theme-scoped CSS variables (`--surface-1`, `--ink-*`,
       * `--accent-*`, etc.) and rendered with the global dark
       * defaults — even when the user picked the zen / parchment
       * theme. The singleton now lives inside `TerminalShell` so it
       * naturally inherits the active theme.
       */}
      <WalletPanelProvider>{children}</WalletPanelProvider>
    </QueryClientProvider>
  );
}

/* Session-scoped dedupe for router.prefetch (see onPrefetch below). Module
   level so a bridge remount can't reset it. Bounded: insertion-order evict
   past the cap (re-allowing a re-prefetch then is harmless — the cap exists
   only to keep the set itself small). */
const ROUTER_PREFETCHED_HREF_CAP = 2_048;
const routerPrefetchedHrefs = new Set<string>();

function shouldRouterPrefetch(href: string): boolean {
  if (routerPrefetchedHrefs.has(href)) return false;
  routerPrefetchedHrefs.add(href);
  if (routerPrefetchedHrefs.size > ROUTER_PREFETCHED_HREF_CAP) {
    const oldest = routerPrefetchedHrefs.values().next().value;
    if (oldest !== undefined) routerPrefetchedHrefs.delete(oldest);
  }
  return true;
}

function NavigationEventBridge() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  // The trade-warm machinery (prewarm + stores) is lazy-loaded on the first
  // navigate/prefetch event so it stays out of every page bundle (including
  // the marketing homepage). Cached here so subsequent events warm sync-fast.
  const warmModsRef = useRef<WarmModules | null>(null);

  // Route settled (new pathname committed + this effect ran post-paint):
  // resume the feed and apply the frame stashed during the transition.
  useEffect(() => {
    resumeFeedAfterNavigation();
  }, [pathname]);

  useEffect(() => {
    // Universal prewarm: ANY navigation/prefetch to a `/trade/:mint` href warms the
    // snapshot + chart + panels (and the matching server-side Redis keys), so search,
    // portfolio, tracker, toasts, and direct links all open instantly — not just the
    // Discover cards that historically warmed on hover/pointer-down.
    const runWarm = (mods: WarmModules, mint: string) => {
      // Match the snapshot key the trade page reads: discover-sourced mints skip
      // identity hydration; direct/old mints request it. Established mints (opened
      // before, resolved to a real snapshot) are also "known" — TradePage's
      // `isKnownMint` includes them, so without this an established coin whose
      // live TTL lapsed would warm the WRONG snapshot cache key (cold fetch).
      const isKnown =
        mods.isRememberedLiveTokenMint(mint) || mods.isEstablishedTokenMint(mint);
      mods.warmTokenTradeData(queryClient, mint, { hydrateIdentity: !isKnown });
      try {
        mods.warmTokenPanels(queryClient, mint);
      } catch {
        // best-effort panel warm only
      }
    };
    const warmIfTokenHref = (href: string | null) => {
      const mint = tokenMintFromHref(href);
      if (!mint) return;
      const mods = warmModsRef.current;
      if (mods) {
        runWarm(mods, mint);
        return;
      }
      // Fire-and-forget: navigation must never wait on the chunk — the warm
      // fires when the import resolves (dynamic import de-dupes concurrent
      // loads). A failed chunk load only skips the warm; never let it become
      // an unhandled rejection.
      void loadWarmModules()
        .then((loaded) => {
          warmModsRef.current = loaded;
          runWarm(loaded, mint);
        })
        .catch(() => undefined);
    };
    const onNavigate = (event: Event) => {
      const href = eventHref(event);
      if (!href) return;
      event.preventDefault();
      // The warm is best-effort and must NEVER block or break the
      // navigation — a throw between preventDefault and push would eat
      // the click with no fallback.
      try {
        warmIfTokenHref(href);
      } catch {
        // best-effort warm only
      }
      /* Give the route transition the main thread: Discover's per-frame
         feed application starves router.push on weak CPUs (measured ~5s of
         click→chart latency at 4x throttle). Frames are stashed, not
         dropped — the pathname-settle effect below (or a 2s safety timer)
         resumes and applies the latest full snapshot losslessly. */
      pauseFeedForNavigation();
      router.push(href);
    };
    const onPrefetch = (event: Event) => {
      const detail = eventDetail(event);
      const href = detail?.href ?? null;
      if (!href) return;
      warmIfTokenHref(href);
      /* Route-RSC prefetch AT MOST ONCE per href per session. Next 15.5's
         router.prefetch keeps each prefetch's response stream open forever
         (`createUnclosingPrefetchStream`; fixed upstream for Next 16 by PR
         #89610 "Avoid using unclosing prefetch streams in the browser") and
         Chromium pins unclosed streams as native GC roots — measured at
         ~1.6MB of renderer-native memory (mojo data pipe + RawResource +
         Flight response) leaked per DISTINCT prefetched URL. Discover's
         per-mint fan-out made that unbounded (~1MB/new mint; gigabytes in a
         long prod session). Data warms above stay unconditional — only the
         router prefetch is deduped. A click on an expired-prefetch href
         just pays the normal on-navigation RSC fetch, exactly as it already
         did >30s after any prefetch. */
      if (shouldRouterPrefetch(href)) router.prefetch(href);
    };
    window.addEventListener(TERMINAL_NAVIGATE_EVENT, onNavigate);
    window.addEventListener(TERMINAL_PREFETCH_EVENT, onPrefetch);
    return () => {
      window.removeEventListener(TERMINAL_NAVIGATE_EVENT, onNavigate);
      window.removeEventListener(TERMINAL_PREFETCH_EVENT, onPrefetch);
    };
  }, [router, queryClient]);
  return null;
}

interface WarmModules {
  isRememberedLiveTokenMint: typeof import('@/components/listen/navigation').isRememberedLiveTokenMint;
  isEstablishedTokenMint: typeof import('@/components/listen/navigation').isEstablishedTokenMint;
  warmTokenTradeData: typeof import('@/components/trade/useTokenTradePrewarm').warmTokenTradeData;
  warmTokenPanels: typeof import('@/components/trade/useTokenTradePrewarm').warmTokenPanels;
}

async function loadWarmModules(): Promise<WarmModules> {
  const [{ warmTokenTradeData, warmTokenPanels }, { isRememberedLiveTokenMint, isEstablishedTokenMint }] =
    await Promise.all([
      import('@/components/trade/useTokenTradePrewarm'),
      import('@/components/listen/navigation'),
    ]);
  return { isRememberedLiveTokenMint, isEstablishedTokenMint, warmTokenTradeData, warmTokenPanels };
}

function eventHref(event: Event): string | null {
  return eventDetail(event)?.href ?? null;
}

function eventDetail(event: Event): TerminalHrefDetail | null {
  return (event as CustomEvent<TerminalHrefDetail>).detail ?? null;
}

/** Extract a mint from a `/trade/:mint` href; null for any other route. */
function tokenMintFromHref(href: string | null): string | null {
  if (!href) return null;
  const path = href.split('?')[0]?.split('#')[0] ?? '';
  const prefix = '/trade/';
  if (!path.startsWith(prefix)) return null;
  const raw = path.slice(prefix.length);
  if (!raw || raw.includes('/')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
