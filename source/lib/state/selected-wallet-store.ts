'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { MeWalletEntry } from '@/lib/api/me';

/**
 * Slice "Terminal wallet selector" + "Multi-wallet split buy/sell
 * orders" (UI revision): unified wallet-selection store.
 *
 * Source of truth:
 *   - `multiSelectedWalletAccountIds`: the (always ≥ 1) ordered set of
 *     wallet UUIDs the user has selected for the next trade.
 *   - `selectedWalletAccountId` is DERIVED — mirrored to
 *     `multiSelectedWalletAccountIds[0]` so per-wallet UI surfaces
 *     (positions, fills, balance polling) follow the "focused" wallet
 *     of the multi-set.
 *
 * Invariants:
 *   - The first mount seeds the set with the user's primary wallet.
 *   - "Clear" never empties the set — it falls back to the primary.
 *   - The reconciler drops ids that are no longer eligible (archived /
 *     disabled / status≠active); if the result is empty it reseeds
 *     with the primary.
 *
 * Routing is derived from the count:
 *   - 1 selected wallet → single-wallet order (POST /api/v1/trade/orders)
 *   - 2+ selected wallets → batch order (POST /api/v1/trade/batch-orders)
 *
 * No visible `multiWalletMode` toggle exists anymore.
 *
 * Threat model: the store holds only opaque UUIDs. No secrets, no
 * keys, no balances. The api/ side is the authoritative gate on every
 * per-wallet route.
 */

const STORAGE_PREFIX = 'terminal:selected-wallet:';
const STORAGE_PREFIX_MULTI = 'terminal:multi-wallet:';
/**
 * Pointer to the last signed-in Clerk user, written on `bindClerkUser`. Lets
 * the store seed the persisted selection SYNCHRONOUSLY at module load (before
 * Clerk re-reports `userId`), mirroring `readInitialQuickBuyAmounts` in the
 * trade store. Without this, the first render after a cold login has an empty
 * selection while `/me.wallets` is already populated, which makes the trading
 * gate transiently report `needs_wallet_selection` (opening the wallet panel
 * on a Discover quick-buy) and makes the first quick-buy ignore a persisted
 * multi-wallet selection. A different user signing in is reconciled on the next
 * `bindClerkUser`.
 */
const LAST_USER_ID_KEY = 'terminal:selected-wallet:last-user-id';

/**
 * Slice "Terminal wallet selector": a wallet is *eligible* for
 * selection iff it is active, enabled, not archived. We do NOT
 * filter on `trade_ready` here so a freshly-created wallet that has
 * not finished nonce setup is still selectable (the user needs to
 * select it to RUN nonce setup).
 */
export function isEligibleWallet(w: MeWalletEntry): boolean {
  return !w.is_archived && w.is_enabled && w.status === 'active';
}

/**
 * Picks the default selection out of a `/me.wallets` list.
 *
 *   - Primary wallet first when eligible.
 *   - Otherwise the first eligible wallet by the server's order
 *     (the api/ orders primary-first then `display_order ASC`).
 *   - Returns `null` when no eligible wallet exists.
 */
export function pickDefaultSelectedWallet(
  wallets: ReadonlyArray<MeWalletEntry>,
): MeWalletEntry | null {
  const eligible = wallets.filter(isEligibleWallet);
  if (eligible.length === 0) return null;
  const primary = eligible.find((w) => w.is_primary);
  return primary ?? eligible[0] ?? null;
}

/**
 * Resolves the wallet entry that corresponds to a stored
 * `wallet_account_id`. Returns `null` when the id no longer
 * resolves to an eligible wallet (admin archived, disabled,
 * deleted) so callers can fall back to the default.
 */
export function getSelectedWallet(
  wallets: ReadonlyArray<MeWalletEntry>,
  walletAccountId: string | null,
): MeWalletEntry | null {
  if (walletAccountId === null) return null;
  const target = wallets.find((w) => w.wallet_account_id === walletAccountId);
  if (!target) return null;
  return isEligibleWallet(target) ? target : null;
}

