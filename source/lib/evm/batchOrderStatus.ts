'use client';

import {
  buildEvmBatchOrderBody,
  evmBatchOrderFingerprint,
  type EvmBatchOrderInput,
  type EvmBatchOrderStatusResult,
} from './batchOrderApi';

export const PENDING_EVM_BATCH_PREFIX = 'listen.evm.pending-batch.v1:';
export const MAX_PENDING_EVM_BATCHES = 16;

export interface PendingEvmBatchOrder {
  readonly input: EvmBatchOrderInput;
  readonly fingerprint: string;
}

type ReadStorage = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
type WriteStorage = ReadStorage & Pick<Storage, 'setItem' | 'removeItem'>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storageKey(chain: string, clientParentId: string): string {
  return `${PENDING_EVM_BATCH_PREFIX}${encodeURIComponent(chain)}:${encodeURIComponent(clientParentId)}`;
}

function keys(storage: ReadStorage): string[] {
  if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const result: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PENDING_EVM_BATCH_PREFIX)) result.push(key);
  }
  return result;
}

function parsePending(value: unknown): PendingEvmBatchOrder | null {
  const row = record(value);
  const input = record(row?.['input']);
  const fingerprint = row?.['fingerprint'];
  if (input === null || typeof fingerprint !== 'string') return null;
  const candidate = input as unknown as EvmBatchOrderInput;
  const built = buildEvmBatchOrderBody(candidate);
  if (built.kind !== 'ok' || evmBatchOrderFingerprint(built.body) !== fingerprint) return null;
  return { input: candidate, fingerprint };
}

export function readPendingEvmBatchOrders(storage: ReadStorage): PendingEvmBatchOrder[] {
  try {
    const rows: Array<PendingEvmBatchOrder & { storedAtMs: number }> = [];
    for (const key of keys(storage)) {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const parsedJson: unknown = JSON.parse(raw);
      const parsed = parsePending(parsedJson);
      if (parsed === null) continue;
      const storedAtMs = record(parsedJson)?.['storedAtMs'];
      rows.push({
        ...parsed,
        storedAtMs: typeof storedAtMs === 'number' && Number.isFinite(storedAtMs)
          ? storedAtMs
          : 0,
      });
    }
    return rows
      .sort((left, right) => right.storedAtMs - left.storedAtMs)
      .map(({ input, fingerprint }) => ({ input, fingerprint }));
  } catch {
    return [];
  }
}

export function readPendingEvmBatchOrder(
  storage: ReadStorage,
  match: { readonly chain: string; readonly token: string },
): PendingEvmBatchOrder | null {
  return readPendingEvmBatchOrders(storage).find((pending) => (
    pending.input.chain === match.chain
    && pending.input.token.toLowerCase() === match.token.toLowerCase()
  )) ?? null;
}

export function writePendingEvmBatchOrder(
  storage: WriteStorage,
  pending: PendingEvmBatchOrder,
): boolean {
  const built = buildEvmBatchOrderBody(pending.input);
  if (
    built.kind !== 'ok'
    || evmBatchOrderFingerprint(built.body) !== pending.fingerprint
  ) return false;
  try {
    const ownKey = storageKey(pending.input.chain, pending.input.clientParentId);
    const existing = keys(storage);
    if (!existing.includes(ownKey) && existing.length >= MAX_PENDING_EVM_BATCHES) return false;
    storage.setItem(ownKey, JSON.stringify({ ...pending, storedAtMs: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingEvmBatchOrder(
  storage: Pick<Storage, 'removeItem'>,
  pending: Pick<EvmBatchOrderInput, 'chain' | 'clientParentId'>,
): void {
  try {
    storage.removeItem(storageKey(pending.chain, pending.clientParentId));
  } catch {
    // A blocked storage backend must not hide the already-rendered outcome.
  }
}

export type EvmBatchPollDisposition = 'continue' | 'terminal';

/** Missing is not safe-to-retry: the original POST may still be racing its
 * durable insert. Only an authoritative terminal parent clears recovery. */
export function reconcilePendingEvmBatchStatus(
  storage: Pick<Storage, 'removeItem'>,
  pending: PendingEvmBatchOrder,
  status: EvmBatchOrderStatusResult,
): EvmBatchPollDisposition {
  if (
    status.kind !== 'found'
    || (status.parent.status !== 'filled'
      && status.parent.status !== 'partial_failed'
      && status.parent.status !== 'failed'
      && status.parent.status !== 'cancelled')
  ) return 'continue';
  clearPendingEvmBatchOrder(storage, pending.input);
  return 'terminal';
}
