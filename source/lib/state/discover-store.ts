import { create } from 'zustand';
import {
  FILTER_METRICS,
  MAX_FILTER_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  MODE_KEYS,
  PROTOCOL_KEYS,
  QUOTE_KEYS,
  SOCIAL_KEYS,
  cloneDiscoverFilters,
  emptyDiscoverFilters,
  emptyRowFilter,
  type DiscoverFilters,
  type DiscoverSectionId,
  type FilterMetric,
  type KeywordKind,
  type ModeKey,
  type ModeRule,
  type ProtocolKey,
  type QuoteKey,
  type RangeBound,
  type SocialKey,
} from '@/components/discover/discoverFilters';

/** Legacy pre-per-user key (ranges only) — read once as a migration source. */
const LEGACY_FILTERS_STORAGE_KEY = 'discover:filters:v1';
const FILTERS_STORAGE_KEY = 'discover:filters:v2';

/** Filters are a per-user preference — same keying convention as
 *  `discover:tracked-wallets` (`:<clerk userId>` with an `anon` bucket). */
function filtersStorageKey(owner: string | null): string {
  return `${FILTERS_STORAGE_KEY}:${owner ?? 'anon'}`;
}

/** Card density preset (rows mode). Drives `--card-zoom` on each card slot. */
export type CardSize = 'compact' | 'default' | 'large' | 'fill';

/** Layout orientation: stacked horizontal carousels (rows) or side-by-side
 *  vertical columns that scroll internally (columns). */
export type LayoutMode = 'rows' | 'columns';

/** Stable section identity. The whole layout engine keys off these (sizes,
 *  visibility, ordering) so hide/show/reorder never corrupts saved state. */
export type SectionId = 'alpha' | 'new-pairs' | 'almost-graduated' | 'graduated';

export const SECTION_ORDER: readonly SectionId[] = [
  'alpha',
  'new-pairs',
  'almost-graduated',
  'graduated',
];

/** Non-Alpha sections that may receive an auto second row. */
export const SECOND_ROW_TARGETS: readonly SectionId[] = [
  'new-pairs',
  'almost-graduated',
  'graduated',
];

/** Max card-rows (tracks) across non-Alpha sections, plus Alpha. */
export const MAX_NON_ALPHA_TRACKS = 4;

/**
 * The single source of truth for the Discover layout. Persisted as one
 * versioned object; sizes are keyed by section id (NOT array index) so
 * hiding/showing/reordering a section never shifts another's saved weight.
 */
export interface DiscoverLayout {
  mode: LayoutMode;
  cardSize: CardSize;
  visible: Record<SectionId, boolean>;
  /** Grant a 2nd row to `secondRowTarget` when there's vertical room for it. */
  autoSecondRow: boolean;
  secondRowTarget: SectionId;
  order: SectionId[];
  /** Resize weights per mode, by section id (flex panels only). */
  sizes: Record<LayoutMode, Partial<Record<SectionId, number>>>;
}

const LAYOUT_KEY = 'discover:layout:v2';
const CARD_SIZES: readonly CardSize[] = ['compact', 'default', 'large', 'fill'];

function defaultLayout(): DiscoverLayout {
  return {
    /*
     * 'columns'.
     *
     * This was flipped to 'rows' while column mode laid out NOTHING:
     * `resolveLayout` was returning an empty panel list for it during the
     * rebuild, so any profile without a saved `discover:layout:v2` opened
     * /discover to a blank board with no error to explain it.
     *
     * That is over. `resolveLayout` resolves its panels again and each
     * one renders `ColumnShell`, so columns is the board again and is the
     * default again.
     *
     * NOTE for anyone who does not see the change: this is the value used
     * when there is NO saved layout. A browser that already stored
     * `discover:layout:v2` while the default was 'rows' keeps rows until
     * the mode is switched in the sub header or that key is cleared.
     */
    mode: 'columns',
    cardSize: 'default',
    visible: {
      alpha: false,
      'new-pairs': true,
      'almost-graduated': true,
      graduated: true,
    },
    autoSecondRow: true,
    secondRowTarget: 'new-pairs',
    order: [...SECTION_ORDER],
    sizes: { rows: {}, columns: {} },
  };
}

function sanitize(raw: Partial<DiscoverLayout>, base: DiscoverLayout): DiscoverLayout {
  const cardSize = CARD_SIZES.includes(raw.cardSize as CardSize)
    ? (raw.cardSize as CardSize)
    : base.cardSize;
  const secondRowTarget = SECOND_ROW_TARGETS.includes(raw.secondRowTarget as SectionId)
    ? (raw.secondRowTarget as SectionId)
    : base.secondRowTarget;
  return {
    mode: raw.mode === 'columns' || raw.mode === 'rows' ? raw.mode : base.mode,
    cardSize,
    visible: { ...base.visible, ...(raw.visible ?? {}) },
    autoSecondRow: typeof raw.autoSecondRow === 'boolean' ? raw.autoSecondRow : base.autoSecondRow,
    secondRowTarget,
    order: [...SECTION_ORDER],
    sizes: {
      rows: { ...(raw.sizes?.rows ?? {}) },
      columns: { ...(raw.sizes?.columns ?? {}) },
    },
  };
}

