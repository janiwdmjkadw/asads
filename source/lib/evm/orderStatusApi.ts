'use client';

import { fetchAuthenticatedApi } from '@/lib/api/trading';

export type EvmOrderStatus =
  | { kind: 'missing' }
  | {
      kind: 'order';
      state:
        | 'pending_dispatch'
        | 'pending_finality'
        | 'filled'
        | 'refused'
        | 'indeterminate'
        | 'unavailable';
      mayBeLive: boolean;
      safeToRetry: boolean;
      refusedReason: string | null;
      txHash: string | null;
      blockNumber: string | null;
    }
  | { kind: 'reauth' }
  | { kind: 'error'; reason: string };

export interface PendingEvmOrder {
  readonly chain: string;
  readonly token: string;
  readonly clientOrderId: string;
  readonly fingerprint: string;
  /** Wallet identity used by the POST. Optional for legacy records. */
  readonly walletAccountId?: string;
  /** Public wallet address used to bind canonicality SSE after wallet switches. */
  readonly walletAddress?: string;
}

/** Legacy single-record key. Read-only so an in-flight v1 order survives an upgrade. */
export const PENDING_EVM_ORDER_KEY = 'listen.evm.pending-order.v1';
export const PENDING_EVM_ORDER_PREFIX = 'listen.evm.pending-order.v2:';
export const MAX_PENDING_EVM_ORDERS = 32;

type PendingReadStorage = Pick<Storage, 'getItem'> &
  Partial<Pick<Storage, 'key' | 'length'>>;
type PendingWriteStorage = PendingReadStorage & Pick<Storage, 'setItem' | 'removeItem'>;

/**
 * Obtain browser storage without letting a blocked `localStorage` getter
 * crash the trade surface. Some privacy modes throw while reading the
 * property itself, before any storage method can be called.
 */
export function browserEvmOrderStorage(getter?: () => Storage): Storage | null {
  try {
    if (getter !== undefined) return getter();
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

interface StoredPendingEvmOrder extends PendingEvmOrder {
  readonly storedAtMs: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePendingEvmOrder(value: unknown): PendingEvmOrder | null {
  const candidate = record(value);
  if (
    candidate === null ||
    typeof candidate['chain'] !== 'string' ||
    typeof candidate['token'] !== 'string' ||
    typeof candidate['clientOrderId'] !== 'string' ||
    typeof candidate['fingerprint'] !== 'string'
  )
    return null;
  const walletAccountId = candidate['walletAccountId'];
  const walletAddress = candidate['walletAddress'];
  return {
    chain: candidate['chain'],
    token: candidate['token'],
    clientOrderId: candidate['clientOrderId'],
    fingerprint: candidate['fingerprint'],
    ...(typeof walletAccountId === 'string' && walletAccountId.length > 0
      ? { walletAccountId }
      : {}),
    ...(typeof walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(walletAddress)
      ? { walletAddress: walletAddress.toLowerCase() }
      : {}),
  };
}

function pendingOrderStorageKey(order: Pick<PendingEvmOrder, 'chain' | 'clientOrderId'>): string {
  return `${PENDING_EVM_ORDER_PREFIX}${encodeURIComponent(order.chain)}:${encodeURIComponent(order.clientOrderId)}`;
}

function storageKeys(storage: PendingReadStorage): string[] {
  if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PENDING_EVM_ORDER_PREFIX)) keys.push(key);
  }
  return keys;
}

