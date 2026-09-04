'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DiscoverPage } from './DiscoverPage';
import { DiscoverPaneHiddenContext } from './discoverPaneVisibility';

/**
 * Keeps Discover MOUNTED across route changes instead of remounting it on
 * every Trade→Discover return.
 *
 * Why: the return navigation was mount-bound — rebuilding ~130 coin cards +
 * lanes + sorts in one synchronous React commit measured ~6.3s at 4x CPU
 * throttle (~5s reported on real hardware) with the route commit itself
 * blocked behind that commit. Keeping the page mounted turns the return into
 * a display flip: the route's page component renders null and this pane,
 * living in the persistent `TerminalShell`, shows/hides with the pathname.
 *
 * Cost control:
 *  - LAZY: nothing mounts until the user first visits /discover, so trade
 *    deep links pay zero extra.
 *  - While hidden (`display: none`), every card's lane IntersectionObserver
 *    reports non-intersecting → per-coin subscriptions pause (the existing
 *    off-screen machinery), leaving only the coalesced 2Hz page-level order
 *    flushes ticking in the background. The feed store keeps ingesting, so
 *    the unhidden page is instantly current — same lossless full-snapshot
 *    property the navigation feed pause relies on.
 *  - `display: contents` when active keeps DiscoverPage's <main> a direct
 *    flex child of the shell wrapper, exactly as when it was the route page.
 *
 * `discover:pane-active` marks every activation (the perf harness and prod
 * devtools measure return latency from it).
 */
export function PersistentDiscoverPane() {
  const pathname = usePathname();
  const active = pathname === '/discover';
  const [everActive, setEverActive] = useState(active);

  useEffect(() => {
    if (active) {
      setEverActive(true);
      performance.mark('discover:pane-active');
    }
  }, [active]);

  if (!active && !everActive) return null;
  return (
    <DiscoverPaneHiddenContext.Provider value={!active}>
      {/* display:none while hidden — measured choice: a visibility-hidden
          variant kept these ~12k nodes in the layout tree and taxed every
          layout pass during navigation commits (forward click->chart
          regressed 1.6s -> 6.6s p50 @4x). Discarded layout costs ~2s relayout
          on reveal @4x (~190ms @1x), which is the better trade. */}
      <div style={{ display: active ? 'contents' : 'none' }} aria-hidden={!active}>
        <DiscoverPage />
      </div>
    </DiscoverPaneHiddenContext.Provider>
  );
}
