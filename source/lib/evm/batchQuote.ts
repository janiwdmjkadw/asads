import type { EvmOrderSide } from './orderApi';
import type { EvmServedQuoteResult } from './quoteApi';

export type QuotedEvmBatchChild = Extract<EvmServedQuoteResult, { kind: 'quoted' }>;

export interface EvmBatchQuoteSubject {
  readonly chain: string;
  readonly token: string;
  readonly walletAccountId: string;
  readonly side: EvmOrderSide;
  readonly amountBaseUnits: string;
  readonly quoteAssetAddress: string | null;
  readonly slippageBps: number;
  readonly marketVenue?: string | null;
}

export const EVM_BATCH_QUOTE_CONCURRENCY = 4;

/** Preserve child order while bounding gateway pressure. The caller owns the
 * AbortSignal; workers stop claiming new subjects immediately after abort. */
export async function fetchEvmBatchQuotesBounded<T>(
  subjects: readonly EvmBatchQuoteSubject[],
  fetchOne: (subject: EvmBatchQuoteSubject) => Promise<T>,
  signal: AbortSignal,
  concurrency = EVM_BATCH_QUOTE_CONCURRENCY,
): Promise<readonly T[]> {
  const results = new Array<T>(subjects.length);
  let nextIndex = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const subject = subjects[index];
      if (subject === undefined) return;
      results[index] = await fetchOne(subject);
    }
  };
  const workerCount = Math.min(
    subjects.length,
    Math.max(1, Math.floor(concurrency)),
  );
  await Promise.all(Array.from({ length: workerCount }, worker));
  if (signal.aborted) throw new DOMException('Batch quote cancelled', 'AbortError');
  return results;
}

/** Gateway-identical equal split: the first `total % count` ordered wallets
 * receive one extra base unit. Zero-sized children are refused locally. */
export function splitEvmBatchAmount(
  totalBaseUnits: bigint,
  walletAccountIds: readonly string[],
): Readonly<Record<string, string>> | null {
  if (totalBaseUnits <= 0n || walletAccountIds.length < 2) return null;
  const count = BigInt(walletAccountIds.length);
  const base = totalBaseUnits / count;
  const remainder = totalBaseUnits % count;
  if (base === 0n) return null;
  return Object.fromEntries(walletAccountIds.map((walletAccountId, index) => [
    walletAccountId,
    (base + (BigInt(index) < remainder ? 1n : 0n)).toString(),
  ]));
}

function quoteAssetMatches(
  quote: QuotedEvmBatchChild,
  subject: EvmBatchQuoteSubject,
): boolean {
  const asset = quote.side === 'buy' ? quote.inputAsset : quote.outputAsset;
  const expected = subject.quoteAssetAddress?.toLowerCase() ?? null;
  return expected === null
    ? asset.kind === 'native' && asset.address === null
    : asset.kind === 'erc20' && asset.address === expected;
}

export function isCurrentEvmBatchQuotes(
  quotes: readonly QuotedEvmBatchChild[],
  subjects: readonly EvmBatchQuoteSubject[],
  nowMs: number,
): boolean {
  if (quotes.length < 2 || quotes.length !== subjects.length) return false;
  return quotes.every((quote, index) => {
    const subject = subjects[index];
    return subject !== undefined
      && quote.chain === subject.chain
      && quote.token === subject.token.toLowerCase()
      && quote.walletAccountId === subject.walletAccountId
      && quote.side === subject.side
      && quote.amountIn === subject.amountBaseUnits
      && quote.slippageBps === subject.slippageBps
      && quoteAssetMatches(quote, subject)
      && quote.quotedAtMs <= nowMs + 30_000
      && quote.expiresAtMs > nowMs;
  });
}

/** Client-captured route provenance closes the render-before-effect window
 * when the same token graduates between venues without changing its address. */
export function isSameEvmBatchQuoteSubjects(
  quoted: readonly EvmBatchQuoteSubject[],
  current: readonly EvmBatchQuoteSubject[],
): boolean {
  return quoted.length === current.length && quoted.every((subject, index) => {
    const other = current[index];
    return other !== undefined
      && subject.chain === other.chain
      && subject.token === other.token
      && subject.walletAccountId === other.walletAccountId
      && subject.side === other.side
      && subject.amountBaseUnits === other.amountBaseUnits
      && subject.quoteAssetAddress === other.quoteAssetAddress
      && subject.slippageBps === other.slippageBps
      && subject.marketVenue === other.marketVenue;
  });
}

function assetIdentity(asset: { readonly kind: string; readonly address: string | null }): string {
  return `${asset.kind}:${asset.address ?? ''}`;
}

export interface EvmBatchQuoteAggregate {
  readonly expectedOut: bigint;
  readonly minAmountOut: bigint;
  readonly platformFeeBaseUnits: bigint;
  readonly outputAsset: QuotedEvmBatchChild['outputAsset'];
  readonly platformFeeAsset: QuotedEvmBatchChild['platformFeeAsset'];
  readonly venueLabel: string;
  readonly routeLabel: string;
  readonly expiresAtMs: number;
}

/** A sum is shown only when every child names the same output and fee asset.
 * Different routes may be valid; those are labelled `multiple`, never hidden. */
export function aggregateEvmBatchQuotes(
  quotes: readonly QuotedEvmBatchChild[],
): EvmBatchQuoteAggregate | null {
  const first = quotes[0];
  if (first === undefined || quotes.length < 2) return null;
  const outputIdentity = assetIdentity(first.outputAsset);
  const feeIdentity = assetIdentity(first.platformFeeAsset);
  if (quotes.some((quote) => (
    assetIdentity(quote.outputAsset) !== outputIdentity
    || assetIdentity(quote.platformFeeAsset) !== feeIdentity
  ))) return null;
  const venues = new Set(quotes.map((quote) => quote.venue));
  const routes = new Set(quotes.map((quote) => quote.routeMode));
  return {
    expectedOut: quotes.reduce((sum, quote) => sum + BigInt(quote.expectedOut), 0n),
    minAmountOut: quotes.reduce((sum, quote) => sum + BigInt(quote.minAmountOut), 0n),
    platformFeeBaseUnits: quotes.reduce(
      (sum, quote) => sum + BigInt(quote.platformFeeBaseUnits),
      0n,
    ),
    outputAsset: first.outputAsset,
    platformFeeAsset: first.platformFeeAsset,
    venueLabel: venues.size === 1 ? first.venue : 'multiple',
    routeLabel: routes.size === 1 ? first.routeMode : 'multiple',
    expiresAtMs: Math.min(...quotes.map((quote) => quote.expiresAtMs)),
  };
}
