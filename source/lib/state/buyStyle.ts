'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/*
 * ── HOW THE QUICK BUY BUTTON LOOKS ───────────────────────────────────
 *
 * Size, corner, and the two colours. Chosen in the Tweaks palette and
 * applied as CSS custom properties on the document root, so the row
 * stylesheet reads them and nothing has to be threaded through the
 * column, the section and the row to get there.
 *
 * ── WHY SIZE IS AN ATTRIBUTE AND THE REST ARE VARIABLES ──────────────
 *
 * Colour and radius are single values: one property each, and the
 * button reads them. Size is not — `ultra` is a different LAYOUT, a
 * panel down the row's right edge rather than a chip in its corner, and
 * a layout cannot be expressed as a variable. So size lands as
 * `data-buy` on the column, which is the switch the row CSS already
 * has, and small/medium/ultra select between the three arrangements
 * that were built on `/whatever`.
 */

export type BuySize = 'small' | 'medium' | 'ultra';
export type BuyShape = 'rounded' | 'sharp';

export interface BuyStyle {
  size: BuySize;
  shape: BuyShape;
  /** The button's own ground. */
  bg: string;
  /** The label and its bolt. */
  fg: string;
}

export const BUY_DEFAULT: BuyStyle = {
  size: 'ultra',
  shape: 'rounded',
  bg: '#86efac',
  fg: '#000000',
};

/*
 * Grounds worth offering, not a colour picker.
 *
 * A free picker on a button this loud produces unreadable pairs — the
 * one control on the row set in a tone the label cannot sit on. These
 * are the board's own values plus white and a neutral, and each is a
 * colour something else on this surface already means.
 */
export const BUY_BACKGROUNDS: { id: string; label: string }[] = [
  { id: '#86efac', label: 'Green' },
  { id: '#284733', label: 'Deep green' },
  { id: '#ffffff', label: 'White' },
  { id: '#e8b33d', label: 'Gold' },
  { id: '#778ad6', label: 'Blue' },
  { id: 'transparent', label: 'None' },
];

export const BUY_FOREGROUNDS: { id: string; label: string }[] = [
  { id: '#000000', label: 'Black' },
  { id: '#ffffff', label: 'White' },
  { id: '#86efac', label: 'Green' },
  { id: '#e8b33d', label: 'Gold' },
];

const KEY = 'listen.buyStyle';

function read(): BuyStyle {
  if (typeof window === 'undefined') return BUY_DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...BUY_DEFAULT, ...(JSON.parse(raw) as Partial<BuyStyle>) } : BUY_DEFAULT;
  } catch {
    /* A quota error or a private window is not a reason to render
       nothing — the default is a working button. */
    return BUY_DEFAULT;
  }
}

/** Push the choice onto the root so the stylesheets can see it. */
export function applyBuyStyle(s: BuyStyle) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.buySize = s.size;
  root.style.setProperty('--buy-radius', s.shape === 'sharp' ? '5px' : '999px');
  root.style.setProperty('--buy-bg', s.bg);
  root.style.setProperty('--buy-fg', s.fg);
}

/*
 * ── ONE STORE, NOT ONE PER COMPONENT ─────────────────────────────────
 *
 * This started as a `useState` inside the hook, which gives every
 * caller its OWN copy: the palette changed its copy and the column
 * never heard about it, so the setting saved and did nothing until a
 * reload. The panel and the column are in different trees, so there is
 * no shared parent to hold it either.
 *
 * A module-level value with a subscriber list is the smallest thing
 * that fixes that, and `useSyncExternalStore` is how React reads one
 * without tearing.
 */
let current: BuyStyle = BUY_DEFAULT;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* The server has no localStorage, so it gets the default — and the
   client must return that same object on its first read or the two
   renders disagree and the first paint is thrown away. */
const serverSnapshot = () => BUY_DEFAULT;
const snapshot = () => current;

export function setBuyStyle(patch: Partial<BuyStyle>) {
  current = { ...current, ...patch };
  applyBuyStyle(current);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* The choice still applies for this session. */
  }
  emit();
}

export function useBuyStyle() {
  const style = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  /* Hydrate once, after mount, from whatever was saved. */
  useEffect(() => {
    if (hydrated) {
      applyBuyStyle(current);
      return;
    }
    hydrated = true;
    current = read();
    applyBuyStyle(current);
    emit();
  }, []);

  const set = useCallback((patch: Partial<BuyStyle>) => setBuyStyle(patch), []);
  return { style, set };
}
