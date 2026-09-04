import { create } from 'zustand';
import type { CandleResolution } from '@/components/trade/types';
import type { ChartTimeframe } from '@/components/trade/timeframes';

export type TradeSide = 'Buy' | 'Sell';

/**
 * Send-path selector carried per preset side. Mirrors the order-intent
 * `send_mode` enum the api/ accepts (`api/src/routes/trade/orders.ts`)
 * and the api/-side `SEND_MODES` in
 * `api/src/db/queries/user-trading-settings.ts` — both sides MUST stay
 * in sync. `'auto'` preserves the engine-picks-the-path behaviour.
 */
export const SEND_MODES = ['auto', 'rpc', 'jito', 'zeroslot', 'nozomi', 'nonceSpray'] as const;
export type SendMode = (typeof SEND_MODES)[number];

/**
 * Discover sections that own a quick-buy amount slot. Mirrors
 * `QUICK_BUY_SECTION_IDS` in the api/ (`api/src/db/queries/user-trading-settings.ts`)
 * — both sides MUST stay in sync so the server schema accepts the
 * exact keys the Terminal sends. Kebab-case to match the JSONB column
 * the server merges into.
 */
export const QUICK_BUY_SECTION_IDS = [
  'alpha',
  'new-pairs',
  'almost-graduated',
  'graduated',
] as const;

export type QuickBuySectionId = (typeof QUICK_BUY_SECTION_IDS)[number];

export type QuickBuyAmountsBySection = Record<QuickBuySectionId, number | null>;

/**
 * Trading presets — global per-Clerk-user fee config that applies to
 * every trade (QuickBuy, Instant Trade, manual Buy/Sell). Three
 * independently editable presets, each with separate Buy and Sell
 * fee blocks. The mirror of `TradePresetsBlock` in
 * `api/src/db/queries/user-trading-settings.ts` (wire types must stay
 * in sync — bounds, field names, key order).
 */
export type TradePresetSide = {
  slippage_bps: number;
  priority_lamports: number;
  bribe_lamports: number;
  send_mode: SendMode;
};

/** Preset-side fields edited through the numeric `setPresetField` path
 *  (send_mode has its own dedicated setter). */
export type TradePresetNumericField = Exclude<keyof TradePresetSide, 'send_mode'>;

export type TradePreset = {
  buy: TradePresetSide;
  sell: TradePresetSide;
};

export type TradePresetSideKey = 'buy' | 'sell';
export type TradePresetIndex = 0 | 1 | 2;

/**
 * Per-section override of which preset is "active" for that Discover
 * section's QuickBuy clicks. Each entry is independent — alpha can
 * pin Preset 1 while almost-graduated pins Preset 2. Sections absent
 * from this map fall back to the top-level `active_index`, which
 * remains the GLOBAL default consumed by the non-section trade
 * surfaces (TradePanel + InstantTradeBox) and by the Trading Settings
 * modal's preset-edit tabs.
 */
export type ActivePresetBySection = Partial<Record<QuickBuySectionId, TradePresetIndex>>;

export type TradePresetsState = {
  active_index: TradePresetIndex;
  active_by_section: ActivePresetBySection;
  presets: [TradePreset, TradePreset, TradePreset];
};

/* Bounds + defaults mirrored from
   `api/src/db/queries/user-trading-settings.ts`. Both sides MUST stay
   in sync; the server is the authoritative validator. */
export const TRADE_PRESETS_COUNT = 3;
export const SLIPPAGE_BPS_MIN = 1;
export const SLIPPAGE_BPS_MAX = 10_000;
export const PRIORITY_LAMPORTS_MIN = 0;
export const PRIORITY_LAMPORTS_MAX = 10_000_000_000;
export const BRIBE_LAMPORTS_MIN = 0;
export const BRIBE_LAMPORTS_MAX = 10_000_000_000;

/**
 * Out-of-the-box preset values applied when a user has never
 * customised a side. Aligned with the trading engine's
 * compiled-in defaults so a brand-new user pays exactly what
 * the bot path was paying before the per-trade UI knobs existed:
 *
 *   - `priority_lamports = 100_000` matches the BC compose route's
 *     `COMPUTE_PRICE_DEFAULT × COMPUTE_LIMIT_DEFAULT = 400_000 × 250_000`
 *     = 100_000_000_000 µLamports = 100_000 lamports total. The AMM
 *     route's compiled default rounds to 100_100 lamports (286_000 ×
 *     350_000); the 100-lamport delta is negligible.
 *   - `bribe_lamports = 1_000_000` matches the env-fallback constants
 *     `JITO_TIP_LAMPORTS_DEFAULT`, `ZEROSLOT_TIP_LAMPORTS_DEFAULT`,
 *     and `NOZOMI_TIP_LAMPORTS_DEFAULT` in `trading/src/send/dispatcher.ts`.
 *
 * Any user who explicitly bumped these via the Trading Settings
 * modal continues to use their saved values; this default only
 * affects new users / fresh installs.
 */
export const DEFAULT_PRESET_SIDE: TradePresetSide = {
  slippage_bps: 1500,
  priority_lamports: 100_000,
  bribe_lamports: 1_000_000,
  send_mode: 'auto',
};

function clonePresetSide(): TradePresetSide {
  return { ...DEFAULT_PRESET_SIDE };
}

function clonePreset(): TradePreset {
  return { buy: clonePresetSide(), sell: clonePresetSide() };
}

export function defaultTradePresets(): TradePresetsState {
  return {
    active_index: 0,
    active_by_section: {},
    presets: [clonePreset(), clonePreset(), clonePreset()],
  };
}

