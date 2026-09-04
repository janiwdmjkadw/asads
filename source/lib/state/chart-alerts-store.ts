'use client';

import { create } from 'zustand';

/**
 * Armed chart price alerts (session-scoped, cross-page). TradePage arms
 * them from the chart's right-click menu with the coin's identity
 * attached, so wherever the user is when one fires, the notification
 * can show the coin image + ticker and click through to its trade
 * page. Fired alerts disarm. Watching happens in two tiers:
 *
 *   - the trade page's live 1s snapshot for the coin being viewed;
 *   - `ChartAlertsWatcher` (mounted in the shell) polling the search
 *     endpoint for every other armed mint.
 */

export interface ArmedChartAlert {
  readonly id: string;
  readonly mint: string;
  readonly ticker: string;
  readonly imageUrl: string | null;
  /** Threshold in USD market cap. */
  readonly usdMc: number;
  readonly direction: 'above' | 'below';
  /** Wall-clock stamped by `arm` — `ChartAlertsWatcher` live-streams only
   *  the most recently armed mints past its connection cap. (Fired-log
   *  entries persisted before this field existed lack it; the log never
   *  reads it.) */
  readonly armedAtMs: number;
}

/** A fired alert, kept for the bell's local notification log. */
export interface FiredChartAlert extends ArmedChartAlert {
  readonly firedAtMs: number;
  /** Market cap observed at trigger time. */
  readonly mcUsd: number;
  readonly seen: boolean;
}

interface ChartAlertsState {
  alerts: ReadonlyArray<ArmedChartAlert>;
  /** Newest-first fired log (bounded, localStorage-persisted). */
  fired: ReadonlyArray<FiredChartAlert>;
  arm: (alert: Omit<ArmedChartAlert, 'armedAtMs'>) => void;
  disarm: (ids: ReadonlyArray<string>) => void;
  recordFired: (alert: ArmedChartAlert, mcUsd: number) => void;
  markFiredSeen: () => void;
  clearFired: () => void;
}

const FIRED_STORAGE_KEY = 'trade:chart-alerts-fired:v1';
// Active traders arm many alerts; 20 lost same-day history. ~10KB localStorage.
const FIRED_MAX = 100;

function loadFired(): FiredChartAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(FIRED_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as FiredChartAlert[]) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.mint === 'string' &&
        typeof item.ticker === 'string' &&
        typeof item.usdMc === 'number' &&
        typeof item.firedAtMs === 'number',
    );
  } catch {
    return [];
  }
}

function persistFired(fired: ReadonlyArray<FiredChartAlert>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(fired.slice(0, FIRED_MAX)));
  } catch {
    // best-effort log
  }
}

export const useChartAlertsStore = create<ChartAlertsState>((set, get) => ({
  alerts: [],
  fired: loadFired(),
  arm: (alert) =>
    set((state) => ({
      alerts: [...state.alerts, { ...alert, armedAtMs: Date.now() }],
    })),
  disarm: (ids) =>
    set((state) => ({
      alerts: state.alerts.filter((alert) => !ids.includes(alert.id)),
    })),
  recordFired: (alert, mcUsd) => {
    const entry: FiredChartAlert = {
      ...alert,
      firedAtMs: Date.now(),
      mcUsd,
      seen: false,
    };
    const fired = [entry, ...get().fired].slice(0, FIRED_MAX);
    set({ fired });
    persistFired(fired);
  },
  markFiredSeen: () => {
    const fired = get().fired.map((item) => (item.seen ? item : { ...item, seen: true }));
    set({ fired });
    persistFired(fired);
  },
  clearFired: () => {
    set({ fired: [] });
    persistFired([]);
  },
}));