/** Reads the persisted layout. Returns defaults on the server / parse failure
 *  so SSR and the first client render agree (hydrated client-side post-mount). */
export function readLayout(): DiscoverLayout {
  const base = defaultLayout();
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return base;
    return sanitize(JSON.parse(raw) as Partial<DiscoverLayout>, base);
  } catch {
    return base;
  }
}

function writeLayout(layout: DiscoverLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Local preference only.
  }
}

interface DiscoverState {
  showMayhem: boolean;
  newPairsPaused: boolean;
  layout: DiscoverLayout;
  /** Per-row metric filters (market cap / age / volume min-max). */
  filters: DiscoverFilters;
  setShowMayhem: (show: boolean) => void;
  setNewPairsPaused: (paused: boolean) => void;
  /** Replace the layout from persisted storage (client-side, post-mount). */
  hydrateLayout: () => void;
  /** Merge a top-level patch (mode, cardSize, autoSecondRow, secondRowTarget). */
  patchLayout: (patch: Partial<DiscoverLayout>) => void;
  setSectionVisible: (id: SectionId, visible: boolean) => void;
  setSizes: (mode: LayoutMode, sizes: Partial<Record<SectionId, number>>) => void;
  /** Reset only the dragged panel sizes. */
  resetSizes: () => void;
  /** Reset the entire layout to defaults. */
  resetLayoutAll: () => void;
  /** Clerk user id the loaded filters belong to (null = anon bucket). */
  filtersOwner: string | null;
  /** Replace the entire filter set (used to hydrate from localStorage). */
  setFilters: (filters: DiscoverFilters, owner: string | null) => void;
  /** Set a single bound; persists to localStorage. */
  setFilterBound: (
    section: DiscoverSectionId,
    metric: FilterMetric,
    bound: RangeBound,
    value: number | null,
  ) => void;
  /** Replace one section's include/exclude keyword list; persists. */
  setFilterKeywords: (
    section: DiscoverSectionId,
    kind: KeywordKind,
    keywords: string[],
  ) => void;
  /** Toggle one social requirement; persists. */
  setFilterSocial: (section: DiscoverSectionId, key: SocialKey, on: boolean) => void;
  /** Toggle one pair quote; persists. */
  setFilterQuote: (section: DiscoverSectionId, key: QuoteKey, on: boolean) => void;
  /** Set one launch mode to hide / show / only; persists. */
  setFilterMode: (section: DiscoverSectionId, key: ModeKey, rule: ModeRule) => void;
  /** Toggle one launchpad; persists. */
  setFilterProtocol: (section: DiscoverSectionId, key: ProtocolKey, on: boolean) => void;
  /** Turn every launchpad on or off at once; persists. */
  setAllFilterProtocols: (section: DiscoverSectionId, on: boolean) => void;
  /** Clear all criteria for one section; persists to localStorage. */
  clearSectionFilter: (section: DiscoverSectionId) => void;
}

export const useDiscoverStore = create<DiscoverState>((set, get) => {
  const commit = (layout: DiscoverLayout) => {
    writeLayout(layout);
    set({ layout });
  };
  return {
    showMayhem: false,
    newPairsPaused: false,
    layout: defaultLayout(),
    // Default to empty so the server and the client's first (hydration)
    // render agree; DiscoverPage hydrates the persisted values in a layout
    // effect (same pattern as the layout).
    filters: emptyDiscoverFilters(),
    filtersOwner: null,
    setShowMayhem: (show) => set({ showMayhem: show }),
    setNewPairsPaused: (paused) => set({ newPairsPaused: paused }),
    hydrateLayout: () => set({ layout: readLayout() }),
    patchLayout: (patch) => commit({ ...get().layout, ...patch }),
    setSectionVisible: (id, visible) =>
      commit({
        ...get().layout,
        visible: { ...get().layout.visible, [id]: visible },
      }),
    setSizes: (mode, sizes) =>
      commit({ ...get().layout, sizes: { ...get().layout.sizes, [mode]: sizes } }),
    resetSizes: () => commit({ ...get().layout, sizes: { rows: {}, columns: {} } }),
    resetLayoutAll: () => commit(defaultLayout()),
    setFilters: (filters, owner) => set({ filters, filtersOwner: owner }),
    setFilterBound: (section, metric, bound, value) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section][metric][bound] = value;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setFilterKeywords: (section, kind, keywords) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section][kind] = keywords;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setFilterSocial: (section, key, on) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section].socials[key] = on;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setFilterQuote: (section, key, on) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section].quotes[key] = on;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setFilterMode: (section, key, rule) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section].modes[key] = rule;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setFilterProtocol: (section, key, on) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section].protocols[key] = on;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    setAllFilterProtocols: (section, on) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        for (const key of PROTOCOL_KEYS) next[section].protocols[key] = on;
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
    clearSectionFilter: (section) =>
      set((state) => {
        const next = cloneDiscoverFilters(state.filters);
        next[section] = emptyRowFilter();
        writeFilters(next, state.filtersOwner);
        return { filters: next };
      }),
  };
});