/**
 * Resolves which preset index applies to a given Discover section.
 * Used by `<CoinCard>`'s quickbuy path and by the QuickBuyPanel's
 * P-button active state. Per-section override beats the global
 * default; defensive against malformed cached values via the
 * coerce-bounds check.
 */
export function selectActivePresetForSection(
  state: TradePresetsState,
  sectionId: QuickBuySectionId,
): TradePresetIndex {
  const override = state.active_by_section[sectionId];
  if (
    typeof override === 'number' &&
    Number.isInteger(override) &&
    override >= 0 &&
    override < TRADE_PRESETS_COUNT
  ) {
    return override as TradePresetIndex;
  }
  return state.active_index;
}

interface TradeState {
  chartInterval: ChartTimeframe;
  side: TradeSide;
  buyAmount: string;
  sellAmount: string;
  selectedSellPct: number | null;
  slippageBps: number;
  /**
   * Per-section Quickbuy amounts in SOL.
   *
   * Every section starts at `null` (= unset). A `null` amount means
   * the corresponding `<CoinCard>` quickbuy button is a no-op on
   * click and the hover state renders only the lightning glyph —
   * never falls back to a default. Server-persisted per Clerk user
   * via `settings.user_trading_settings.quick_buy_lamports`; hydrated
   * once per signed-in session by `useHydrateQuickBuyAmounts()`.
   *
   * Stored in SOL (not lamports) so the existing UI surfaces
   * (panel input, hover render) stay in their native unit; the
   * conversion to lamports happens at API-mutation time
   * (`Math.round(sol * 1e9)`).
   */
  quickBuyAmountsBySection: QuickBuyAmountsBySection;
  setChartInterval: (interval: ChartTimeframe) => void;
  setSide: (side: TradeSide) => void;
  setBuyAmount: (amount: string) => void;
  setSellAmount: (amount: string) => void;
  setSelectedSellPct: (pct: number | null) => void;
  setSlippageBps: (bps: number) => void;
  /**
   * Set the quick-buy amount for a section. `null` clears it.
   * Finite numbers are clamped to [QUICK_BUY_MIN_SOL,
   * QUICK_BUY_MAX_SOL]; non-finite numbers are coerced to `null`
   * (the user typed garbage; treat as "no amount").
   */
  setQuickBuyAmountSol: (sectionId: QuickBuySectionId, value: number | null) => void;
  /**
   * Replace the entire per-section map at once. Used by the
   * server-hydration hook on app boot / Clerk user change. Skips
   * the per-key clamping path because the server already enforced
   * the same bounds.
   */
  hydrateQuickBuyAmounts: (next: QuickBuyAmountsBySection) => void;
  /**
   * Global trading presets — 3 user-editable slots + an `active_index`
   * pointer. The active preset's `buy` config applies to every buy
   * trade; the active `sell` config applies to every sell. Server-
   * persisted per Clerk user via
   * `settings.user_trading_settings.trade_presets`; hydrated by
   * `useHydrateUserSettings()` and instant-rendered from a
   * `localStorage` cache via `readInitialTradePresets()`.
   */
  tradePresets: TradePresetsState;
  /**
   * Set the GLOBAL active preset pointer. Used by the Trading
   * Settings modal's preset-edit tabs and by trade surfaces that
   * aren't tied to a Discover section (TradePanel / InstantTradeBox).
   * Sections with their own `active_by_section` override are
   * unaffected.
   */
  setActivePreset: (idx: TradePresetIndex) => void;
  /**
   * Set the per-section active preset override. Each Discover
   * section independently pins which preset its QuickBuy clicks
   * should use. Passing `null` clears the override (the section
   * falls back to the global `active_index`).
   */
  setActivePresetForSection: (
    sectionId: QuickBuySectionId,
    idx: TradePresetIndex | null,
  ) => void;
  /**
   * Mutate a single field of a single preset's buy or sell side.
   * Value is clamped to that field's documented bounds; an
   * out-of-range value is silently coerced to the bound rather than
   * rejected, so a slider that pushes past 10_000 bps still renders
   * 10_000 instead of snapping back to the prior value.
   */
  setPresetField: (
    idx: TradePresetIndex,
    side: TradePresetSideKey,
    field: TradePresetNumericField,
    value: number,
  ) => void;
  /**
   * Set the send-path selector for a single preset's buy or sell side.
   * Unknown values collapse to 'auto' (same coerce rule as the
   * normalizer), so a stale cached string can never reach the wire.
   */
  setPresetSendMode: (
    idx: TradePresetIndex,
    side: TradePresetSideKey,
    mode: SendMode,
  ) => void;
  /**
   * Replace the entire `tradePresets` slice. Used by the
   * server-hydration hook. The new value is normalized defensively
   * before assignment so a corrupted server response can't poison
   * the store.
   */
  hydrateTradePresets: (next: TradePresetsState) => void;
  /**
   * The agent plane's knob defaults. `null` until the user configures
   * them; read it through `selectAgentPresetView` to get the values the
   * editor should show (which fall back to Preset 1).
   */
  agentPreset: AgentPresetState;
  /**
   * Commit one agent-preset field. When nothing is configured yet this
   * SEEDS from Preset 1 first, so the block the user persists is "P1 with
   * my one edit" rather than a block of zeroes around a single number.
   */
  setAgentPresetField: (
    side: TradePresetSideKey,
    field: AgentPresetField,
    value: number,
  ) => void;
  /** Send path for one agent side. Unknown values collapse to 'auto'. */
  setAgentPresetSendMode: (side: TradePresetSideKey, mode: SendMode) => void;
  /** The "reset to Preset 1" affordance — re-seeds BOTH sides from Preset 1. */
  resetAgentPresetFromP1: () => void;
  /** Replace the slice wholesale. Used by the server-hydration hook. */
  hydrateAgentPreset: (next: AgentPresetState) => void;
  /**
   * Editable TradePanel quick-amount chips (4 Buy SOL amounts + 4 Sell
   * percentages). Server-persisted per Clerk user via
   * `settings.user_trading_settings.quick_chips`; hydrated by
   * `useHydrateUserSettings()` and instant-rendered from a `localStorage`
   * cache via `readInitialQuickChips()`.
   */
  quickChips: QuickChipsState;
  /**
   * Replace the entire quick-chips block (the editor edits one side at a
   * time and passes the merged block). Normalized defensively before
   * assignment.
   */
  setQuickChips: (next: QuickChipsState) => void;
  /** Replace the quick-chips slice from a server / cache hydration. */
  hydrateQuickChips: (next: QuickChipsState) => void;
  /**
   * Active Sell quick-chip unit. `pct` = the chips are percentages of
   * holdings; `sol` = the chips are SOL amounts ("sell N SOL worth"). UI
   * preference only; persisted to localStorage, not the server.
   */
  sellChipMode: SellChipMode;
  setSellChipMode: (mode: SellChipMode) => void;
  /**
   * USDC pair support: global trade mode (SOL | USDC) + USDC buy
   * presets. Server-persisted per Clerk user via
   * `settings.user_trading_settings.usdc_trade`; hydrated by
   * `useHydrateUserSettings()` and instant-rendered from a localStorage
   * cache via `readInitialUsdcTrade()`. The effective spend currency
   * per pair resolves through `lib/trade/spend-currency.ts`.
   */
  usdcTrade: UsdcTradeState;
  /**
   * Flip the global trade mode. Local store write only; the caller
   * (QuoteModeToggle) enqueues the debounced wholesale `usdc_trade`
   * PATCH, mirroring how preset toggles persist.
   */
  setTradeQuoteMode: (mode: TradeQuoteMode) => void;
  /**
   * Replace the 5 USDC quick-buy chip amounts (micro-USDC). Local
   * store write only; the caller (QuickChipsEditor in USDC mode)
   * enqueues the debounced wholesale `usdc_trade` PATCH.
   */
  setUsdcQuickBuyMicro: (values: number[]) => void;
  /** Replace the usdc-trade slice from a server / cache hydration. */
  hydrateUsdcTrade: (next: UsdcTradeState) => void;
}

