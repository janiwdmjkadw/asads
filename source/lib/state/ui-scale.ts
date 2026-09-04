'use client';

import { create } from 'zustand';

// User-tweakable UI auto-scale for standard-density (~1x) screens
// (Tweaks panel → "UI scale"). globals.css applies `html { zoom }` on
// low-DPI screens only; this store dials the factor via the
// `--ui-scale-pref` custom property that the media query reads
// (`--ui-scale: var(--ui-scale-pref, 1.18)`). On high-DPI screens the
// media query never applies zoom, so the preference is inert there —
// the control should not be shown. Persisted per browser.

const STORAGE_KEY = 'listen:ui-scale-low-dpi:v1';

export const UI_SCALE_MIN = 1;
export const UI_SCALE_MAX = 1.35;
export const UI_SCALE_DEFAULT = 1.18;

/** Matches the low-DPI media query in globals.css that gates the zoom. */
export const LOW_DPI_MEDIA_QUERY = '(max-resolution: 1.49dppx)';

interface UiScaleState {
  scale: number;
  setScale: (scale: number) => void;
  reset: () => void;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

function readPersisted(): number {
  if (typeof window === 'undefined') return UI_SCALE_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return UI_SCALE_DEFAULT;
    const parsed = JSON.parse(raw) as { scale?: unknown };
    return clampScale(typeof parsed.scale === 'number' ? parsed.scale : UI_SCALE_DEFAULT);
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

function persist(scale: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale }));
  } catch {
    // Best-effort persistence only.
  }
}

function applyPref(scale: number): void {
  if (typeof document === 'undefined') return;
  if (scale === UI_SCALE_DEFAULT) {
    document.documentElement.style.removeProperty('--ui-scale-pref');
  } else {
    document.documentElement.style.setProperty('--ui-scale-pref', String(scale));
  }
}

const initialScale = readPersisted();
// Apply at module evaluation for the earliest possible paint. React's root
// hydration can reconcile <html>'s style attribute and drop this write, so
// applyStoredUiScale() below MUST also run from a post-hydration effect
// (Providers) — this early call just avoids a flash when it survives.
applyPref(initialScale);

/** Re-apply the persisted scale; call after hydration (see Providers). */
export function applyStoredUiScale(): void {
  applyPref(useUiScale.getState().scale);
}

export const useUiScale = create<UiScaleState>((set) => ({
  scale: initialScale,
  setScale: (scale) => {
    const next = clampScale(scale);
    set({ scale: next });
    applyPref(next);
    persist(next);
  },
  reset: () => {
    set({ scale: UI_SCALE_DEFAULT });
    applyPref(UI_SCALE_DEFAULT);
    persist(UI_SCALE_DEFAULT);
  },
}));