interface SelectedWalletState {
  /** Current Clerk user id binding the persisted selection, or null when signed out. */
  readonly clerkUserId: string | null;
  /**
   * DERIVED: equals `multiSelectedWalletAccountIds[0]` when the set
   * is non-empty, else `null`. Kept on the state shape (rather than a
   * pure selector) so existing call sites that read this field via
   * `useSelectedWalletStore((s) => s.selectedWalletAccountId)` keep
   * working unchanged after the refactor.
   */
  readonly selectedWalletAccountId: string | null;
  /**
   * The user's multi-selection set. ALWAYS contains ≥ 1 entry after
   * the first sync; the reconciler reseeds with the primary if a
   * caller would otherwise leave it empty.
   */
  readonly multiSelectedWalletAccountIds: ReadonlyArray<string>;
  /**
   * Switch the store's persistence key to a new Clerk user. Clears
   * the in-memory selection and re-reads from localStorage. Called
   * once by `useSyncSelectedWallet` whenever the Clerk user changes
   * (sign-in, sign-out, account switch).
   */
  bindClerkUser(clerkUserId: string | null): void;
  /**
   * Replace the multi-selection set. Empty arrays are silently
   * dropped via the `fallbackPrimaryId` argument (see overload below);
   * the bare setter (no fallback) preserves an empty set ONLY in
   * unit-test contexts where the test author opts into the bare
   * behaviour to exercise the reconciler.
   */
  setMultiSelectedWalletAccountIds(
    ids: ReadonlyArray<string>,
    fallbackPrimaryId?: string | null,
  ): void;
  /**
   * Legacy compat: callers that focus on one wallet (e.g. the
   * `WalletPanel` dropdown, the archive flow) collapse the
   * multi-set to a single id. Passing `null` clears the set and
   * leaves the sync hook to reseed with the user's primary.
   * Equivalent to `setMultiSelectedWalletAccountIds(id == null ? []
   * : [id])`.
   */
  setSelectedWalletAccountId(walletAccountId: string | null): void;
}

function multiStorageKey(clerkUserId: string): string {
  return STORAGE_PREFIX_MULTI + clerkUserId;
}
function singleStorageKey(clerkUserId: string): string {
  return STORAGE_PREFIX + clerkUserId;
}

function readPersistedMulti(clerkUserId: string | null): ReadonlyArray<string> {
  if (clerkUserId === null) return [];
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(multiStorageKey(clerkUserId));
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const id of parsed) {
      if (typeof id === 'string' && id.length > 0) out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

function writePersistedMulti(
  clerkUserId: string | null,
  ids: ReadonlyArray<string>,
): void {
  if (clerkUserId === null) return;
  if (typeof window === 'undefined') return;
  try {
    const key = multiStorageKey(clerkUserId);
    if (ids.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(ids));
    }
  } catch {
    // localStorage may be disabled (private mode, quota). The store
    // still works in memory; we just lose persistence across reloads.
  }
}

function readPersistedSingle(clerkUserId: string | null): string | null {
  if (clerkUserId === null) return null;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(singleStorageKey(clerkUserId));
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function writePersistedSingle(
  clerkUserId: string | null,
  walletAccountId: string | null,
): void {
  if (clerkUserId === null) return;
  if (typeof window === 'undefined') return;
  try {
    const key = singleStorageKey(clerkUserId);
    if (walletAccountId === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, walletAccountId);
    }
  } catch {
    // see above
  }
}

