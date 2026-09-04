/**
 * Opt-in gate for the developer console mirrors of timing telemetry
 * ([search], [chart-load]). The data itself always reaches the server
 * beacons — the console lines are a debugging convenience, and a user's
 * console should be silent by default (console traffic also costs real
 * main-thread time whenever DevTools is open).
 *
 * Enable in a browser console with:
 *   localStorage.setItem('listen:verbose-logs', '1')
 */
const VERBOSE_LOGS_KEY = 'listen:verbose-logs';

let cached: boolean | null = null;

export function verboseLogsEnabled(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  try {
    cached = window.localStorage.getItem(VERBOSE_LOGS_KEY) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

/** Test-only: reset the module cache. */
export function __resetVerboseLogsCacheForTests(): void {
  cached = null;
}
