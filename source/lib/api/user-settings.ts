'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useCallback, useEffect, useRef } from 'react';
import {
  QUICK_BUY_LAST_USER_ID_KEY,
  QUICK_BUY_MAX_SOL,
  QUICK_BUY_MIN_SOL,
  QUICK_BUY_SECTION_IDS,
  defaultQuickChips,
  defaultTradePresets,
  defaultUsdcTrade,
  normalizeAgentPreset,
  normalizeQuickChips,
  normalizeTradePresets,
  normalizeUsdcTrade,
  useTradeStore,
  type QuickBuyAmountsBySection,
  type QuickBuySectionId,
  type AgentPresetState,
  type QuickChipsState,
  type TradePresetIndex,
  type TradePresetSide,
  type TradePresetSideKey,
  type TradePresetsState,
  type UsdcTradeState,
} from '@/lib/state/trade-store';
import {
  loadLocalSettings,
  localSettingsStorageKey,
  saveLocalSettings,
} from '@/lib/storage/local-settings';
import { useClerkSessionStore } from '@/lib/state/clerk-session-store';
import {
  COLD_BOOT_RETRY_DELAY_MS,
  COLD_BOOT_UNAUTHENTICATED,
  coldBootRetry,
  withColdBootAuth,
} from './cold-boot-auth';
import { fetchAuthenticatedApi } from './trading';

/**
 * `/api/v1/settings/trading` client surface. The route serves two
 * persisted slices in one payload:
 *
 *   - `quick_buy_lamports` (per-section QuickBuy SOL amounts).
 *   - `trade_presets` (3 global fee presets x Buy/Sell + active pointer).
 *
 * The Terminal exposes:
 *
 *   - `useUserTradingSettings()` — combined GET. Tanstack-query keyed
 *     on the route, `refetchOnWindowFocus`, no retry, only enabled
 *     when Clerk reports signed-in. Returns `{ quickBuyAmounts,
 *     tradePresets }` after defensive parsing.
 *
 *   - `useUpdateQuickBuyAmount()` — debounced merge-PATCH for the
 *     quick-buy section map. Coalesces multi-section edits into one
 *     round-trip after 500 ms of quiet.
 *
 *   - `useUpdateTradePresets()` — debounced wholesale-PATCH for the
 *     trade presets block. Same 500 ms debounce; the API accepts the
 *     COMPLETE block (not a partial), so the buffer here just keeps
 *     the latest snapshot and ships that on flush.
 *
 *   - `useHydrateUserSettings()` — one-line boot hook. Synchronous
 *     module-load init from localStorage (per `readInitial*` in
 *     trade-store.ts) means the first paint already shows the right
 *     values; this hook handles user-switch reconciliation +
 *     write-through subscription + one-shot server overwrite.
 */

export const USER_SETTINGS_QUERY_KEY = ['api', 'v1', 'settings', 'trading'] as const;

const LAMPORTS_PER_SOL = 1_000_000_000;

export interface ParsedUserSettings {
  quickBuyAmounts: QuickBuyAmountsBySection;
  tradePresets: TradePresetsState;
  quickChips: QuickChipsState;
  usdcTrade: UsdcTradeState;
  /** `null` when the api sent no `agent_preset` — i.e. never configured. */
  agentPreset: AgentPresetState;
}

function lamportsToSol(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number') return null;
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
  if (raw <= 0) return null;
  return raw / LAMPORTS_PER_SOL;
}

function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

function emptyAmounts(): QuickBuyAmountsBySection {
  const out: Partial<QuickBuyAmountsBySection> = {};
  for (const id of QUICK_BUY_SECTION_IDS) out[id] = null;
  return out as QuickBuyAmountsBySection;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyParsedSettings(): ParsedUserSettings {
  return {
    quickBuyAmounts: emptyAmounts(),
    tradePresets: defaultTradePresets(),
    quickChips: defaultQuickChips(),
    usdcTrade: defaultUsdcTrade(),
    agentPreset: null,
  };
}

/**
 * Parse the wire `quick_chips` block (buy in lamports, sell in pct) into
 * the Terminal's canonical shape (buy in SOL). Lamports -> SOL is applied
 * per buy element; the store-side `normalizeQuickChips` then enforces the
 * fixed length + bounds. Any structural mismatch collapses to defaults.
 */
function lamportsArrayToSol(raw: unknown): unknown[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v / LAMPORTS_PER_SOL : v,
  );
}

