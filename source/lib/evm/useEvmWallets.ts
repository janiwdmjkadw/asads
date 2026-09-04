'use client';

/**
 * The user's EVM wallets for ONE chain, with their native balances, plus the
 * multi-wallet selection.
 *
 * Backed by `GET /api/v1/wallets/evm-balances`, which returns every EVM
 * wallet on every chain in one read. Filtering here rather than server-side
 * is deliberate: the trade panel and the wallets tab want the same read, and
 * one request warmed once is cheaper than two chain-scoped ones.
 *
 * SELECTION IS PER CHAIN AND PERSISTED. A user who trades from their second
 * BSC wallet expects the next BSC page to open on it; they do NOT expect that
 * choice to leak onto Robinhood, where the wallet is a different account
 * entirely. The key therefore carries the chain, and a persisted id that no
 * longer resolves is DISCARDED rather than used — a stale id would submit an
 * order from a wallet the account may no longer own, which the api refuses,
 * which reads to the user as a broken button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EVM_WALLETS_CHANGED_EVENT,
  listEvmWalletBalances,
  reconcileEvmWalletsAfterCreation,
  type EvmWalletBalance,
  type EvmWalletBalancesResult,
} from '@/lib/api/evm-wallet-balances';
import { getRuntimeConfig } from '@/lib/runtime-config';

export const EVM_WALLET_SELECTION_KEY_PREFIX = 'evm.wallet.selected.';
export const EVM_MULTI_WALLET_SELECTION_KEY_PREFIX = 'evm.wallet.multiSelected.';

type EvmWalletSelectionStorage = Pick<Storage, 'getItem'>;

/** Read the persisted per-chain wallet choice without letting blocked browser
 * storage break the trade surface. Exported so Discover quick-buy and the
 * trade panel resolve the same wallet instead of each inventing a default. */
export function readEvmWalletSelection(
  storage: EvmWalletSelectionStorage | null | undefined,
  chain: string,
): string | null {
  if (storage == null) return null;
  try {
    return storage.getItem(`${EVM_WALLET_SELECTION_KEY_PREFIX}${chain}`);
  } catch {
    return null;
  }
}

/** Resolve a stored id only inside the requested chain's trade-eligible set.
 * A stale/cross-chain id is discarded and falls back to the first eligible
 * row, matching the selector rendered by `useEvmWallets`. */
export function pickEvmWalletForChain(
  balances: readonly EvmWalletBalance[],
  chain: string,
  selectedWalletAccountId: string | null,
): EvmWalletBalance | null {
  const eligible = balances.filter((row) => row.chain === chain && row.trade_eligible);
  if (eligible.length === 0) return null;
  return (
    eligible.find((row) => row.wallet_account_id === selectedWalletAccountId)
    ?? eligible[0]
    ?? null
  );
}

/** Decode the ordered multi-wallet subject without trusting browser storage.
 * Eligibility and chain ownership are reconciled separately against the
 * authenticated wallet response. */
export function readEvmMultiWalletSelection(
  storage: EvmWalletSelectionStorage | null | undefined,
  chain: string,
): readonly string[] {
  if (storage == null) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(`${EVM_MULTI_WALLET_SELECTION_KEY_PREFIX}${chain}`) ?? '[]',
    );
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

/** Keep only unique, eligible wallets on this chain, preserving order. A
 * missing/stale selection falls back to the legacy single choice, then the
 * first eligible row, so the order subject is never silently cross-chain. */
export function reconcileEvmWalletSelection(
  balances: readonly EvmWalletBalance[],
  chain: string,
  requestedIds: readonly string[],
  legacySelectedId: string | null,
  maxWallets: number,
): readonly EvmWalletBalance[] {
  const eligible = balances.filter((row) => row.chain === chain && row.trade_eligible);
  if (eligible.length === 0) return [];
  const byId = new Map(eligible.map((wallet) => [wallet.wallet_account_id, wallet]));
  const cap = Math.min(100, Math.max(1, Math.floor(maxWallets)));
  const seen = new Set<string>();
  const selected: EvmWalletBalance[] = [];
  for (const id of requestedIds) {
    const wallet = byId.get(id);
    if (wallet === undefined || seen.has(id)) continue;
    seen.add(id);
    selected.push(wallet);
    if (selected.length === cap) break;
  }
  if (selected.length > 0) return selected;
  return [byId.get(legacySelectedId ?? '') ?? eligible[0]!];
}

export type EvmWalletsState =
  | { kind: 'loading' }
  /** Session problem — NOT "you have no wallets". Different remedy. */
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; detail: string }
  | { kind: 'ready'; wallets: readonly EvmWalletBalance[] };

function readStored(chain: string): string | null {
  try {
    return readEvmWalletSelection(globalThis.localStorage, chain);
  } catch {
    // Private-mode / blocked storage is not an error worth surfacing; the
    // selection simply does not persist.
    return null;
  }
}

function readStoredMany(chain: string): readonly string[] {
  try {
    return readEvmMultiWalletSelection(globalThis.localStorage, chain);
  } catch {
    return [];
  }
}