/** Lamports for any SOL amount the store carries. Centralised so the
 *  conversion is consistent across every Quickbuy / order intake site. */
export function quickBuyLamports(sol: number): string {
  if (!Number.isFinite(sol) || sol <= 0) return '0';
  return String(Math.round(sol * 1_000_000_000));
}

export const QUICK_BUY_MIN_SOL = 0.0001;
export const QUICK_BUY_MAX_SOL = 100;

/* localStorage keys for synchronous module-load hydration. Kept in
   sync with the `terminal:settings:` prefix used by
   `lib/storage/local-settings.ts` — both writers and the
   module-load reader must agree on the exact key shape or the
   "instant first paint" path silently degrades to empty. */
export const QUICK_BUY_LAST_USER_ID_KEY = 'terminal:settings:last-user-id';
export const QUICK_BUY_LOCAL_KEY_PREFIX = 'terminal:settings:quickbuy:';
/* Mirrors the quickbuy convention but keys the per-user
   `tradePresets` cache. Same `last-user-id` pointer is reused — both
   slices belong to the same Clerk user, so one pointer is sufficient. */
export const TRADE_PRESETS_LOCAL_KEY_PREFIX = 'terminal:settings:trade-presets:';
/* Same convention again for the agent preset. Separate key rather than a
   field inside the trade-presets blob: the two are written by different
   PATCH branches and a shared blob would make a stale cache of one able to
   clobber the other. */
export const AGENT_PRESET_LOCAL_KEY_PREFIX = 'terminal:settings:agent-preset:';

function emptyQuickBuyAmounts(): QuickBuyAmountsBySection {
  const out: Partial<QuickBuyAmountsBySection> = {};
  for (const id of QUICK_BUY_SECTION_IDS) out[id] = null;
  return out as QuickBuyAmountsBySection;
}

/**
 * Synchronous, module-load-time read of the last-known per-section
 * quick-buy map from `localStorage`. Runs ONCE when the JS bundle
 * parses this module (before React mounts), so the zustand store's
 * initial state already carries the cached values and the very first
 * render paints the right numbers — no "0.0 flash → 5" on refresh.
 *
 * Why a `last-user-id` indirection instead of reading a single fixed
 * key:
 *
 *  - Quick-buy amounts are per Clerk user. The hook layer
 *    (`useHydrateQuickBuyAmounts`) writes the active user id to
 *    `last-user-id` on Clerk-ready so the NEXT session can read it
 *    back synchronously, before Clerk has loaded (which takes
 *    100-300 ms — the very latency we're trying to hide).
 *  - When a different user signs in on the same browser, the
 *    module-load read briefly returns the prior user's values; the
 *    hook layer detects the userId mismatch on Clerk-load and
 *    re-hydrates from the new user's cache (or clears if absent).
 *    That's the only flash window in this design, and only on
 *    cross-user reloads.
 *
 * Defensive: every shape error / parse error / out-of-bounds value
 * collapses silently to empty. The cache is an optimization, never
 * load-bearing; the server is always the source of truth and the
 * eventual server hydration reconciles anyway.
 */
