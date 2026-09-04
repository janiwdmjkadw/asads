'use client';

import { tradingApiUrl } from '@/lib/api/trading';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ORDER_EVENT_KINDS = new Set([
  'confirmed',
  'refused',
  'ambiguous',
  'resolved',
  'finalized',
  'reorged',
] as const);

export type EvmOrderEventKind =
  | 'confirmed'
  | 'refused'
  | 'ambiguous'
  | 'resolved'
  | 'finalized'
  | 'reorged';

export interface EvmOrderEvent {
  readonly chain: 'bsc' | 'robinhood_chain';
  readonly wallet: string;
  readonly kind: EvmOrderEventKind;
  /** Some receipt-poller events cannot carry the originating client id. */
  readonly clientOrderId: string | null;
  readonly txHash: string | null;
  readonly blockNumber: number | null;
  readonly nonce: number | null;
  readonly detail: string | null;
  readonly afterFinality: boolean | null;
}

export type EvmOrderEventsResnapshotReason =
  | 'hello'
  | 'snapshot_required'
  | 'epoch_changed'
  | 'malformed_order';

interface EvmOrderEventsHandlers {
  readonly onOrder: (event: EvmOrderEvent) => void;
  /** Refetch the durable order-status record; never infer finality from SSE alone. */
  readonly onResnapshot: (reason: EvmOrderEventsResnapshotReason) => void;
}

interface OpenEvmOrderEventsOptions {
  readonly chain: 'bsc' | 'robinhood_chain';
  readonly wallet: string;
  readonly handlers: EvmOrderEventsHandlers;
  /** Test injection. Defaults to the browser EventSource implementation. */
  readonly eventSourceImpl?: typeof EventSource;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalU64(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Parse one lifecycle frame without ever using its JSON `epoch`/`seq` as a
 * cursor. Those are u64 values and JavaScript cannot represent every u64
 * exactly; the native EventSource owns the exact textual SSE `id` and sends
 * it back as `Last-Event-ID` on reconnect.
 */
export function parseEvmOrderEvent(
  data: string,
  expected: { chain: string; wallet: string },
): EvmOrderEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const raw = record(parsed);
  if (raw === null || raw['v'] !== 1) return null;

  const chain = raw['chain'];
  const wallet = raw['wallet'];
  const kind = raw['kind'];
  if (
    (chain !== 'bsc' && chain !== 'robinhood_chain')
    || chain !== expected.chain
    || typeof wallet !== 'string'
    || !EVM_ADDRESS.test(wallet)
    || wallet.toLowerCase() !== expected.wallet.toLowerCase()
    || typeof kind !== 'string'
    || !ORDER_EVENT_KINDS.has(kind as EvmOrderEventKind)
  ) return null;

  // Validate the cursor fields even though EventSource, not application
  // JavaScript, owns cursor replay. Missing cursor fields mean this is not a
  // lifecycle frame from the promised contract.
  if (typeof optionalU64(raw['epoch']) !== 'number' || typeof optionalU64(raw['seq']) !== 'number') {
    return null;
  }
  const clientOrderId = optionalString(raw['clientOrderId']);
  const txHash = optionalString(raw['txHash']);
  const blockNumber = optionalU64(raw['blockNumber']);
  const nonce = optionalU64(raw['nonce']);
  const detail = optionalString(raw['detail']);
  const afterFinality = raw['afterFinality'];
  const occurredAtMs = optionalU64(raw['occurredAtMs']);
  if (
    clientOrderId === undefined
    || txHash === undefined
    || (txHash !== null && !EVM_TX_HASH.test(txHash))
    || blockNumber === undefined
    || nonce === undefined
    || detail === undefined
    || (afterFinality !== null && typeof afterFinality !== 'boolean')
    || typeof occurredAtMs !== 'number'
  ) return null;

  return {
    chain,
    wallet: wallet.toLowerCase(),
    kind: kind as EvmOrderEventKind,
    clientOrderId,
    txHash,
    blockNumber,
    nonce,
    detail,
    afterFinality,
  };
}

function matchesHello(data: string, expected: { chain: string; wallet: string }): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return false;
  }
  const raw = record(parsed);
  return raw !== null
    && raw['chain'] === expected.chain
    && typeof raw['wallet'] === 'string'
    && EVM_ADDRESS.test(raw['wallet'])
    && raw['wallet'].toLowerCase() === expected.wallet.toLowerCase()
    && optionalU64(raw['epoch']) !== undefined;
}

/**
 * Subscribe to the authenticated per-wallet order lifecycle feed.
 *
 * Deliberately no manual reconnect: keeping the same native EventSource lets
 * the browser preserve the exact SSE id and supply `Last-Event-ID` itself.
 */
export function openEvmOrderEvents(options: OpenEvmOrderEventsOptions): () => void {
  const EventSourceImpl = options.eventSourceImpl ?? globalThis.EventSource;
  if (typeof EventSourceImpl !== 'function' || !EVM_ADDRESS.test(options.wallet)) return () => {};

  const query = new URLSearchParams({ chain: options.chain, wallet: options.wallet.toLowerCase() });
  let source: EventSource;
  try {
    source = new EventSourceImpl(
      tradingApiUrl(`/api/v1/evm/trade/order-events?${query}`),
      { withCredentials: true },
    );
  } catch {
    return () => {};
  }
  const expected = { chain: options.chain, wallet: options.wallet };

  source.addEventListener('hello', (event) => {
    if (matchesHello((event as MessageEvent).data as string, expected)) {
      options.handlers.onResnapshot('hello');
    }
  });
  source.addEventListener('order', (event) => {
    const parsed = parseEvmOrderEvent((event as MessageEvent).data as string, expected);
    if (parsed === null) {
      options.handlers.onResnapshot('malformed_order');
      return;
    }
    options.handlers.onOrder(parsed);
  });
  source.addEventListener('snapshot_required', () => {
    options.handlers.onResnapshot('snapshot_required');
  });
  source.addEventListener('epoch_changed', () => {
    options.handlers.onResnapshot('epoch_changed');
  });

  return () => source.close();
}