/**
 * Read the owner's persisted filters; returns empty defaults off-client or
 * on any error. Falls back to the legacy global v1 payload (ranges only)
 * when the per-user v2 key has never been written — the sanitizer accepts
 * both shapes, so a pre-per-user filter set carries over on first load.
 */
export function readDiscoverFilters(owner: string | null): DiscoverFilters {
  if (typeof window === 'undefined') return emptyDiscoverFilters();
  try {
    const raw =
      window.localStorage.getItem(filtersStorageKey(owner)) ??
      window.localStorage.getItem(LEGACY_FILTERS_STORAGE_KEY);
    if (!raw) return emptyDiscoverFilters();
    return mergePersistedFilters(JSON.parse(raw));
  } catch {
    return emptyDiscoverFilters();
  }
}

function writeFilters(filters: DiscoverFilters, owner: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(filtersStorageKey(owner), JSON.stringify(filters));
  } catch {
    // Local preference only; ignore quota/availability errors.
  }
}

/**
 * Coerce an untrusted parsed payload into a well-formed `DiscoverFilters`,
 * keeping only finite, non-negative numeric bounds, length-capped string
 * keywords, and boolean socials. Guarantees every section/metric/bound
 * exists so downstream readers never hit `undefined`.
 */
function mergePersistedFilters(parsed: unknown): DiscoverFilters {
  const base = emptyDiscoverFilters();
  if (!parsed || typeof parsed !== 'object') return base;
  const root = parsed as Record<string, unknown>;
  for (const section of Object.keys(base) as DiscoverSectionId[]) {
    const sectionRaw = root[section];
    if (!sectionRaw || typeof sectionRaw !== 'object') continue;
    const sectionObj = sectionRaw as Record<string, unknown>;
    for (const metric of FILTER_METRICS) {
      const rangeRaw = sectionObj[metric];
      if (!rangeRaw || typeof rangeRaw !== 'object') continue;
      const rangeObj = rangeRaw as Record<string, unknown>;
      base[section][metric] = {
        min: sanitizeBound(rangeObj.min),
        max: sanitizeBound(rangeObj.max),
      };
    }
    base[section].include = sanitizeKeywords(sectionObj.include);
    base[section].exclude = sanitizeKeywords(sectionObj.exclude);
    const socialsRaw = sectionObj.socials;
    if (socialsRaw && typeof socialsRaw === 'object') {
      const socialsObj = socialsRaw as Record<string, unknown>;
      for (const key of SOCIAL_KEYS) {
        base[section].socials[key] = socialsObj[key] === true;
      }
    }
    // Absent on every payload written before quotes and modes existed, so
    // a missing block keeps the defaults rather than clearing the board.
    const quotesRaw = sectionObj.quotes;
    if (quotesRaw && typeof quotesRaw === 'object') {
      const quotesObj = quotesRaw as Record<string, unknown>;
      for (const key of QUOTE_KEYS) {
        if (typeof quotesObj[key] === 'boolean') base[section].quotes[key] = quotesObj[key] as boolean;
      }
    }
    const modesRaw = sectionObj.modes;
    if (modesRaw && typeof modesRaw === 'object') {
      const modesObj = modesRaw as Record<string, unknown>;
      for (const key of MODE_KEYS) {
        const rule = modesObj[key];
        if (rule === 'hide' || rule === 'show' || rule === 'only') base[section].modes[key] = rule;
      }
    }
    const protocolsRaw = sectionObj.protocols;
    if (protocolsRaw && typeof protocolsRaw === 'object') {
      const protocolsObj = protocolsRaw as Record<string, unknown>;
      for (const key of PROTOCOL_KEYS) {
        if (typeof protocolsObj[key] === 'boolean') {
          base[section].protocols[key] = protocolsObj[key] as boolean;
        }
      }
    }
  }
  return base;
}

function sanitizeBound(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const keyword = entry.trim().toLowerCase().slice(0, MAX_KEYWORD_LENGTH);
    if (keyword.length === 0 || out.includes(keyword)) continue;
    out.push(keyword);
    if (out.length >= MAX_FILTER_KEYWORDS) break;
  }
  return out;
}