export function readInitialQuickBuyAmounts(): QuickBuyAmountsBySection {
  /* SSR guard: trade-store.ts may be imported during Next.js server
     rendering (the file itself isn't 'use client', and consumers
     might transitively pull it in). `window` is undefined there;
     return the empty default so SSR HTML matches what the client
     would render before localStorage is consulted. */
  if (typeof window === 'undefined') return emptyQuickBuyAmounts();
  try {
    const lastUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    if (!lastUserId) return emptyQuickBuyAmounts();
    const raw = window.localStorage.getItem(
      QUICK_BUY_LOCAL_KEY_PREFIX + lastUserId,
    );
    if (raw === null) return emptyQuickBuyAmounts();
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return emptyQuickBuyAmounts();
    }
    const obj = parsed as Record<string, unknown>;
    const out = emptyQuickBuyAmounts();
    for (const id of QUICK_BUY_SECTION_IDS) {
      const v = obj[id];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < QUICK_BUY_MIN_SOL || v > QUICK_BUY_MAX_SOL) continue;
      out[id] = v;
    }
    return out;
  } catch {
    /* Privacy mode, malformed JSON, disabled storage — soft-fail. */
    return emptyQuickBuyAmounts();
  }
}

/**
 * "Coerce" semantics: anything not strictly a finite integer in
 * `[min, max]` collapses to `fallback`. Used by the NORMALIZER paths
 * (cache reads, server responses, hydrate) so a corrupted upstream
 * value falls back to the per-field default rather than getting
 * clamped to the boundary. Mirrors `coerceIntInRange` on the api/
 * side.
 */
function coerceIntInRange(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return fallback;
  if (v < min || v > max) return fallback;
  return v;
}

/**
 * "Clamp" semantics: out-of-bounds values snap to the nearest bound
 * rather than fall to the field default. Used by `setPresetField` so
 * a slider drag or fast keyboard increment past the bound stops at
 * the bound (predictable UX) instead of yanking the value back to the
 * default. Non-numeric / NaN / Infinity still collapse to the
 * fallback because those represent typing garbage that has no
 * sensible clamp target.
 */
function clampIntInRange(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function coerceSendMode(v: unknown): SendMode {
  return (SEND_MODES as readonly unknown[]).includes(v) ? (v as SendMode) : 'auto';
}

function normalizePresetSide(raw: unknown): TradePresetSide {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PRESET_SIDE };
  }
  const obj = raw as Record<string, unknown>;
  return {
    slippage_bps: coerceIntInRange(
      obj['slippage_bps'],
      SLIPPAGE_BPS_MIN,
      SLIPPAGE_BPS_MAX,
      DEFAULT_PRESET_SIDE.slippage_bps,
    ),
    priority_lamports: coerceIntInRange(
      obj['priority_lamports'],
      PRIORITY_LAMPORTS_MIN,
      PRIORITY_LAMPORTS_MAX,
      DEFAULT_PRESET_SIDE.priority_lamports,
    ),
    bribe_lamports: coerceIntInRange(
      obj['bribe_lamports'],
      BRIBE_LAMPORTS_MIN,
      BRIBE_LAMPORTS_MAX,
      DEFAULT_PRESET_SIDE.bribe_lamports,
    ),
    /* Absent on pre-send-mode caches / server rows — collapses to
       'auto', preserving prior behaviour. */
    send_mode: coerceSendMode(obj['send_mode']),
  };
}

function normalizePreset(raw: unknown): TradePreset {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return clonePreset();
  }
  const obj = raw as Record<string, unknown>;
  return { buy: normalizePresetSide(obj['buy']), sell: normalizePresetSide(obj['sell']) };
}

/**
 * Defensive normalizer for any `tradePresets`-shaped input — applied
 * to localStorage reads, server responses, and direct callers of
 * `hydrateTradePresets`. Mirrors the api/-side `normalizeTradePresets`
 * exactly; both sides MUST stay in sync (bounds, key order, field set)
 * or the round-trip can silently mutate values.
 */
function normalizeActiveBySection(raw: unknown): ActivePresetBySection {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: ActivePresetBySection = {};
  for (const id of QUICK_BUY_SECTION_IDS) {
    const v = obj[id];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) continue;
    if (v < 0 || v > TRADE_PRESETS_COUNT - 1) continue;
    out[id] = v as TradePresetIndex;
  }
  return out;
}

export function normalizeTradePresets(raw: unknown): TradePresetsState {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultTradePresets();
  }
  const obj = raw as Record<string, unknown>;
  const activeIndex = coerceIntInRange(
    obj['active_index'],
    0,
    TRADE_PRESETS_COUNT - 1,
    0,
  ) as TradePresetIndex;
  const activeBySection = normalizeActiveBySection(obj['active_by_section']);
  const presetsRaw = Array.isArray(obj['presets']) ? (obj['presets'] as unknown[]) : [];
  const presets: [TradePreset, TradePreset, TradePreset] = [
    normalizePreset(presetsRaw[0]),
    normalizePreset(presetsRaw[1]),
    normalizePreset(presetsRaw[2]),
  ];
  return { active_index: activeIndex, active_by_section: activeBySection, presets };
}

/**
 * Synchronous, module-load-time read of the last-known trading
 * presets from `localStorage`. Mirrors `readInitialQuickBuyAmounts`
 * exactly — same SSR guard, same `last-user-id` pointer, same
 * defensive collapse-to-defaults on any error. See that function for
 * the full rationale; this one only differs in WHICH JSONB column it
 * mirrors.
 */
export function readInitialTradePresets(): TradePresetsState {
  if (typeof window === 'undefined') return defaultTradePresets();
  try {
    const lastUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    if (!lastUserId) return defaultTradePresets();
    const raw = window.localStorage.getItem(
      TRADE_PRESETS_LOCAL_KEY_PREFIX + lastUserId,
    );
    if (raw === null) return defaultTradePresets();
    const parsed: unknown = JSON.parse(raw);
    return normalizeTradePresets(parsed);
  } catch {
    return defaultTradePresets();
  }
}

