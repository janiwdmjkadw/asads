/**
 * Slice "Portfolio page wallets tab": pure helper that turns the
 * TransferRail's `(sources, destinations, totalLamports)` selection
 * into a flat list of `(source, destination, lamports)` pairs the
 * caller can fire through the existing `transferSol()` API client.
 *
 * The router covers the three sensible cases:
 *   - 1 source -> 1 dest:  single call carrying the full amount.
 *   - N sources -> 1 dest: each source contributes `totalLamports / N`
 *                          (carry the remainder on the first source).
 *   - 1 source -> M dests: source pays out `totalLamports / M` to each
 *                          destination (remainder on the first dest).
 *   - N -> M with both sides > 1: not supported; returns
 *                          `{ kind: 'unsupported' }` so the UI can
 *                          surface a friendly message.
 *
 * `totalLamports` must be a positive integer-typed bigint. Negative,
 * zero, or non-finite values return `{ kind: 'invalid_amount' }`.
 */

export interface TransferPair {
  readonly sourceWalletAccountId: string;
  readonly destinationWalletAccountId: string;
  readonly lamports: bigint;
}

export type TransferPlan =
  | { kind: 'ok'; pairs: ReadonlyArray<TransferPair> }
  | { kind: 'empty_sources' }
  | { kind: 'empty_destinations' }
  | { kind: 'invalid_amount' }
  /** Total is smaller than the fan-out count — some shares would be 0 lamports. */
  | { kind: 'amount_too_small'; fanOutCount: number }
  | { kind: 'self_transfer' }
  | { kind: 'unsupported' };

export function partitionTransfer(input: {
  readonly sources: ReadonlyArray<string>;
  readonly destinations: ReadonlyArray<string>;
  readonly totalLamports: bigint;
}): TransferPlan {
  if (input.sources.length === 0) return { kind: 'empty_sources' };
  if (input.destinations.length === 0) return { kind: 'empty_destinations' };
  if (input.totalLamports <= 0n) return { kind: 'invalid_amount' };

  // A wallet cannot transfer to itself in any of the supported shapes.
  for (const src of input.sources) {
    for (const dst of input.destinations) {
      if (src === dst) return { kind: 'self_transfer' };
    }
  }

  // Case 1: N -> 1 (includes 1 -> 1).
  if (input.destinations.length === 1) {
    const dest = input.destinations[0]!;
    if (input.totalLamports < BigInt(input.sources.length)) {
      // Splitting would yield 0-lamport shares the API rejects per-row.
      return { kind: 'amount_too_small', fanOutCount: input.sources.length };
    }
    const n = BigInt(input.sources.length);
    const base = input.totalLamports / n;
    const remainder = input.totalLamports - base * n;
    const pairs: TransferPair[] = input.sources.map((src, idx) => ({
      sourceWalletAccountId: src,
      destinationWalletAccountId: dest,
      lamports: base + (BigInt(idx) < remainder ? 1n : 0n),
    }));
    return { kind: 'ok', pairs };
  }

  // Case 2: 1 -> M.
  if (input.sources.length === 1) {
    const src = input.sources[0]!;
    if (input.totalLamports < BigInt(input.destinations.length)) {
      // Splitting would yield 0-lamport shares the API rejects per-row.
      return { kind: 'amount_too_small', fanOutCount: input.destinations.length };
    }
    const m = BigInt(input.destinations.length);
    const base = input.totalLamports / m;
    const remainder = input.totalLamports - base * m;
    const pairs: TransferPair[] = input.destinations.map((dst, idx) => ({
      sourceWalletAccountId: src,
      destinationWalletAccountId: dst,
      lamports: base + (BigInt(idx) < remainder ? 1n : 0n),
    }));
    return { kind: 'ok', pairs };
  }

  // Case 3: N -> M with both > 1. Not supported in this iteration.
  return { kind: 'unsupported' };
}