function dedupeIds(ids: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Read the last-known selection from `localStorage` via the `last-user-id`
 * pointer. Used by `useSyncSelectedWallet` to seed the store in a post-mount
 * effect (NOT at module load): seeding the store's initial state would diverge
 * from the server-rendered empty state and trip a hydration mismatch on
 * surfaces that render the selection synchronously (e.g. `WalletCountButton`'s
 * count). Seeding after the first render keeps SSR and the first client render
 * identical, then fills the selection before Clerk reports — covering the cold
 * window so an early quick-buy honors a persisted multi-wallet selection.
 */
function readInitialSelection(): { multi: ReadonlyArray<string>; head: string | null } {
  if (typeof window === 'undefined') return { multi: [], head: null };
  try {
    const lastUserId = window.localStorage.getItem(LAST_USER_ID_KEY);
    if (!lastUserId) return { multi: [], head: null };
    let multi = readPersistedMulti(lastUserId);
    if (multi.length === 0) {
      const single = readPersistedSingle(lastUserId);
      if (typeof single === 'string') multi = [single];
    }
    multi = dedupeIds(multi);
    return { multi, head: multi.length > 0 ? (multi[0] ?? null) : null };
  } catch {
    return { multi: [], head: null };
  }
}

export const useSelectedWalletStore = create<SelectedWalletState>((set, get) => ({
  clerkUserId: null,
  selectedWalletAccountId: null,
  multiSelectedWalletAccountIds: [],
  bindClerkUser: (clerkUserId) => {
    const prev = get().clerkUserId;
    if (prev === clerkUserId) return;
    // Persist the active-user pointer so the NEXT cold load can seed the
    // selection synchronously (see `readInitialSelection`).
    if (clerkUserId !== null && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LAST_USER_ID_KEY, clerkUserId);
      } catch {
        // Best-effort; the gate fallback still covers an unseeded first paint.
      }
    }
    // Hydrate from localStorage. The multi-set is the source of truth;
    // when it exists we mirror its head to `selectedWalletAccountId`.
    // Legacy single-key persistence is kept as a fallback so users
    // upgrading from the pre-refactor build do not lose their stored
    // focused wallet.
    const persistedMulti = readPersistedMulti(clerkUserId);
    const persistedSingle = readPersistedSingle(clerkUserId);
    let multi: ReadonlyArray<string> = persistedMulti;
    if (multi.length === 0 && typeof persistedSingle === 'string') {
      multi = [persistedSingle];
    }
    multi = dedupeIds(multi);
    set({
      clerkUserId,
      multiSelectedWalletAccountIds: Object.freeze([...multi]),
      selectedWalletAccountId: multi.length > 0 ? (multi[0] ?? null) : null,
    });
  },
  setMultiSelectedWalletAccountIds: (ids, fallbackPrimaryId) => {
    /*
     * `fallbackPrimaryId` is now opt IN, not automatic: a caller that
     * wants the primary back when the set empties passes it, and a
     * caller that means empty passes nothing. The wallets table means
     * empty.
     */
    let next = dedupeIds(ids);
    if (next.length === 0 && typeof fallbackPrimaryId === 'string' && fallbackPrimaryId.length > 0) {
      next = [fallbackPrimaryId];
    }
    const { clerkUserId } = get();
    writePersistedMulti(clerkUserId, next);
    const head: string | null = next.length > 0 ? (next[0] ?? null) : null;
    writePersistedSingle(clerkUserId, head);
    set({
      multiSelectedWalletAccountIds: Object.freeze(next),
      selectedWalletAccountId: head,
    });
  },
  setSelectedWalletAccountId: (walletAccountId) => {
    const next = walletAccountId === null ? [] : [walletAccountId];
    const { clerkUserId } = get();
    writePersistedMulti(clerkUserId, next);
    writePersistedSingle(clerkUserId, walletAccountId);
    set({
      multiSelectedWalletAccountIds: Object.freeze(next),
      selectedWalletAccountId: walletAccountId,
    });
  },
}));

/**
 * Imperative read for non-React call sites (event handlers, hot
 * paths). Mirrors `getClerkSession()` in the sibling store.
 */
export function getSelectedWalletAccountId(): string | null {
  return useSelectedWalletStore.getState().selectedWalletAccountId;
}

/** Test-only: reset to initial state between cases. */
export function _resetSelectedWalletStoreForTests(): void {
  useSelectedWalletStore.setState({
    clerkUserId: null,
    selectedWalletAccountId: null,
    multiSelectedWalletAccountIds: Object.freeze([]),
  });
}

/**
 * Slice "Multi-wallet split buy/sell orders": filters a candidate
 * set down to ids that resolve to eligible wallets. Pure; used by
 * the multi-mode reconciler to drop ids that fell out of
 * `/me.wallets` (admin archived, deleted) so the submit body
 * never contains stale references.
 */
export function reconcileMultiSelection(
  wallets: ReadonlyArray<MeWalletEntry>,
  ids: ReadonlyArray<string>,
): string[] {
  const eligibleSet = new Set(
    wallets.filter(isEligibleWallet).map((w) => w.wallet_account_id),
  );
  return ids.filter((id) => eligibleSet.has(id));
}

interface SyncSelectedWalletInput {
  readonly clerkUserId: string | null;
  readonly wallets: ReadonlyArray<MeWalletEntry>;
  readonly storedMultiIds: ReadonlyArray<string>;
}

export type SyncDecision =
  | { kind: 'noop' }
  | { kind: 'rebind'; clerkUserId: string | null }
  /**
   * Replace the multi-selection set. Always non-empty when an
   * eligible default exists; falls back to `[]` ONLY when the user
   * literally has zero eligible wallets (pre-provisioning).
   */
  | { kind: 'set_multi'; ids: ReadonlyArray<string> };

/**
 * Pure reconciliation logic. The hook below wires this to React,
 * but the decision table is exported for unit tests.
 *
 *   - When the Clerk user changes, `rebind` is emitted first; the
 *     hook calls `bindClerkUser`, then re-runs the decision against
 *     the freshly-read persisted multi-set.
 *   - When the stored multi-set has ineligible entries (or is
 *     empty), `set_multi` is emitted with a reconciled, primary-seeded
 *     replacement.
 *   - Otherwise `noop`.
 */