/* ── Agent preset (the agent plane's knob defaults) ──────────────────────
   The slippage / priority / bribe the AGENT compiles conditionals with.
   Same three numeric fields as a preset side, same units, same bounds;
   `send_mode` is absent because the agent plane cannot clamp a string and
   keeps the send path as operator posture.

   NULL IS A REAL STATE and the whole feature depends on it: it means "the
   user has never configured agent settings", for which the api sends no
   block and the agent compiler resolves at unchanged platform posture. The
   editor SHOWS Preset 1's values in that state (that is the "defaults from
   P1" rule) but does not persist them until the user acts — so merely
   opening the modal cannot change how anyone's conditionals compile. */

/** One side of the agent preset — identical to a manual preset side,
 *  send_mode included. */
export type AgentPresetSide = TradePresetSide;

export type AgentPresetFields = {
  buy: AgentPresetSide;
  sell: AgentPresetSide;
};

/** `null` = never configured. See the block comment above. */
export type AgentPresetState = AgentPresetFields | null;

/** The numeric fields the agent-preset editor commits. */
export type AgentPresetField = TradePresetNumericField;

/**
 * The "defaults from P1" rule, as a function. Mirrors `agentPresetFromSide`
 * in `api/src/db/queries/user-trading-settings.ts`.
 */
export function agentPresetFromPreset(preset: TradePreset): AgentPresetFields {
  return { buy: { ...preset.buy }, sell: { ...preset.sell } };
}

/**
 * Defensive normalizer for any agent-preset-shaped input (cache reads,
 * server responses). Mirrors the api-side `normalizeAgentPreset`: a
 * non-object collapses to `null` (never configured) rather than to a
 * default block, because those two states are not interchangeable here.
 */
export function normalizeAgentPreset(raw: unknown): AgentPresetState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  /* Reuses the preset-side normalizer, so the agent block can never drift
     from the bounds and send-mode vocabulary manual presets are held to. */
  return { buy: normalizePresetSide(obj['buy']), sell: normalizePresetSide(obj['sell']) };
}

/**
 * Synchronous, module-load-time read of the last-known agent preset.
 * Mirrors `readInitialTradePresets` exactly; see that function for the
 * full rationale. Collapses to `null` on any error, which is the safe
 * direction — an unreadable cache must not invent a configured block.
 */
