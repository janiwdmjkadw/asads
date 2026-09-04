'use client';

import { create } from 'zustand';

// User-tweakable style for the tracked-wallet notification toasts
// (Tweaks panel → "Wallet toasts"). `scale` multiplies the toast's fixed
// footprint AND every font size inside it (text auto-scales); `accent`
// overrides the surface tint (null = the default buy/sell accent mix).
// Persisted per browser; reads are render-time only — no effect on any
// stream/data path.

const STORAGE_KEY = 'listen:wallet-toast-style:v1';

export const WALLET_TOAST_SCALE_MIN = 0.8;
export const WALLET_TOAST_SCALE_MAX = 1.4;
// Timer slider bounds (on-screen lifetime). `durationMs: null` keeps the
// built-in per-kind defaults (mint 8s / trade 6.5s).
export const WALLET_TOAST_DURATION_MIN_MS = 3_000;
export const WALLET_TOAST_DURATION_MAX_MS = 15_000;

interface WalletToastStyle {
  scale: number;
  accent: string | null;
  durationMs: number | null;
  setScale: (scale: number) => void;
  setAccent: (accent: string | null) => void;
  setDurationMs: (durationMs: number | null) => void;
  reset: () => void;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(WALLET_TOAST_SCALE_MAX, Math.max(WALLET_TOAST_SCALE_MIN, value));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return WALLET_TOAST_DURATION_MIN_MS;
  return Math.min(WALLET_TOAST_DURATION_MAX_MS, Math.max(WALLET_TOAST_DURATION_MIN_MS, value));
}

type Persisted = { scale: number; accent: string | null; durationMs: number | null };

function readPersisted(): Persisted {
  if (typeof window === 'undefined') return { scale: 1, accent: null, durationMs: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scale: 1, accent: null, durationMs: null };
    const parsed = JSON.parse(raw) as { scale?: unknown; accent?: unknown; durationMs?: unknown };
    return {
      scale: clampScale(typeof parsed.scale === 'number' ? parsed.scale : 1),
      accent: typeof parsed.accent === 'string' && parsed.accent.length > 0 ? parsed.accent : null,
      durationMs: typeof parsed.durationMs === 'number' ? clampDuration(parsed.durationMs) : null,
    };
  } catch {
    return { scale: 1, accent: null, durationMs: null };
  }
}

function persist(scale: number, accent: string | null, durationMs: number | null): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale, accent, durationMs }));
  } catch {
    // Best-effort persistence only.
  }
}

export const useWalletToastStyle = create<WalletToastStyle>((set, get) => ({
  ...readPersisted(),
  setScale: (scale) => {
    const next = clampScale(scale);
    set({ scale: next });
    persist(next, get().accent, get().durationMs);
  },
  setAccent: (accent) => {
    const next = accent && accent.length > 0 ? accent : null;
    set({ accent: next });
    persist(get().scale, next, get().durationMs);
  },
  setDurationMs: (durationMs) => {
    const next = durationMs === null ? null : clampDuration(durationMs);
    set({ durationMs: next });
    persist(get().scale, get().accent, next);
  },
  reset: () => {
    set({ scale: 1, accent: null, durationMs: null });
    persist(1, null, null);
  },
}));

/** Push-time read for the toast auto-dismiss timers (event handlers, not
 *  render): the user's timer if set, else the caller's per-kind default. */
export function walletToastTtlMs(defaultMs: number): number {
  const configured = useWalletToastStyle.getState().durationMs;
  return configured ?? defaultMs;
}