function writeStored(chain: string, walletAccountIds: readonly string[]): void {
  const first = walletAccountIds[0];
  if (first === undefined) return;
  try {
    globalThis.localStorage?.setItem(
      `${EVM_WALLET_SELECTION_KEY_PREFIX}${chain}`,
      first,
    );
    globalThis.localStorage?.setItem(
      `${EVM_MULTI_WALLET_SELECTION_KEY_PREFIX}${chain}`,
      JSON.stringify(walletAccountIds),
    );
  } catch {
    /* see readStored */
  }
}

export interface UseEvmWalletsResult {
  readonly state: EvmWalletsState;
  /** The wallet an order would be submitted from, or `null`. */
  readonly selected: EvmWalletBalance | null;
  /** Ordered exact batch subject. The first row is always `selected`. */
  readonly selectedWallets: readonly EvmWalletBalance[];
  readonly select: (walletAccountId: string) => void;
  readonly selectMany: (walletAccountIds: readonly string[]) => void;
  readonly maxWallets: number;
  readonly reload: () => void;
}

export function useEvmWallets(
  chain: string,
  loader?: () => Promise<EvmWalletBalancesResult>,
): UseEvmWalletsResult {
  const [result, setResult] = useState<EvmWalletBalancesResult | null>(null);
  const resultRef = useRef<EvmWalletBalancesResult | null>(null);
  resultRef.current = result;
  const [reloadRequest, setReloadRequest] = useState({ sequence: 0, reconcile: false });
  const [chosenIds, setChosenIds] = useState<readonly string[]>([]);
  const maxWallets = Math.min(
    100,
    Math.max(1, Math.floor(getRuntimeConfig().batchOrdersMaxWallets)),
  );

  useEffect(() => {
    // A chain change invalidates the choice: wallet ids are per chain.
    const storedMany = readStoredMany(chain);
    const storedOne = readStored(chain);
    setChosenIds(storedMany.length > 0 ? storedMany : storedOne === null ? [] : [storedOne]);
  }, [chain]);

  useEffect(() => {
    const controller = new AbortController();
    const load = loader ?? (() => listEvmWalletBalances({ signal: controller.signal }));
    const request = reloadRequest.reconcile
      ? reconcileEvmWalletsAfterCreation({
          previous: resultRef.current,
          load,
          signal: controller.signal,
        })
      : load();
    void request.then(
      (next) => {
        if (!controller.signal.aborted && next !== null) setResult(next);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            kind: 'network_error',
            reason: (error as Error)?.message ?? 'network error',
          });
        }
      },
    );
    return () => controller.abort();
  }, [loader, reloadRequest]);

  const state = useMemo<EvmWalletsState>(() => {
    if (result === null) return { kind: 'loading' };
    switch (result.kind) {
      case 'ok':
        return {
          kind: 'ready',
          wallets: result.balances.filter((row) => row.chain === chain && row.trade_eligible),
        };
      case 'reauth':
        return { kind: 'reauth', reason: result.reason };
      case 'error':
        return { kind: 'error', detail: `HTTP ${result.status} (${result.errorCode})` };
      case 'network_error':
        return { kind: 'error', detail: result.reason };
    }
  }, [result, chain]);

  // Derived inside the memo, not above it: a fresh `[]` on every render would
  // change the dependency identity and defeat the memo entirely.
  const selectedWallets = useMemo(() => {
    const wallets = state.kind === 'ready' ? state.wallets : [];
    return reconcileEvmWalletSelection(
      wallets,
      chain,
      chosenIds,
      readStored(chain),
      maxWallets,
    );
  }, [state, chain, chosenIds, maxWallets]);
  const selected = selectedWallets[0] ?? null;

  const select = useCallback(
    (walletAccountId: string) => {
      setChosenIds([walletAccountId]);
      writeStored(chain, [walletAccountId]);
    },
    [chain],
  );

  const selectMany = useCallback(
    (walletAccountIds: readonly string[]) => {
      const wallets = state.kind === 'ready' ? state.wallets : [];
      const next = reconcileEvmWalletSelection(
        wallets,
        chain,
        walletAccountIds,
        selected?.wallet_account_id ?? readStored(chain),
        maxWallets,
      );
      const nextIds = next.map((wallet) => wallet.wallet_account_id);
      setChosenIds(nextIds);
      writeStored(chain, nextIds);
    },
    [chain, maxWallets, selected?.wallet_account_id, state],
  );

  useEffect(() => {
    if (state.kind !== 'ready' || selectedWallets.length === 0) return;
    const selectedIds = selectedWallets.map((wallet) => wallet.wallet_account_id);
    if (
      chosenIds.length === selectedIds.length
      && chosenIds.every((id, index) => id === selectedIds[index])
    ) return;
    setChosenIds(selectedIds);
    writeStored(chain, selectedIds);
  }, [chain, chosenIds, selectedWallets, state.kind]);

  const reload = useCallback(
    () => setReloadRequest((request) => ({ sequence: request.sequence + 1, reconcile: false })),
    [],
  );

  useEffect(() => {
    const reconcile = () => {
      setReloadRequest((request) => ({ sequence: request.sequence + 1, reconcile: true }));
    };
    globalThis.addEventListener(EVM_WALLETS_CHANGED_EVENT, reconcile);
    return () => globalThis.removeEventListener(EVM_WALLETS_CHANGED_EVENT, reconcile);
  }, []);

  return { state, selected, selectedWallets, select, selectMany, maxWallets, reload };
}