export function readInitialAgentPreset(): AgentPresetState {
  if (typeof window === 'undefined') return null;
  try {
    const lastUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    if (!lastUserId) return null;
    const raw = window.localStorage.getItem(AGENT_PRESET_LOCAL_KEY_PREFIX + lastUserId);
    if (raw === null) return null;
    return normalizeAgentPreset(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * What the agent-preset editor should DISPLAY: the configured block, or
 * Preset 1's buy side when nothing is configured yet.
 *
 * NOT a zustand selector. It ALLOCATES on the unconfigured path, and
 * `useTradeStore` compares snapshots with `Object.is`, so subscribing
 * through this is an infinite render loop. React callers select the two
 * stored references and derive with `useMemo` (see TradingSettingsModal).
 */
export function selectAgentPresetView(state: TradeState): AgentPresetFields {
  return state.agentPreset ?? agentPresetFromPreset(state.tradePresets.presets[0]);
}

/* ── Quick chips (editable TradePanel quick-amount buttons) ──────────────
   The eight Buy amounts (SOL) and eight Sell percentages rendered in the
   TradePanel / InstantTradeBox quick-amount chip rows (row 1 = chips 1-4,
   row 2 = chips 5-8, revealed when the panel is tall enough). Global per
   Clerk user, persisted as one wholesale block (mirrors `tradePresets`).
   Buy is held in SOL here; the conversion to lamports happens at the
   API-mutation boundary, same as `quickBuyAmountsBySection`. Sell is an
   integer percentage. */
/* FOUR. It was 8 — a first row of four and an overflow row revealed only
   when the panel was tall enough — so the pencil offered eight fields to
   edit when the box was showing four chips, and half of what you typed
   went somewhere you could not see. One row, four amounts, and the
   editor and the panel agree. */
export const QUICK_CHIPS_COUNT = 4;
export const SELL_CHIP_PCT_MIN = 1;
export const SELL_CHIP_PCT_MAX = 100;

/**
 * Buy + sellSol amounts in SOL, sell amounts in integer percent. Fixed
 * length 8. `sellSol` powers the Sell side's SOL-denominated mode ("sell N
 * SOL worth of tokens"); `sell` powers its percentage mode.
 */
export type QuickChipsState = {
  buy: number[];
  sell: number[];
  sellSol: number[];
};

/** Which unit the Sell quick-chips are denominated in. */
export type SellChipMode = 'pct' | 'sol';

/* Defaults: chips 1-4 mirror the Terminal's prior hardcoded primary row;
   chips 5-8 mirror the old hardcoded OVERFLOW row (the second row the
   InstantTradeBox reveals when tall), so pre-extension users see the
   exact same chips after their persisted 4-length block pads out. Keep
   in sync with `defaultQuickChips()` in
   `api/src/db/queries/user-trading-settings.ts` (that side expresses
   buy / sellSol in lamports). */
const DEFAULT_QUICK_CHIPS_BUY_SOL = [0.01, 0.05, 0.1, 0.5, 0.25, 0.5, 2, 5];
const DEFAULT_QUICK_CHIPS_SELL_PCT = [25, 50, 75, 100, 20, 33, 75, 90];
const DEFAULT_QUICK_CHIPS_SELL_SOL = [0.1, 0.5, 1, 5, 0.25, 2, 10, 25];

export function defaultQuickChips(): QuickChipsState {
  return {
    buy: [...DEFAULT_QUICK_CHIPS_BUY_SOL],
    sell: [...DEFAULT_QUICK_CHIPS_SELL_PCT],
    sellSol: [...DEFAULT_QUICK_CHIPS_SELL_SOL],
  };
}

function normalizeSolChip(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  if (v < QUICK_BUY_MIN_SOL || v > QUICK_BUY_MAX_SOL) return fallback;
  return v;
}

/**
 * Defensive normalizer for any `quickChips`-shaped input (cache reads,
 * server responses, editor writes). Fixed length 8 per side; out-of-
 * bounds / wrong-type entries collapse to the per-index default (a
 * pre-extension 4-length block pads indices 4-7 with the old overflow
 * row's values). Mirrors the api/-side `normalizeQuickChips` (bounds +
 * fixed length) — both sides MUST stay in sync.
 */
export function normalizeQuickChips(raw: unknown): QuickChipsState {
  const out = defaultQuickChips();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  const buyRaw = Array.isArray(obj['buy']) ? (obj['buy'] as unknown[]) : [];
  const sellRaw = Array.isArray(obj['sell']) ? (obj['sell'] as unknown[]) : [];
  const sellSolRaw = Array.isArray(obj['sellSol']) ? (obj['sellSol'] as unknown[]) : [];
  for (let i = 0; i < QUICK_CHIPS_COUNT; i += 1) {
    out.buy[i] = normalizeSolChip(buyRaw[i], DEFAULT_QUICK_CHIPS_BUY_SOL[i]!);
    out.sell[i] = coerceIntInRange(
      sellRaw[i],
      SELL_CHIP_PCT_MIN,
      SELL_CHIP_PCT_MAX,
      DEFAULT_QUICK_CHIPS_SELL_PCT[i]!,
    );
    out.sellSol[i] = normalizeSolChip(sellSolRaw[i], DEFAULT_QUICK_CHIPS_SELL_SOL[i]!);
  }
  return out;
}

/* Mirrors the quickbuy / trade-presets convention; keys the per-user
   `quickChips` cache off the shared `last-user-id` pointer. */
export const QUICK_CHIPS_LOCAL_KEY_PREFIX = 'terminal:settings:quick-chips:';

/**
 * Synchronous module-load read of the last-known quick chips from
 * `localStorage`. Mirrors `readInitialTradePresets` (same SSR guard,
 * `last-user-id` pointer, defensive collapse-to-defaults).
 */
export function readInitialQuickChips(): QuickChipsState {
  if (typeof window === 'undefined') return defaultQuickChips();
  try {
    const lastUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    if (!lastUserId) return defaultQuickChips();
    const raw = window.localStorage.getItem(QUICK_CHIPS_LOCAL_KEY_PREFIX + lastUserId);
    if (raw === null) return defaultQuickChips();
    return normalizeQuickChips(JSON.parse(raw));
  } catch {
    return defaultQuickChips();
  }
}

/* ── USDC trade settings (global trade mode + USDC buy presets) ──────────
   Mirror of the `usdc_trade` block on `/api/v1/settings/trading`
   (`api/src/db/queries/user-trading-settings.ts`). Wholesale-replaced on
   PATCH, like `quick_chips`. All amounts are integer micro-USDC (6dp);
   conversion to display dollars happens at the render boundary and the
   wire already speaks micro, so no unit conversion exists in between. */
export type TradeQuoteMode = 'sol' | 'usdc';

export const USDC_BUY_MICRO_MIN = 100_000;
export const USDC_BUY_MICRO_MAX = 100_000_000_000;
/* Four, the same as the SOL side. The two quote modes are the same four
   buttons in different money; five in one and four in the other made
   switching currency change the shape of the panel. */
export const USDC_QUICK_BUY_COUNT = 4;

/* Canonical server defaults — both sides MUST stay in sync. */
const DEFAULT_BUY_USDC_MICRO = 10_000_000;
const DEFAULT_QUICK_BUY_USDC_MICRO = [
  5_000_000, 10_000_000, 25_000_000, 50_000_000,
];

export type UsdcTradeState = {
  trade_quote_mode: TradeQuoteMode;
  default_buy_usdc_micro: number;
  quick_buy_usdc_micro: number[];
};

export function defaultUsdcTrade(): UsdcTradeState {
  return {
    trade_quote_mode: 'sol',
    default_buy_usdc_micro: DEFAULT_BUY_USDC_MICRO,
    quick_buy_usdc_micro: [...DEFAULT_QUICK_BUY_USDC_MICRO],
  };
}

/**
 * Defensive normalizer for any `usdc_trade`-shaped input (wire, cache,
 * hydrate). Mirrors the api/-side normalizer: out-of-bounds / wrong-type
 * entries collapse to the per-field canonical default; the chip array is
 * fixed length 5.
 */
export function normalizeUsdcTrade(raw: unknown): UsdcTradeState {
  const out = defaultUsdcTrade();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  if (obj['trade_quote_mode'] === 'usdc') out.trade_quote_mode = 'usdc';
  out.default_buy_usdc_micro = coerceIntInRange(
    obj['default_buy_usdc_micro'],
    USDC_BUY_MICRO_MIN,
    USDC_BUY_MICRO_MAX,
    DEFAULT_BUY_USDC_MICRO,
  );
  const chipsRaw = Array.isArray(obj['quick_buy_usdc_micro'])
    ? (obj['quick_buy_usdc_micro'] as unknown[])
    : [];
  for (let i = 0; i < USDC_QUICK_BUY_COUNT; i += 1) {
    out.quick_buy_usdc_micro[i] = coerceIntInRange(
      chipsRaw[i],
      USDC_BUY_MICRO_MIN,
      USDC_BUY_MICRO_MAX,
      DEFAULT_QUICK_BUY_USDC_MICRO[i]!,
    );
  }
  return out;
}

/* Mirrors the quickbuy / trade-presets / quick-chips convention; keys the
   per-user `usdcTrade` cache off the shared `last-user-id` pointer. */
export const USDC_TRADE_LOCAL_KEY_PREFIX = 'terminal:settings:usdc-trade:';

/**
 * Synchronous module-load read of the last-known USDC trade settings
 * from `localStorage`. Mirrors `readInitialQuickChips` (same SSR guard,
 * `last-user-id` pointer, defensive collapse-to-defaults) — important
 * here so the SOL/USDC mode toggle paints the persisted mode on the
 * very first render instead of flashing 'sol'.
 */
export function readInitialUsdcTrade(): UsdcTradeState {
  if (typeof window === 'undefined') return defaultUsdcTrade();
  try {
    const lastUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    if (!lastUserId) return defaultUsdcTrade();
    const raw = window.localStorage.getItem(USDC_TRADE_LOCAL_KEY_PREFIX + lastUserId);
    if (raw === null) return defaultUsdcTrade();
    return normalizeUsdcTrade(JSON.parse(raw));
  } catch {
    return defaultUsdcTrade();
  }
}

/* The active Sell unit (% vs SOL) is a lightweight client-only UI
   preference — it does not affect order semantics until a chip is clicked,
   so it lives in localStorage rather than the server quick_chips block. */
export const SELL_CHIP_MODE_KEY = 'trade:sell-chip-mode:v1';

export function readInitialSellChipMode(): SellChipMode {
  if (typeof window === 'undefined') return 'pct';
  try {
    return window.localStorage.getItem(SELL_CHIP_MODE_KEY) === 'sol' ? 'sol' : 'pct';
  } catch {
    return 'pct';
  }
}

export const useTradeStore = create<TradeState>((set) => ({
  chartInterval: '1s',
  side: 'Buy',
  buyAmount: '0.0',
  sellAmount: '0.0',
  selectedSellPct: null,
  slippageBps: 1500,
  /* Synchronously seeded from localStorage so the very first render
     paints the user's persisted amounts. The hook layer reconciles
     with the server (~300 ms later) and handles user-switch edges. */
  quickBuyAmountsBySection: readInitialQuickBuyAmounts(),
  /* Same synchronous-module-load pattern for trade presets. The
     active preset's slippage drives the trade-execution path; reading
     from localStorage means the first paint already has the right
     value instead of momentarily defaulting to 1500 bps. */
  tradePresets: readInitialTradePresets(),
  setChartInterval: (interval) => set({ chartInterval: interval }),
  setSide: (side) => set({ side }),
  setBuyAmount: (amount) => set({ buyAmount: amount }),
  setSellAmount: (amount) => set({ sellAmount: amount }),
  setSelectedSellPct: (pct) => set({ selectedSellPct: pct }),
  setSlippageBps: (bps) => set({ slippageBps: bps }),
  setQuickBuyAmountSol: (sectionId, value) =>
    set((state) => {
      let next: number | null;
      if (value === null) {
        next = null;
      } else if (!Number.isFinite(value)) {
        // User typed something that parsed to NaN/Infinity — collapse
        // to `null` rather than persist a garbage value the server
        // would later reject.
        next = null;
      } else {
        next = Math.min(Math.max(value, QUICK_BUY_MIN_SOL), QUICK_BUY_MAX_SOL);
      }
      return {
        quickBuyAmountsBySection: {
          ...state.quickBuyAmountsBySection,
          [sectionId]: next,
        },
      };
    }),
  hydrateQuickBuyAmounts: (next) => set({ quickBuyAmountsBySection: next }),
  setActivePreset: (idx) =>
    set((state) => {
      const safe = clampIntInRange(idx, 0, TRADE_PRESETS_COUNT - 1, 0) as TradePresetIndex;
      if (safe === state.tradePresets.active_index) return state;
      return {
        tradePresets: { ...state.tradePresets, active_index: safe },
      };
    }),
  setActivePresetForSection: (sectionId, idx) =>
    set((state) => {
      const current = state.tradePresets.active_by_section;
      if (idx === null) {
        if (!(sectionId in current)) return state;
        const { [sectionId]: _removed, ...rest } = current;
        return {
          tradePresets: { ...state.tradePresets, active_by_section: rest },
        };
      }
      const safe = clampIntInRange(idx, 0, TRADE_PRESETS_COUNT - 1, 0) as TradePresetIndex;
      if (current[sectionId] === safe) return state;
      return {
        tradePresets: {
          ...state.tradePresets,
          active_by_section: { ...current, [sectionId]: safe },
        },
      };
    }),
  setPresetField: (idx, side, field, value) =>
    set((state) => {
      const safeIdx = clampIntInRange(idx, 0, TRADE_PRESETS_COUNT - 1, 0) as TradePresetIndex;
      /* Clone the touched preset / side / field so subscribers see a
         new top-level reference (used by the localStorage write-
         through subscriber to detect changes via `===`). */
      const previousPreset = state.tradePresets.presets[safeIdx];
      const previousSide = previousPreset[side];
      let bounded: number;
      switch (field) {
        case 'slippage_bps':
          bounded = clampIntInRange(
            Math.round(value),
            SLIPPAGE_BPS_MIN,
            SLIPPAGE_BPS_MAX,
            DEFAULT_PRESET_SIDE.slippage_bps,
          );
          break;
        case 'priority_lamports':
          bounded = clampIntInRange(
            Math.round(value),
            PRIORITY_LAMPORTS_MIN,
            PRIORITY_LAMPORTS_MAX,
            DEFAULT_PRESET_SIDE.priority_lamports,
          );
          break;
        case 'bribe_lamports':
          bounded = clampIntInRange(
            Math.round(value),
            BRIBE_LAMPORTS_MIN,
            BRIBE_LAMPORTS_MAX,
            DEFAULT_PRESET_SIDE.bribe_lamports,
          );
          break;
        default:
          return state;
      }
      if (previousSide[field] === bounded) return state;
      const nextSide: TradePresetSide = { ...previousSide, [field]: bounded };
      const nextPreset: TradePreset = { ...previousPreset, [side]: nextSide };
      const nextPresets = state.tradePresets.presets.slice() as [
        TradePreset,
        TradePreset,
        TradePreset,
      ];
      nextPresets[safeIdx] = nextPreset;
      return {
        tradePresets: { ...state.tradePresets, presets: nextPresets },
      };
    }),
  setPresetSendMode: (idx, side, mode) =>
    set((state) => {
      const safeIdx = clampIntInRange(idx, 0, TRADE_PRESETS_COUNT - 1, 0) as TradePresetIndex;
      const safeMode = coerceSendMode(mode);
      const previousPreset = state.tradePresets.presets[safeIdx];
      const previousSide = previousPreset[side];
      if (previousSide.send_mode === safeMode) return state;
      /* Same clone-the-touched-path pattern as setPresetField so the
         localStorage write-through subscriber sees a new reference. */
      const nextSide: TradePresetSide = { ...previousSide, send_mode: safeMode };
      const nextPreset: TradePreset = { ...previousPreset, [side]: nextSide };
      const nextPresets = state.tradePresets.presets.slice() as [
        TradePreset,
        TradePreset,
        TradePreset,
      ];
      nextPresets[safeIdx] = nextPreset;
      return {
        tradePresets: { ...state.tradePresets, presets: nextPresets },
      };
    }),
  hydrateTradePresets: (next) => set({ tradePresets: normalizeTradePresets(next) }),
  /* Same synchronous-module-load pattern again; `null` here means the
     user has never configured agent settings, NOT "configured as the
     defaults", and the two must stay distinguishable all the way to the
     compiler. */
  agentPreset: readInitialAgentPreset(),
  setAgentPresetField: (side, field, value) =>
    set((state) => {
      const base = state.agentPreset ?? agentPresetFromPreset(state.tradePresets.presets[0]);
      const bounds: Record<AgentPresetField, [number, number]> = {
        slippage_bps: [SLIPPAGE_BPS_MIN, SLIPPAGE_BPS_MAX],
        priority_lamports: [PRIORITY_LAMPORTS_MIN, PRIORITY_LAMPORTS_MAX],
        bribe_lamports: [BRIBE_LAMPORTS_MIN, BRIBE_LAMPORTS_MAX],
      };
      const [min, max] = bounds[field];
      const safe = clampIntInRange(value, min, max, base[side][field]);
      if (state.agentPreset !== null && base[side][field] === safe) return state;
      return { agentPreset: { ...base, [side]: { ...base[side], [field]: safe } } };
    }),
  setAgentPresetSendMode: (side, mode) =>
    set((state) => {
      const base = state.agentPreset ?? agentPresetFromPreset(state.tradePresets.presets[0]);
      const safe = coerceSendMode(mode);
      if (state.agentPreset !== null && base[side].send_mode === safe) return state;
      return { agentPreset: { ...base, [side]: { ...base[side], send_mode: safe } } };
    }),
  resetAgentPresetFromP1: () =>
    set((state) => ({ agentPreset: agentPresetFromPreset(state.tradePresets.presets[0]) })),
  hydrateAgentPreset: (next) => set({ agentPreset: normalizeAgentPreset(next) }),
  /* Synchronously seeded from localStorage so the very first render paints
     the user's persisted chips; the hook layer reconciles with the server
     and handles user-switch edges (mirrors quickBuy / tradePresets). */
  quickChips: readInitialQuickChips(),
  setQuickChips: (next) => set({ quickChips: normalizeQuickChips(next) }),
  hydrateQuickChips: (next) => set({ quickChips: normalizeQuickChips(next) }),
  /* USDC pair support: same synchronous-module-load cache pattern so
     the mode toggle + USDC chips paint persisted values immediately. */
  usdcTrade: readInitialUsdcTrade(),
  setTradeQuoteMode: (mode) =>
    set((state) => {
      if (state.usdcTrade.trade_quote_mode === mode) return state;
      // Reset the typed buy amount: its UNIT just changed (SOL ↔ USD),
      // so carrying the bare number across the flip silently re-scales
      // the order (a "$100" chip left behind becomes a 100 SOL buy).
      return {
        usdcTrade: { ...state.usdcTrade, trade_quote_mode: mode },
        buyAmount: '0.0',
      };
    }),
  setUsdcQuickBuyMicro: (values) =>
    set((state) => ({
      usdcTrade: normalizeUsdcTrade({
        ...state.usdcTrade,
        quick_buy_usdc_micro: values,
      }),
    })),
  hydrateUsdcTrade: (next) => set({ usdcTrade: normalizeUsdcTrade(next) }),
  sellChipMode: readInitialSellChipMode(),
  setSellChipMode: (mode) =>
    set(() => {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SELL_CHIP_MODE_KEY, mode);
        } catch {
          // Local preference only; soft-fail.
        }
      }
      return { sellChipMode: mode };
    }),
}));
