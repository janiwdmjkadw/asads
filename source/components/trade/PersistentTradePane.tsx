'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TradePage } from './TradePage';
import { TradePaneHiddenContext } from './tradePaneVisibility';

function mintFromPathname(pathname: string | null): string | null {
  const match = /^\/trade\/([^/]+)$/.exec(pathname ?? '');
  if (!match) return null;
  const raw = decodeURIComponent(match[1]);
  if (raw.length < 32 || raw.length > 64) return null;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw)) return null;
  return raw;
}

/**
 * Keeps the Trade page MOUNTED across route changes — the symmetric twin of
 * `PersistentDiscoverPane`. Leaving the chart no longer tears it down
 * (lightweight-charts dispose + ~5k nodes + effect cleanups rode in the
 * same commit as the Discover reveal), and returning to the SAME chart is a
 * visibility flip onto an already-rendered, buffered-current page.
 *
 *  - LAZY: mounts on the first /trade visit; deep links elsewhere pay zero.
 *  - Mint swaps IN PLACE on /trade/:mint changes (PriceChart's tokenChanged
 *    path); while hidden the pane retains the LAST mint so TradePage keeps
 *    rendering it invisibly.
 *  - `TradePaneHiddenContext` drives the dormancy gates inside TradePage
 *    (polls/heartbeat stop; the selected-token SSE buffers without
 *    applying — reveal applies the buffered tail and is instantly current).
 *  - `trade:pane-active` marks every activation for the perf harness and
 *    prod devtools.
 */
export function PersistentTradePane() {
  const pathname = usePathname();
  const urlMint = mintFromPathname(pathname);
  const active = urlMint !== null;
  const [retainedMint, setRetainedMint] = useState<string | null>(urlMint);

  useEffect(() => {
    if (active && urlMint) {
      setRetainedMint(urlMint);
      performance.mark('trade:pane-active', { detail: { mint: urlMint } });
    }
  }, [active, urlMint]);

  const mint = urlMint ?? retainedMint;
  if (mint === null) return null; // never visited a chart this session
  return (
    <TradePaneHiddenContext.Provider value={!active}>
      {/* display:none while hidden (same measured reasoning as the Discover
          pane — hidden-but-laid-out subtrees tax every navigation commit).
          The win of this pane is persistence: no teardown when leaving the
          chart, in-place mint swaps, and the dormancy gates + buffered SSE
          keep the hidden page cheap yet instantly current on reveal. */}
      <div style={{ display: active ? 'contents' : 'none' }} aria-hidden={!active}>
        <TradePage mintOverride={mint} />
      </div>
    </TradePaneHiddenContext.Provider>
  );
}