function parseQuickChipsResponse(raw: unknown): QuickChipsState {
  if (!isObject(raw)) return defaultQuickChips();
  return normalizeQuickChips({
    buy: lamportsArrayToSol(raw['buy']),
    sell: Array.isArray(raw['sell']) ? raw['sell'] : [],
    sellSol: lamportsArrayToSol(raw['sellSol']),
  });
}

/**
 * Parse the combined wire payload from `/api/v1/settings/trading` into
 * the Terminal's canonical shape. Any structural mismatch in either
 * slice collapses that slice to its canonical empty/default while
 * leaving the other intact — the UI then behaves as if that slice has
 * never been written, which is the correct degraded state.
 */
export function parseUserTradingSettingsResponse(raw: unknown): ParsedUserSettings {
  if (!isObject(raw)) return emptyParsedSettings();
  if (raw['reauth_required'] !== false) return emptyParsedSettings();

  /* quick_buy_lamports slice */
  const lamportsRaw = raw['quick_buy_lamports'];
  const quickBuyAmounts = emptyAmounts();
  if (isObject(lamportsRaw)) {
    for (const id of QUICK_BUY_SECTION_IDS) {
      quickBuyAmounts[id] = lamportsToSol(lamportsRaw[id]);
    }
  }

  /* trade_presets slice — defer to the store-side normalizer so the
     same bounds + collapse rules apply on every entry point. */
  const tradePresets = normalizeTradePresets(raw['trade_presets']);

  /* quick_chips slice — wire is lamports/pct; convert + normalize. */
  const quickChips = parseQuickChipsResponse(raw['quick_chips']);

  /* usdc_trade slice — wire is already micro-USDC (the store's native
     unit), so the store-side normalizer is the whole parse. */
  const usdcTrade = normalizeUsdcTrade(raw['usdc_trade']);

  /* agent_preset slice — the api OMITS the key when the user has never
     configured agent settings, and the store-side normalizer turns any
     non-object (including that absence) back into `null`. Do not default
     this one: `null` and "a block equal to the defaults" mean different
     things all the way down to the compiler. */
  const agentPreset = normalizeAgentPreset(raw['agent_preset']);

  return { quickBuyAmounts, tradePresets, quickChips, usdcTrade, agentPreset };
}

const QUICK_BUY_LOCAL_KEY = 'quickbuy';
const TRADE_PRESETS_LOCAL_KEY = 'trade-presets';
const QUICK_CHIPS_LOCAL_KEY = 'quick-chips';
const USDC_TRADE_LOCAL_KEY = 'usdc-trade';
const AGENT_PRESET_LOCAL_KEY = 'agent-preset';

/**
 * Defensive parser for the `localStorage`-cached `quickbuy` map.
 * See module header for invariants; behaviour summary:
 *
 *  - unknown / non-object root         -> null  (no hydration)
 *  - missing or out-of-bounds value    -> that section becomes null
 *  - non-number value                  -> that section becomes null
 *  - unknown keys                      -> dropped
 *  - all-null result                   -> returned as-is (idempotent
 *    with the store's default empty state)
 */
export function parseCachedQuickBuyAmounts(raw: unknown): QuickBuyAmountsBySection | null {
  if (!isObject(raw)) return null;
  const out = emptyAmounts();
  for (const id of QUICK_BUY_SECTION_IDS) {
    const v = raw[id];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < QUICK_BUY_MIN_SOL || v > QUICK_BUY_MAX_SOL) continue;
    out[id] = v;
  }
  return out;
}

/**
 * Defensive parser for the `localStorage`-cached `trade-presets`
 * block. Always defers to the store-side `normalizeTradePresets` so
 * the EXACT same bounds + per-field collapse rules apply at every
 * entry point (wire, cache, hydrate). Returns null only when the raw
 * input is missing entirely; on any partial / malformed shape we
 * fall through to the canonical defaults via the normalizer.
 */
export function parseCachedTradePresets(raw: unknown): TradePresetsState | null {
  if (raw === null || raw === undefined) return null;
  return normalizeTradePresets(raw);
}