export function readPendingEvmOrders(storage: PendingReadStorage): PendingEvmOrder[] {
  try {
    const entries: Array<{ order: PendingEvmOrder; storedAtMs: number }> = [];
    for (const key of storageKeys(storage)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const value = record(JSON.parse(raw));
      const order = parsePendingEvmOrder(value);
      if (order === null) continue;
      entries.push({
        order,
        storedAtMs:
          typeof value?.['storedAtMs'] === 'number' && Number.isFinite(value['storedAtMs'])
            ? value['storedAtMs']
            : 0,
      });
    }

    const legacyRaw = storage.getItem(PENDING_EVM_ORDER_KEY);
    if (legacyRaw !== null) {
      const legacy = parsePendingEvmOrder(JSON.parse(legacyRaw));
      if (legacy !== null) entries.push({ order: legacy, storedAtMs: -1 });
    }

    const seen = new Set<string>();
    return entries
      .sort((left, right) => right.storedAtMs - left.storedAtMs)
      .map(({ order }) => order)
      .filter((order) => {
        const identity = `${order.chain}\0${order.clientOrderId}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
  } catch {
    return [];
  }
}

export function readPendingEvmOrder(
  storage: PendingReadStorage,
  match?: Readonly<Pick<PendingEvmOrder, 'chain' | 'token'>>,
): PendingEvmOrder | null {
  return (
    readPendingEvmOrders(storage).find(
      (order) => match === undefined || (
        order.chain === match.chain
        && order.token.toLowerCase() === match.token.toLowerCase()
      ),
    ) ?? null
  );
}

export function writePendingEvmOrder(
  storage: PendingWriteStorage,
  order: PendingEvmOrder,
): boolean {
  try {
    const ownKey = pendingOrderStorageKey(order);
    const existingKeys = storageKeys(storage);
    // Every persisted entry is an unresolved live-money recovery handle. If
    // the bounded set is full, refuse the NEW order before its POST rather
    // than deleting the oldest handle and losing the only browser-side path
    // to reconcile a transaction that may still be live. Refreshing an
    // existing handle remains allowed.
    if (!existingKeys.includes(ownKey) && existingKeys.length >= MAX_PENDING_EVM_ORDERS) {
      return false;
    }
    const value: StoredPendingEvmOrder = { ...order, storedAtMs: Date.now() };
    storage.setItem(ownKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingEvmOrder(
  storage: Pick<Storage, 'removeItem'> & Partial<Pick<Storage, 'getItem'>>,
  order: Pick<PendingEvmOrder, 'chain' | 'clientOrderId'>,
): void {
  try {
    storage.removeItem(pendingOrderStorageKey(order));
    const legacyRaw = storage.getItem?.(PENDING_EVM_ORDER_KEY);
    if (legacyRaw !== undefined && legacyRaw !== null) {
      const legacy = parsePendingEvmOrder(JSON.parse(legacyRaw));
      if (legacy?.chain === order.chain && legacy.clientOrderId === order.clientOrderId) {
        storage.removeItem(PENDING_EVM_ORDER_KEY);
      }
    }
  } catch {
    // A blocked storage backend must not hide an already-known order outcome.
  }
}

export type EvmOrderPollDisposition = 'continue' | 'filled' | 'refused' | 'safe_to_retry';

/**
 * Apply one authoritative poll to a durable browser recovery handle.
 * Non-terminal/unknown answers retain the handle so a reload keeps polling;
 * only a proven terminal or explicitly safe retry clears this exact order.
 */
export function reconcilePendingEvmOrderStatus(
  storage: Pick<Storage, 'removeItem'> & Partial<Pick<Storage, 'getItem'>>,
  pending: Pick<PendingEvmOrder, 'chain' | 'clientOrderId'>,
  status: EvmOrderStatus,
): EvmOrderPollDisposition {
  let disposition: EvmOrderPollDisposition = 'continue';
  if (status.kind === 'order' && status.state === 'filled') disposition = 'filled';
  else if (status.kind === 'order' && status.state === 'refused') disposition = 'refused';
  else if (status.kind === 'order' && status.safeToRetry && !status.mayBeLive) {
    disposition = 'safe_to_retry';
  }
  if (disposition !== 'continue') clearPendingEvmOrder(storage, pending);
  return disposition;
}

export function parseEvmOrderStatusResponse(
  body: Record<string, unknown> | null,
  httpStatus: number,
  expected?: {
    readonly chain: string;
    readonly clientOrderId: string;
    readonly token?: string;
  },
): EvmOrderStatus {
  if (body?.['reauth_required'] === true) return { kind: 'reauth' };
  if (httpStatus < 200 || httpStatus >= 300 || body === null) {
    return { kind: 'error', reason: `http_${httpStatus}` };
  }
  const chain = body['chain'];
  if (
    (chain !== 'bsc' && chain !== 'robinhood_chain')
    || (expected !== undefined && chain !== expected.chain)
  ) {
    return { kind: 'error', reason: 'subject_mismatch' };
  }
  if (body['found'] === false) return { kind: 'missing' };
  const order = record(body['order']);
  const state = order?.['state'];
  const clientOrderId = order?.['client_order_id'];
  const token = order?.['token'];
  if (
    order === null ||
    (state !== 'pending_dispatch' &&
      state !== 'pending_finality' &&
      state !== 'filled' &&
      state !== 'refused' &&
      state !== 'indeterminate' &&
      state !== 'unavailable') ||
    typeof order['may_be_live'] !== 'boolean' ||
    typeof order['safe_to_retry'] !== 'boolean' ||
    typeof clientOrderId !== 'string' ||
    !(token === null || (typeof token === 'string' && /^0x[0-9a-fA-F]{40}$/.test(token))) ||
    (expected !== undefined && clientOrderId !== expected.clientOrderId) ||
    (expected?.token !== undefined && (
      typeof token !== 'string' || token.toLowerCase() !== expected.token.toLowerCase()
    )) ||
    !Array.isArray(order['fills'])
  )
    return { kind: 'error', reason: 'shape_mismatch' };
  const fills = order['fills'];
  for (const rawFill of fills) {
    const fill = record(rawFill);
    if (
      fill === null
      || fill['chain'] !== chain
      || (typeof token === 'string' && (
        typeof fill['token'] !== 'string'
        || fill['token'].toLowerCase() !== token.toLowerCase()
      ))
    ) {
      return { kind: 'error', reason: 'fill_subject_mismatch' };
    }
  }
  const firstFill = fills.length > 0 ? record(fills[0]) : null;
  if ((state === 'filled') !== (firstFill !== null)) {
    return { kind: 'error', reason: 'fill_state_mismatch' };
  }
  const txHash = firstFill?.['tx_hash'];
  const blockNumber = firstFill?.['block_number'];
  if (
    firstFill !== null
    && (
      typeof txHash !== 'string'
      || !/^0x[0-9a-fA-F]{64}$/.test(txHash)
      || typeof blockNumber !== 'string'
      || !/^\d+$/.test(blockNumber)
    )
  ) {
    return { kind: 'error', reason: 'fill_shape_mismatch' };
  }
  return {
    kind: 'order',
    state,
    mayBeLive: order['may_be_live'],
    safeToRetry: order['safe_to_retry'],
    refusedReason: typeof order['refused_reason'] === 'string' ? order['refused_reason'] : null,
    txHash: typeof txHash === 'string' ? txHash : null,
    blockNumber: typeof blockNumber === 'string' ? blockNumber : null,
  };
}

export async function fetchEvmOrderStatus(
  chain: string,
  clientOrderId: string,
  signal?: AbortSignal,
  token?: string,
): Promise<EvmOrderStatus> {
  try {
    const query = new URLSearchParams({ chain, client_order_id: clientOrderId });
    const response = await fetchAuthenticatedApi(
      `/api/v1/evm/trade/order-status?${query}`,
      { method: 'GET' },
      { signal },
    );
    const body = record(await response.json().catch(() => null));
    return parseEvmOrderStatusResponse(body, response.status, { chain, clientOrderId, token });
  } catch (error) {
    if (signal?.aborted) return { kind: 'error', reason: 'aborted' };
    return { kind: 'error', reason: (error as Error).message || 'network_error' };
  }
}
