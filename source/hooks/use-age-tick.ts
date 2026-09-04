import { useEffect, useState } from 'react';

const FRESH_WINDOW_MS = 60_000;
const FAST_TICK_MS = 1_000;
const SLOW_TICK_MS = 30_000;

/**
 * Coarse re-render clock for feeds that display relative ages.
 *
 * Ages under a minute render at second resolution ("47s"), so while the
 * newest item is that fresh the tick fires every second and the labels
 * count up live. Once everything on screen is minutes old, the tick backs
 * off to 30s — "3m"/"2h" labels can't change faster than that, so there is
 * no reason to re-render the rows every second forever.
 *
 * The freshness check re-runs on every fire, so a feed that goes quiet
 * automatically decays from the fast tick to the slow one without any
 * effect re-run.
 *
 * @param newestAtMs timestamp of the newest visible item (null = no items)
 * @param enabled    gate the clock entirely (panel closed / hidden)
 */
export function useAgeTick(newestAtMs: number | null, enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || newestAtMs == null) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const fresh = Date.now() - newestAtMs < FRESH_WINDOW_MS;
      timer = setTimeout(
        () => {
          setTick((current) => current + 1);
          schedule();
        },
        fresh ? FAST_TICK_MS : SLOW_TICK_MS,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled, newestAtMs]);
  return tick;
}