/**
 * Defensive parser for the `localStorage`-cached `quick-chips` block. The
 * cache stores the canonical SOL/pct shape (no lamports conversion), so we
 * defer straight to the store-side normalizer. Returns null only when the
 * raw input is missing entirely.
 */
export function parseCachedQuickChips(raw: unknown): QuickChipsState | null {
  if (raw === null || raw === undefined) return null;
  return normalizeQuickChips(raw);
}

/**
 * Defensive parser for the `localStorage`-cached `agent-preset` block.
 * Unlike its siblings there is no "missing vs empty" distinction to make
 * here — `normalizeAgentPreset` already collapses both to `null`, which is
 * the canonical never-configured value.
 */
export function parseCachedAgentPreset(raw: unknown): AgentPresetState {
  return normalizeAgentPreset(raw);
}

/**
 * Defensive parser for the `localStorage`-cached `usdc-trade` block.
 * The cache stores the canonical micro-USDC shape (same as the wire),
 * so we defer straight to the store-side normalizer. Returns null only
 * when the raw input is missing entirely.
 */
export function parseCachedUsdcTrade(raw: unknown): UsdcTradeState | null {
  if (raw === null || raw === undefined) return null;
  return normalizeUsdcTrade(raw);
}

type RefreshTokenFn = () => Promise<string | null>;

async function fetchUserTradingSettings(
  signal: AbortSignal | undefined,
  authToken: string | null,
  refreshToken?: RefreshTokenFn,
): Promise<ParsedUserSettings> {
  let tokenUsed = authToken;
  let response = await fetchAuthenticatedApi(
    '/api/v1/settings/trading',
    { method: 'GET' },
    { authToken, signal },
  );
  // Same stale-Clerk-token edge as `/me`: after idle + hard refresh,
  // the first cached JWT can be expired. Retry once with a forced
  // refresh before treating the user as reauthed.
  if (response.status === 401 && refreshToken) {
    const fresh = await refreshToken();
    if (fresh) {
      tokenUsed = fresh;
      response = await fetchAuthenticatedApi(
        '/api/v1/settings/trading',
        { method: 'GET' },
        { authToken: fresh, signal },
      );
    }
  }
  if (response.status === 401 || response.status === 403) {
    // Cold boot: a token-less request against the cross-site API origin
    // can never authenticate — that answer says nothing about the user.
    // Throw so React Query retries once the Clerk mirror populates,
    // instead of caching empty quickbuy presets over the real ones.
    if (tokenUsed === null) throw new Error(COLD_BOOT_UNAUTHENTICATED);
    // Auth really failed. Do not throw forever; signed-in gates elsewhere
    // handle reauth. This shape is intentionally empty but should only
    // happen after a forced-token retry failed.
    return emptyParsedSettings();
  }
  if (!response.ok) {
    // Transient 5xx/network-ish statuses must NOT hydrate empty
    // QuickBuy amounts over the last good local/server settings. Throw
    // so React Query retries and consumers keep current store state.
    throw new Error(`settings_trading_http_${response.status}`);
  }
  const json = (await response.json()) as unknown;
  // Reauth body on a token-less first fetch: same cold-boot class as the
  // 401 branch above (the api answers 200 + reauth_required for cookie-
  // only cross-site requests).
  if (isObject(json) && json['reauth_required'] === true && tokenUsed === null) {
    throw new Error(COLD_BOOT_UNAUTHENTICATED);
  }
  return parseUserTradingSettingsResponse(json);
}

export function useUserTradingSettings(): UseQueryResult<ParsedUserSettings> {
  const { getToken } = useAuth();
  // Cookie-optimistic Discover boot path: fire immediately with the
  // mirrored token (or session cookie) instead of waiting for
  // clerk.browser.js — quickbuy presets hydrate on the first paint.
  // Bail only on a POSITIVE signed-out.
  const isSignedIn = useClerkSessionStore((s) => s.isSignedIn);
  const enabled = isSignedIn !== false;
  return useQuery<ParsedUserSettings>({
    queryKey: USER_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) =>
      withColdBootAuth((token) =>
        fetchUserTradingSettings(signal, token, () => getToken({ skipCache: true })),
      ),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Cold-boot retries while Clerk JS boots; the 401→reauth fallback
    // (forced-refresh retry inside the fetcher) stays intact. After
    // load, keep the original transient-error retry budget.
    retry: (failureCount, error) => coldBootRetry(failureCount, error) || failureCount < 2,
    retryDelay: COLD_BOOT_RETRY_DELAY_MS,
  });
}

