import { create } from 'zustand';

/**
 * THE BLACKLISTS, AND THE TWO HIDDEN-TOKEN PREFERENCES.
 *
 * Three lists and two switches, all per user and all persisted locally:
 *
 *   devs      creator wallets whose launches never show
 *   handles   X handles whose launches never show
 *   show      whether hidden tokens are shown anyway
 *   migrate   whether a hidden token comes back when it graduates
 *
 * Hidden MINTS are not here. They already live server-side, per user,
 * behind `useHiddenTokens`, and a second copy of that set would be a
 * second answer to the same question. This store holds the two lists
 * that had nowhere to live and the two preferences that steer the set.
 *
 * ── WHAT THEY FILTER ON ──────────────────────────────────────────────
 *
 * `coin.creator` and `coin.handle`, both of which the feed already
 * carries on every row (see `LiveNewPair` and the adapter that builds
 * `MockCoin` from it). Nothing here filters on data that does not exist.
 */

const STORAGE_KEY = 'discover:blacklists:v1';

/** Mirrors the cap the reference clients use, and keeps a pasted wall of
 *  addresses from filling localStorage. */
export const MAX_BLACKLIST_ENTRIES = 1000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A Solana address, which is what a dev entry has to be to match one. */
export function isValidDevAddress(input: string): boolean {
  return BASE58_RE.test(input.trim());
}

/**
 * An X handle, with or without the leading @, and stored without it.
 * Folded to lower case because the feed's handles are not consistently
 * cased and a blacklist that is case sensitive is a blacklist that
 * silently misses.
 */
export function normalizeHandle(input: string): string | null {
  const handle = input.trim().replace(/^@+/, '').toLowerCase();
  if (handle.length === 0 || handle.length > 30) return null;
  return /^[a-z0-9_]+$/.test(handle) ? handle : null;
}

export interface BlacklistState {
  devs: readonly string[];
  handles: readonly string[];
  /** Show hidden tokens on the board anyway, without unhiding them. */
  showHiddenTokens: boolean;
  /** A hidden token comes back the moment it graduates. */
  unhideOnMigration: boolean;

  hydrate: () => void;
  addDev: (address: string) => boolean;
  removeDev: (address: string) => void;
  addHandle: (handle: string) => boolean;
  removeHandle: (handle: string) => void;
  /** Bulk add, for a pasted or imported list. Returns how many landed. */
  importDevs: (raw: string) => number;
  importHandles: (raw: string) => number;
  clearDevs: () => void;
  clearHandles: () => void;
  setShowHiddenTokens: (show: boolean) => void;
  setUnhideOnMigration: (unhide: boolean) => void;
}

interface Persisted {
  devs: string[];
  handles: string[];
  showHiddenTokens: boolean;
  unhideOnMigration: boolean;
}

function read(): Persisted {
  const empty: Persisted = {
    devs: [],
    handles: [],
    showHiddenTokens: false,
    unhideOnMigration: false,
  };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      devs: sanitize(parsed.devs, isValidDevAddress),
      handles: sanitize(parsed.handles, (h) => normalizeHandle(h) !== null).map(
        (h) => normalizeHandle(h) ?? h,
      ),
      showHiddenTokens: parsed.showHiddenTokens === true,
      unhideOnMigration: parsed.unhideOnMigration === true,
    };
  } catch {
    return empty;
  }
}

function sanitize(value: unknown, valid: (entry: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!valid(trimmed) || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_BLACKLIST_ENTRIES) break;
  }
  return out;
}

function write(state: BlacklistState): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: Persisted = {
      devs: [...state.devs],
      handles: [...state.handles],
      showHiddenTokens: state.showHiddenTokens,
      unhideOnMigration: state.unhideOnMigration,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Local preference only; ignore quota and private-window failures.
  }
}

export const useBlacklistStore = create<BlacklistState>((set, get) => {
  const commit = (patch: Partial<BlacklistState>) => {
    const next = { ...get(), ...patch };
    write(next);
    set(patch);
  };

  return {
    // Empty on the server and on the first client render, so the two
    // agree; `hydrate` runs in an effect after mount (same pattern the
    // discover store uses for its own persisted layout).
    devs: [],
    handles: [],
    showHiddenTokens: false,
    unhideOnMigration: false,

    hydrate: () => set(read()),

    addDev: (address) => {
      const entry = address.trim();
      if (!isValidDevAddress(entry)) return false;
      const { devs } = get();
      if (devs.includes(entry) || devs.length >= MAX_BLACKLIST_ENTRIES) return false;
      commit({ devs: [entry, ...devs] });
      return true;
    },
    removeDev: (address) => commit({ devs: get().devs.filter((d) => d !== address) }),

    addHandle: (handle) => {
      const entry = normalizeHandle(handle);
      if (entry === null) return false;
      const { handles } = get();
      if (handles.includes(entry) || handles.length >= MAX_BLACKLIST_ENTRIES) return false;
      commit({ handles: [entry, ...handles] });
      return true;
    },
    removeHandle: (handle) => commit({ handles: get().handles.filter((h) => h !== handle) }),

    /* Split on anything that is not part of an address: a pasted list is
       one per line as often as it is comma separated, and asking which
       one it was is a question the paste already answers. */
    importDevs: (raw) => {
      const { devs } = get();
      const next = [...devs];
      for (const part of raw.split(/[^1-9A-HJ-NP-Za-km-z]+/)) {
        const entry = part.trim();
        if (!isValidDevAddress(entry) || next.includes(entry)) continue;
        next.push(entry);
        if (next.length >= MAX_BLACKLIST_ENTRIES) break;
      }
      const added = next.length - devs.length;
      if (added > 0) commit({ devs: next });
      return added;
    },
    importHandles: (raw) => {
      const { handles } = get();
      const next = [...handles];
      for (const part of raw.split(/[^@A-Za-z0-9_]+/)) {
        const entry = normalizeHandle(part);
        if (entry === null || next.includes(entry)) continue;
        next.push(entry);
        if (next.length >= MAX_BLACKLIST_ENTRIES) break;
      }
      const added = next.length - handles.length;
      if (added > 0) commit({ handles: next });
      return added;
    },

    clearDevs: () => commit({ devs: [] }),
    clearHandles: () => commit({ handles: [] }),
    setShowHiddenTokens: (show) => commit({ showHiddenTokens: show }),
    setUnhideOnMigration: (unhide) => commit({ unhideOnMigration: unhide }),
  };
});
