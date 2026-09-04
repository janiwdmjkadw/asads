'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

const PersistentTabVisibilityContext = createContext(true);

/** Whether the nearest persistent tab pane is currently visible. */
export function usePersistentTabVisible(): boolean {
  return useContext(PersistentTabVisibilityContext);
}

/**
 * Keeps a tab page MOUNTED across route changes — the generic sibling of
 * `PersistentDiscoverPane` / `PersistentTradePane`, for the simple tabs
 * (tracker, portfolio, rewards).
 *
 * Why: switching to these tabs was mount-bound. Field `[nav-beacon]` data
 * showed 500–2000ms totals with heavy in-flight main-thread blocking
 * (Discover→Tracker 995ms with 1060ms blocked; Tracker→Rewards 1986ms) —
 * all `rsc=-1` (no network), pure teardown+rebuild cost. With the pane the
 * first visit pays the mount once; every later switch is a display flip.
 *
 *  - LAZY: nothing mounts until the user first visits the route.
 *  - `display: none` while hidden (the measured choice from the Discover
 *    pane: hidden-but-laid-out subtrees tax every navigation commit).
 *  - Consumers can pause polling through `usePersistentTabVisible`; changing
 *    from hidden to visible re-enables their query and triggers a fresh read.
 *  - `tab:pane-active` marks every activation; navTelemetry uses it as the
 *    readiness signal for these routes.
 */
export function PersistentTabPane({
  prefix,
  children,
}: {
  /** Route prefix that activates this pane, e.g. "/tracker". */
  prefix: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === prefix || pathname?.startsWith(`${prefix}/`) === true;
  const [everActive, setEverActive] = useState(active);

  useEffect(() => {
    if (active) {
      setEverActive(true);
      performance.mark('tab:pane-active', { detail: { prefix } });
    }
  }, [active, prefix]);

  if (!active && !everActive) return null;
  return (
    <PersistentTabVisibilityContext.Provider value={active}>
      <div style={{ display: active ? 'contents' : 'none' }} aria-hidden={!active}>
        {children}
      </div>
    </PersistentTabVisibilityContext.Provider>
  );
}