interface QuickBuyPatchBody {
  quick_buy_lamports?: Partial<Record<QuickBuySectionId, number | null>>;
  trade_presets?: TradePresetsState;
  quick_chips?: { buy: number[]; sell: number[]; sellSol: number[] };
  /* Wholesale-replace, like quick_chips. Already micro-USDC on both
     sides, so the store snapshot ships unconverted. */
  usdc_trade?: UsdcTradeState;
  /* Wholesale-replace. Only ever sent as a complete block — the api has
     no partial-merge branch for it. */
  agent_preset?: NonNullable<AgentPresetState>;
}

async function patchUserTradingSettings(
  body: QuickBuyPatchBody,
  authToken: string | null,
): Promise<ParsedUserSettings> {
  const response = await fetchAuthenticatedApi(
    '/api/v1/settings/trading',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { authToken },
  );
  if (!response.ok) {
    throw new Error(`settings.trading.patch.failed:${response.status}`);
  }
  const json = (await response.json()) as unknown;
  return parseUserTradingSettingsResponse(json);
}

const DEBOUNCE_MS = 500;

/* ── QuickBuy debounced mutation ─────────────────────────────────── */

export interface UseUpdateQuickBuyAmountResult {
  /**
   * Enqueue a per-section change. The latest value for each section
   * is held in a buffer; after `DEBOUNCE_MS` of quiet across ALL
   * pending sections, a single merge-PATCH fires with every buffered
   * key. Multiple rapid commits to the same section coalesce; commits
   * across different sections coalesce into one round-trip.
   */
  enqueue: (sectionId: QuickBuySectionId, value: number | null) => void;
  /** Force-flush the buffer immediately. */
  flush: () => void;
}

export function useUpdateQuickBuyAmount(): UseUpdateQuickBuyAmountResult {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const bufferRef = useRef<Partial<Record<QuickBuySectionId, number | null>>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation<
    ParsedUserSettings,
    Error,
    Partial<Record<QuickBuySectionId, number | null>>
  >({
    mutationFn: async (patch) => {
      const lamportsPatch: Partial<Record<QuickBuySectionId, number | null>> = {};
      for (const [k, v] of Object.entries(patch)) {
        const key = k as QuickBuySectionId;
        if (v === null || v === undefined) {
          lamportsPatch[key] = null;
        } else if (Number.isFinite(v)) {
          lamportsPatch[key] = solToLamports(v);
        }
      }
      return patchUserTradingSettings(
        { quick_buy_lamports: lamportsPatch },
        await getToken(),
      );
    },
    onSuccess: (next) => {
      qc.setQueryData<ParsedUserSettings>(USER_SETTINGS_QUERY_KEY, next);
    },
  });

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = bufferRef.current;
    bufferRef.current = {};
    if (Object.keys(patch).length === 0) return;
    mutation.mutate(patch);
  }, [mutation]);

  const enqueue = useCallback(
    (sectionId: QuickBuySectionId, value: number | null): void => {
      bufferRef.current[sectionId] = value;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /* Latest-callback ref so the unmount cleanup can call the *current*
     `flush` without re-running on every render. Without this, an
     empty-deps cleanup captures the first-render `flush`; with `flush`
     in the deps, the cleanup re-runs every render and spuriously
     flushes. The ref is the canonical React workaround. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      /* Flush any pending buffered changes on unmount. Without this,
         a user who types a value and immediately closes the consuming
         component (e.g. clicks outside the Trading Settings modal
         within the 500 ms debounce window) silently loses the save —
         the timer is cleared but the buffer is never patched to the
         server, so on the next page load the field reverts to the
         server's stale value. */
      flushRef.current();
    };
  }, []);

  return { enqueue, flush };
}

/* ── Trade presets debounced mutation ────────────────────────────── */