export function decideSyncSelectedWallet(
  input: SyncSelectedWalletInput & { boundClerkUserId: string | null },
): SyncDecision {
  if (input.boundClerkUserId !== input.clerkUserId) {
    return { kind: 'rebind', clerkUserId: input.clerkUserId };
  }
  const reconciled = reconcileMultiSelection(input.wallets, input.storedMultiIds);
  /*
   * AN EMPTY SET THE USER MADE IS RESPECTED.
   *
   * This reseeded the primary whenever the selection was empty, which
   * made "no wallets selected" a state the product could not be in:
   * unselecting the last row snapped straight back, and the box that
   * did it looked broken. Empty is now only overridden when the stored
   * set had entries and every one of them turned out to be ineligible —
   * a selection that went stale, not a selection you cleared.
   */
  if (reconciled.length === 0 && input.storedMultiIds.length === 0) {
    return { kind: 'noop' };
  }
  if (reconciled.length === 0) {
    const fallback = pickDefaultSelectedWallet(input.wallets);
    if (fallback === null) {
      // Pre-provisioning: the user has no eligible wallets at all.
      // Only emit `set_multi` when the stored set already disagrees
      // with the empty target so we don't loop.
      return input.storedMultiIds.length === 0
        ? { kind: 'noop' }
        : { kind: 'set_multi', ids: [] };
    }
    return { kind: 'set_multi', ids: [fallback.wallet_account_id] };
  }
  // Reconciled set matches stored exactly → no-op. Otherwise replace.
  if (
    reconciled.length === input.storedMultiIds.length &&
    reconciled.every((id, idx) => id === input.storedMultiIds[idx])
  ) {
    return { kind: 'noop' };
  }
  return { kind: 'set_multi', ids: reconciled };
}

/**
 * Hook that reconciles the persisted selection with the live
 * `/me.wallets` list. Mounts once at `TerminalShell` so every
 * consumer of the store sees a coherent value.
 *
 * Pre-state (`me` reauth_required / undefined) is a no-op: we never
 * clobber the user's selection on a transient `/me` failure.
 */
export function useSyncSelectedWallet(input: {
  clerkUserId: string | null;
  wallets: ReadonlyArray<MeWalletEntry> | null;
}): void {
  const boundClerkUserId = useSelectedWalletStore((s) => s.clerkUserId);
  const stored = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const bindClerkUser = useSelectedWalletStore((s) => s.bindClerkUser);
  const setMultiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.setMultiSelectedWalletAccountIds,
  );

  // One-time, hydration-safe seed: AFTER the first render (so SSR and the first
  // client render stay identical — synchronous consumers like
  // `WalletCountButton` render the same empty count on both), restore the
  // persisted selection from the `last-user-id` pointer if the store is still
  // empty/unbound. This covers the cold window between mount and Clerk loading
  // so an early Discover quick-buy honors a persisted multi-wallet selection
  // instead of defaulting to a single wallet. Persisted writes are no-ops while
  // `clerkUserId` is null; `bindClerkUser` re-reads + persists once the user is
  // known, and the reconcile effect drops any ids no longer eligible.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const state = useSelectedWalletStore.getState();
    if (
      state.clerkUserId !== null ||
      state.multiSelectedWalletAccountIds.length > 0
    ) {
      return;
    }
    const seed = readInitialSelection();
    if (seed.multi.length > 0) {
      state.setMultiSelectedWalletAccountIds(seed.multi);
    }
  }, []);

  useEffect(() => {
    if (boundClerkUserId !== input.clerkUserId) {
      bindClerkUser(input.clerkUserId);
    }
  }, [boundClerkUserId, input.clerkUserId, bindClerkUser]);

  useEffect(() => {
    if (input.wallets === null) return;
    const decision = decideSyncSelectedWallet({
      boundClerkUserId,
      clerkUserId: input.clerkUserId,
      wallets: input.wallets,
      storedMultiIds: stored,
    });
    if (decision.kind === 'set_multi') {
      // `setMultiSelectedWalletAccountIds` does NOT apply a fallback
      // here — the reconciler already produced the desired set
      // (possibly empty when the user has zero eligible wallets).
      setMultiSelectedWalletAccountIds(decision.ids);
    }
    // rebind is handled by the binding effect above so the next
    // render runs against the freshly-bound store.
  }, [
    boundClerkUserId,
    input.clerkUserId,
    input.wallets,
    stored,
    setMultiSelectedWalletAccountIds,
  ]);
}
