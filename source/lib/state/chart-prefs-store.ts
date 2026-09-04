'use client';

import { create } from 'zustand';

/**
 * Trade-chart display preferences: axis unit (USD/SOL), scale mode
 * (MarketCap/Price), the Hide-All-Bubbles master switch, and the
 * TradingView-style canvas customization the chart settings dialog
 * edits. Persisted to localStorage so a trader's canvas survives
 * reloads; every consumer (ChartToolbar, PriceChart, TradePage)
 * subscribes to this one store, so a toolbar flip re-scales the chart
 * in the same frame.
 */

import {
  DEFAULT_CHART_STYLE,
  normalizeChartStyle,
  type ChartStyleSettings,
} from './chart-style';

export type ChartUnit = 'USD' | 'SOL';
export type ChartScaleMode = 'MarketCap' | 'Price';

// The style MODEL (paints, patterns, presets, normalization/migration)
// lives in ./chart-style — this store only owns persistence + updates.
export { DEFAULT_CHART_STYLE } from './chart-style';
export type { ChartStyleSettings } from './chart-style';

interface ChartPrefsState {
  unit: ChartUnit;
  mode: ChartScaleMode;
  hideBubbles: boolean;
  style: ChartStyleSettings;
  settingsOpen: boolean;
  setUnit: (unit: ChartUnit) => void;
  setMode: (mode: ChartScaleMode) => void;
  setHideBubbles: (hide: boolean) => void;
  /** Shallow patch of top-level style sections (each section replaced
   *  wholesale — the studio always writes complete section objects). */
  setStyle: (patch: Partial<ChartStyleSettings>) => void;
  /** Replace the entire style (preset application). */
  replaceStyle: (style: ChartStyleSettings) => void;
  resetStyle: () => void;
  setSettingsOpen: (open: boolean) => void;
}

const STORAGE_KEY = 'trade:chart-prefs:v1';

interface PersistedPrefs {
  unit?: ChartUnit;
  mode?: ChartScaleMode;
  hideBubbles?: boolean;
  /** New nested shape OR the legacy flat v1 shape — normalizeChartStyle
   *  accepts either. */
  style?: unknown;
}

function loadPersisted(): PersistedPrefs {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(state: ChartPrefsState): void {
  if (typeof window === 'undefined') return;
  try {
    const out: PersistedPrefs = {
      unit: state.unit,
      mode: state.mode,
      hideBubbles: state.hideBubbles,
      style: state.style,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // best-effort
  }
}

export const useChartPrefsStore = create<ChartPrefsState>((set, get) => ({
  // SSR-safe defaults: seeding from localStorage at module scope made the
  // first client render differ from the server HTML (hydration desync).
  // Persisted prefs apply after mount via `hydrateChartPrefs()`.
  unit: 'USD',
  mode: 'MarketCap',
  hideBubbles: false,
  style: { ...DEFAULT_CHART_STYLE },
  settingsOpen: false,
  setUnit: (unit) => {
    set({ unit });
    persist(get());
  },
  setMode: (mode) => {
    set({ mode });
    persist(get());
  },
  setHideBubbles: (hideBubbles) => {
    set({ hideBubbles });
    persist(get());
  },
  setStyle: (patch) => {
    set({ style: { ...get().style, ...patch } });
    persist(get());
  },
  replaceStyle: (style) => {
    set({ style: normalizeChartStyle(style) });
    persist(get());
  },
  resetStyle: () => {
    set({ style: normalizeChartStyle(DEFAULT_CHART_STYLE) });
    persist(get());
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));

let chartPrefsHydrated = false;

/** Apply persisted prefs AFTER mount (call from a client effect): the
 *  store must render server-matching defaults on the hydration pass. */
export function hydrateChartPrefs(): void {
  if (chartPrefsHydrated || typeof window === 'undefined') return;
  chartPrefsHydrated = true;
  const persisted = loadPersisted();
  useChartPrefsStore.setState({
    unit: persisted.unit === 'SOL' ? 'SOL' : 'USD',
    mode: persisted.mode === 'Price' ? 'Price' : 'MarketCap',
    hideBubbles: persisted.hideBubbles === true,
    // normalizeChartStyle also migrates the legacy flat v1 shape, so a
    // pre-studio localStorage payload keeps its colors.
    style: normalizeChartStyle(persisted.style),
  });
}