export interface UseUpdateTradePresetsResult {
  /**
   * Enqueue a wholesale snapshot of the current trade presets state.
   * The api/ accepts the COMPLETE block (active_index + all 3 presets,
   * both sides fully populated). The buffer here is a single
   * `TradePresetsState` reference; rapid updates coalesce because each
   * call simply overwrites the buffer with the latest snapshot. After
   * `DEBOUNCE_MS` of quiet, one PATCH ships that snapshot.
   *
   * Typical callers: the modal's per-keystroke `setPresetField`, and
   * the QuickBuyPanel's P1/P2/P3 active-preset toggle.
   */
  enqueue: (snapshot: TradePresetsState) => void;
  /** Force-flush the buffer immediately. */
  flush: () => void;
}

export function useUpdateTradePresets(): UseUpdateTradePresetsResult {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const bufferRef = useRef<TradePresetsState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation<ParsedUserSettings, Error, TradePresetsState>({
    mutationFn: async (snapshot) =>
      patchUserTradingSettings({ trade_presets: snapshot }, await getToken()),
    onSuccess: (next) => {
      qc.setQueryData<ParsedUserSettings>(USER_SETTINGS_QUERY_KEY, next);
    },
  });

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = bufferRef.current;
    bufferRef.current = null;
    if (snapshot === null) return;
    mutation.mutate(snapshot);
  }, [mutation]);

  const enqueue = useCallback(
    (snapshot: TradePresetsState): void => {
      bufferRef.current = snapshot;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /* See `useUpdateQuickBuyAmount` for the rationale on the
     latest-callback ref + flush-on-unmount pattern. Without this,
     closing the Trading Settings modal within 500 ms of the last
     keystroke silently drops the PATCH. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  return { enqueue, flush };
}

/* ── Quick chips debounced mutation ──────────────────────────────── */

export interface UseUpdateQuickChipsResult {
  /**
   * Enqueue a wholesale snapshot of the current quick-chips block. The
   * api/ accepts the COMPLETE block (4 buy + 4 sell). The buffer is a
   * single `QuickChipsState` reference; rapid updates coalesce because
   * each call overwrites the buffer. After `DEBOUNCE_MS` of quiet, one
   * PATCH ships the snapshot (buy converted SOL -> lamports).
   */
  enqueue: (snapshot: QuickChipsState) => void;
  /** Force-flush the buffer immediately. */
  flush: () => void;
}

export function useUpdateQuickChips(): UseUpdateQuickChipsResult {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const bufferRef = useRef<QuickChipsState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation<ParsedUserSettings, Error, QuickChipsState>({
    mutationFn: async (snapshot) => {
      const lamportsBuy = snapshot.buy.map((sol) => solToLamports(sol));
      const lamportsSellSol = snapshot.sellSol.map((sol) => solToLamports(sol));
      return patchUserTradingSettings(
        { quick_chips: { buy: lamportsBuy, sell: snapshot.sell, sellSol: lamportsSellSol } },
        await getToken(),
      );
    },
    onSuccess: (next) => {
      qc.setQueryData<ParsedUserSettings>(USER_SETTINGS_QUERY_KEY, next);
    },
  });

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = bufferRef.current;
    bufferRef.current = null;
    if (snapshot === null) return;
    mutation.mutate(snapshot);
  }, [mutation]);

  const enqueue = useCallback(
    (snapshot: QuickChipsState): void => {
      bufferRef.current = snapshot;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /* See `useUpdateQuickBuyAmount` for the rationale on the
     latest-callback ref + flush-on-unmount pattern. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  return { enqueue, flush };
}

/* ── USDC trade debounced mutation ───────────────────────────────── */

export interface UseUpdateUsdcTradeResult {
  /**
   * Enqueue a wholesale snapshot of the current usdc-trade block. The
   * api/ accepts the COMPLETE block (mode + default + 5 chips); rapid
   * updates coalesce because each call overwrites the single-snapshot
   * buffer. After `DEBOUNCE_MS` of quiet, one PATCH ships the snapshot.
   */
  enqueue: (snapshot: UsdcTradeState) => void;
  /** Force-flush the buffer immediately. */
  flush: () => void;
}

export function useUpdateUsdcTrade(): UseUpdateUsdcTradeResult {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const bufferRef = useRef<UsdcTradeState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation<ParsedUserSettings, Error, UsdcTradeState>({
    mutationFn: async (snapshot) =>
      patchUserTradingSettings({ usdc_trade: snapshot }, await getToken()),
    onSuccess: (next) => {
      qc.setQueryData<ParsedUserSettings>(USER_SETTINGS_QUERY_KEY, next);
    },
  });

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = bufferRef.current;
    bufferRef.current = null;
    if (snapshot === null) return;
    mutation.mutate(snapshot);
  }, [mutation]);

  const enqueue = useCallback(
    (snapshot: UsdcTradeState): void => {
      bufferRef.current = snapshot;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /* See `useUpdateQuickBuyAmount` for the rationale on the
     latest-callback ref + flush-on-unmount pattern. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  return { enqueue, flush };
}

/* ── Boot-effect hook (both slices) ──────────────────────────────── */

/**
 * Boot-effect hook: three-layer hydration so a refresh shows the
 * last-known values for both slices instantly, then reconciles with
 * the server. See the in-file commentary on the QuickBuy version for
 * the full race-trace; this hook extends the same pattern across BOTH
 * the `quickBuyAmountsBySection` and `tradePresets` slices in
 * parallel.
 *
 *  1. User-switch reconciliation: if the stored `last-user-id`
 *     mismatches the current Clerk user id, dispatch both
 *     hydrate fns from THIS user's cache (or canonical defaults if
 *     absent) and rewrite the pointer.
 *
 *  2. Store subscription -> localStorage write-through: closures
 *     track the previous reference of each slice and write only on
 *     change.
 *
 *  3. One-shot server hydration: the first resolved `useUserTradingSettings`
 *     payload writes both slices into the store; later refetches are
 *     observed in the React Query cache but do NOT bulldoze
 *     in-flight local edits.
 */
export function useHydrateUserSettings(): UseQueryResult<ParsedUserSettings> {
  const { userId: clerkUserId, isLoaded, isSignedIn } = useAuth();
  const hydrateQuickBuy = useTradeStore((s) => s.hydrateQuickBuyAmounts);
  const hydratePresets = useTradeStore((s) => s.hydrateTradePresets);
  const hydrateQuickChips = useTradeStore((s) => s.hydrateQuickChips);
  const hydrateUsdcTrade = useTradeStore((s) => s.hydrateUsdcTrade);
  const hydrateAgentPreset = useTradeStore((s) => s.hydrateAgentPreset);
  const result = useUserTradingSettings();

  /* Step 1 — user-switch reconciliation + pointer maintenance. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isLoaded || !isSignedIn || !clerkUserId) return;
    let priorUserId: string | null = null;
    try {
      priorUserId = window.localStorage.getItem(QUICK_BUY_LAST_USER_ID_KEY);
    } catch {
      /* See QuickBuy variant. Soft-fail; behave as user-switch. */
    }
    if (priorUserId !== clerkUserId) {
      const cachedQuickBuy = loadLocalSettings(
        QUICK_BUY_LOCAL_KEY,
        clerkUserId,
        parseCachedQuickBuyAmounts,
      );
      hydrateQuickBuy(cachedQuickBuy ?? emptyAmounts());
      const cachedPresets = loadLocalSettings(
        TRADE_PRESETS_LOCAL_KEY,
        clerkUserId,
        parseCachedTradePresets,
      );
      hydratePresets(cachedPresets ?? defaultTradePresets());
      const cachedQuickChips = loadLocalSettings(
        QUICK_CHIPS_LOCAL_KEY,
        clerkUserId,
        parseCachedQuickChips,
      );
      hydrateQuickChips(cachedQuickChips ?? defaultQuickChips());
      const cachedUsdcTrade = loadLocalSettings(
        USDC_TRADE_LOCAL_KEY,
        clerkUserId,
        parseCachedUsdcTrade,
      );
      hydrateUsdcTrade(cachedUsdcTrade ?? defaultUsdcTrade());
      /* No `??` fallback: the cached parser already answers `null` for a
         missing block, and `null` is the correct never-configured value. */
      hydrateAgentPreset(
        loadLocalSettings(AGENT_PRESET_LOCAL_KEY, clerkUserId, parseCachedAgentPreset) ?? null,
      );
      try {
        window.localStorage.setItem(QUICK_BUY_LAST_USER_ID_KEY, clerkUserId);
      } catch {
        /* Soft-fail; next reload re-runs the user-switch path. */
      }
    }
  }, [
    isLoaded,
    isSignedIn,
    clerkUserId,
    hydrateQuickBuy,
    hydratePresets,
    hydrateQuickChips,
    hydrateUsdcTrade,
  ]);

  /* Step 2 — write-through subscriber for both slices. Closure-
     tracked previous references skip writes on unrelated state
     mutations (chartInterval, buyAmount, etc). */
  useEffect(() => {
    if (!clerkUserId) return;
    const initial = useTradeStore.getState();
    let previousQuickBuy = initial.quickBuyAmountsBySection;
    let previousPresets = initial.tradePresets;
    let previousQuickChips = initial.quickChips;
    let previousUsdcTrade = initial.usdcTrade;
    let previousAgentPreset = initial.agentPreset;
    const unsub = useTradeStore.subscribe((state) => {
      if (state.quickBuyAmountsBySection !== previousQuickBuy) {
        previousQuickBuy = state.quickBuyAmountsBySection;
        saveLocalSettings(QUICK_BUY_LOCAL_KEY, clerkUserId, previousQuickBuy);
      }
      if (state.tradePresets !== previousPresets) {
        previousPresets = state.tradePresets;
        saveLocalSettings(TRADE_PRESETS_LOCAL_KEY, clerkUserId, previousPresets);
      }
      if (state.quickChips !== previousQuickChips) {
        previousQuickChips = state.quickChips;
        saveLocalSettings(QUICK_CHIPS_LOCAL_KEY, clerkUserId, previousQuickChips);
      }
      if (state.usdcTrade !== previousUsdcTrade) {
        previousUsdcTrade = state.usdcTrade;
        saveLocalSettings(USDC_TRADE_LOCAL_KEY, clerkUserId, previousUsdcTrade);
      }
      if (state.agentPreset !== previousAgentPreset && state.agentPreset !== null) {
        previousAgentPreset = state.agentPreset;
        saveLocalSettings(AGENT_PRESET_LOCAL_KEY, clerkUserId, previousAgentPreset);
      }
    });
    return unsub;
  }, [clerkUserId]);

  /* Step 2b — cross-tab sync. Each PATCH ships the COMPLETE presets /
     chips block, so a second tab with a stale store would revert this
     tab's saved changes on its next edit. The write-through above
     already lands every change in localStorage; listen for the other
     tab's writes (`storage` events never fire on the writing tab, so
     own-tab echoes are excluded by the platform) and hydrate the
     corresponding slice.

     No write loop: we only hydrate when the incoming value differs
     from the current store state (deep compare via canonical JSON).
     The hydration DOES re-trigger the write-through subscriber, but
     that writes the same value back — at worst one textual
     normalization bounce (key-order differences), after which both
     tabs' compares short-circuit. */
  useEffect(() => {
    if (typeof window === 'undefined' || !clerkUserId) return;
    const onStorage = (event: StorageEvent) => {
      const incoming = event.newValue;
      if (event.key === null || incoming === null) return;
      const applyIfChanged = <T,>(
        localKey: string,
        parse: (raw: unknown) => T | null,
        current: () => T,
        hydrate: (next: T) => void,
      ): void => {
        if (event.key !== localSettingsStorageKey(localKey, clerkUserId)) return;
        let parsed: T | null;
        try {
          parsed = parse(JSON.parse(incoming) as unknown);
        } catch {
          /* Malformed cross-tab payload — ignore; the server remains
             the source of truth and the next GET reconciles. */
          return;
        }
        if (parsed === null) return;
        if (JSON.stringify(parsed) === JSON.stringify(current())) return;
        hydrate(parsed);
      };
      applyIfChanged(
        QUICK_BUY_LOCAL_KEY,
        parseCachedQuickBuyAmounts,
        () => useTradeStore.getState().quickBuyAmountsBySection,
        hydrateQuickBuy,
      );
      applyIfChanged(
        TRADE_PRESETS_LOCAL_KEY,
        parseCachedTradePresets,
        () => useTradeStore.getState().tradePresets,
        hydratePresets,
      );
      applyIfChanged(
        QUICK_CHIPS_LOCAL_KEY,
        parseCachedQuickChips,
        () => useTradeStore.getState().quickChips,
        hydrateQuickChips,
      );
      applyIfChanged(
        USDC_TRADE_LOCAL_KEY,
        parseCachedUsdcTrade,
        () => useTradeStore.getState().usdcTrade,
        hydrateUsdcTrade,
      );
      applyIfChanged(
        AGENT_PRESET_LOCAL_KEY,
        parseCachedAgentPreset,
        () => useTradeStore.getState().agentPreset,
        hydrateAgentPreset,
      );
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [
    clerkUserId,
    hydrateQuickBuy,
    hydratePresets,
    hydrateQuickChips,
    hydrateUsdcTrade,
    hydrateAgentPreset,
  ]);

  /* Step 3 — one-shot server hydration, scoped to the SESSION (module
     latch keyed by user), not to the hook's mount. This hook mounts in
     DiscoverPage, so a per-mount ref re-hydrated on every SPA return to
     Discover — and a refetched payload carrying nulls (failed PATCH,
     stale cache) could overwrite live local edits and flip quickbuy
     into its disabled state mid-session. Both slices come in the same
     payload, so one latch guards both; a user switch re-arms it. */
  const dataKey = result.data ? JSON.stringify(result.data) : null;
  useEffect(() => {
    if (!clerkUserId || serverHydratedForUser === clerkUserId) return;
    if (!result.data) return;
    hydrateQuickBuy(result.data.quickBuyAmounts);
    hydratePresets(result.data.tradePresets);
    hydrateQuickChips(result.data.quickChips);
    hydrateUsdcTrade(result.data.usdcTrade);
    hydrateAgentPreset(result.data.agentPreset);
    serverHydratedForUser = clerkUserId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataKey,
    clerkUserId,
    hydrateQuickBuy,
    hydratePresets,
    hydrateQuickChips,
    hydrateUsdcTrade,
    hydrateAgentPreset,
  ]);

  return result;
}

/* ── Agent preset debounced mutation ─────────────────────────────── */

export interface UseUpdateAgentPresetResult {
  /**
   * Enqueue a wholesale snapshot of the agent-preset block. Mirrors the
   * quick-chips / usdc-trade mutations exactly: single-snapshot buffer,
   * last write wins, one PATCH after `DEBOUNCE_MS` of quiet.
   *
   * Takes a NON-NULL block on purpose. `null` means "never configured",
   * and there is no PATCH that expresses it — the api has no clear branch
   * for this column, and adding one would let a UI bug silently return a
   * user to platform posture.
   */
  enqueue: (snapshot: NonNullable<AgentPresetState>) => void;
  /** Force-flush the buffer immediately. */
  flush: () => void;
}

export function useUpdateAgentPreset(): UseUpdateAgentPresetResult {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const bufferRef = useRef<NonNullable<AgentPresetState> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutation = useMutation<ParsedUserSettings, Error, NonNullable<AgentPresetState>>({
    mutationFn: async (snapshot) =>
      patchUserTradingSettings({ agent_preset: snapshot }, await getToken()),
    onSuccess: (next) => {
      qc.setQueryData<ParsedUserSettings>(USER_SETTINGS_QUERY_KEY, next);
    },
  });

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = bufferRef.current;
    bufferRef.current = null;
    if (snapshot === null) return;
    mutation.mutate(snapshot);
  }, [mutation]);

  const enqueue = useCallback(
    (snapshot: NonNullable<AgentPresetState>): void => {
      bufferRef.current = snapshot;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  /* See `useUpdateQuickBuyAmount` for the rationale on the
     latest-callback ref + flush-on-unmount pattern. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  return { enqueue, flush };
}

/** Session-scoped server-hydration latch (see Step 3 above). */
let serverHydratedForUser: string | null = null;

/** Test-only: re-arm the one-shot server hydration between cases. */
export function _resetServerHydrationLatchForTests(): void {
  serverHydratedForUser = null;
}

/**
 * @deprecated Renamed to `useHydrateUserSettings` now that the hook
 * hydrates the `tradePresets` slice too. Kept as an alias for one
 * release so any external imports continue to resolve; remove after
 * the next deploy cycle.
 */
export const useHydrateQuickBuyAmounts = useHydrateUserSettings;

/* ── Type re-exports for consumers of the wire shape ─────────────── */

export type { TradePresetSide, TradePresetIndex, TradePresetSideKey };
