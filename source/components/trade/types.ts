/**
 * TypeScript mirror of the backend `TokenSnapshot` shape served by
 * the data service's token endpoint
 * (an internal backend type). Fields use
 * camelCase via serde rename. Bigint-style fields are stringified —
 * the serializer can't trust JSON to round-trip u128 values.
 *
 * Authoritative wire-shape contract for the snapshot adapter and the
 * `useTokenSnapshot` hook. Update both ends in lockstep.
 */

export type CreateVariant = 'create' | 'create_v2';

export interface PumpMetadata {
  image: string | null;
  description: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  showName: boolean | null;
  createdOn: string | null;
  /**
   * Free-form extra fields the metadata JSON carried beyond the
   * known set. Keys are arbitrary; values are arbitrary JSON.
   */
  extra?: Record<string, unknown>;
  rawJson?: unknown;
}

/**
 * Single snapshot candle. All ratio components are stringified u128
 * to match the bigint-as-string convention.
 *
 * Field names mirror the backend serde output exactly:
 *   - `bucketStartSec` is renamed via `#[serde(rename = "bucketStartSec")]`
 *     on an internal routine.
 *   - `volBuyLamports` / `volSellLamports` are also renamed via serde.
 *   - `resolution` is the bucket resolution tag ("1s" | "1m" | "5m" | "15m" | "1h").
 */
export interface SnapshotCandle {
  resolution: CandleResolution;
  /** Bucket start, seconds since unix epoch. */
  bucketStartSec: number;
  open_num: string;
  open_den: string;
  high_num: string;
  high_den: string;
  low_num: string;
  low_den: string;
  close_num: string;
  close_den: string;
  volBuyLamports: string;
  volSellLamports: string;
  trades: number;
}

/** Single trade row inside the snapshot's recent-trades window. */
export interface TokenTrade {
  signature: string;
  slot: number;
  orderKey?: FixtureOrderKey;
  user: string;
  isBuy: boolean;
  solLamports: string;
  tokenBaseUnits: string;
  vsr: string;
  vtr: string;
  realSolLamports: string;
  realTokenBaseUnits: string;
  feeLamports: string;
  /** Trader's post-trade balance of the mint (base units, stringified u128),
   *  from the tx's own postTokenBalances. Absent on rows persisted before the
   *  field shipped — the Supply Held column renders "-" for those. */
  traderPostTokenBaseUnits?: string;
  marketCapLamports?: string;
  /** Optional legacy/cold-reader price fields; live backend stream derives price from reserves. */
  priceLamportsNum?: string;
  priceLamportsDen?: string;
  arrivedAtMs: number;
  blockTimeSec: number | null;
}

/** Bucket key set on `TokenSnapshot.candles`. */
export type CandleResolution = '1s' | '1m' | '5m' | '15m' | '1h';

export type ChartDataSource = 'cold' | 'hot' | 'merged';
export type ChartColdReadStatus = 'hit' | 'miss' | 'failed';
export type ChartLiveTailStatus = 'not_requested' | 'active' | 'unavailable';

export interface ChartStatus {
  source: ChartDataSource;
  coldRead: ChartColdReadStatus;
  liveTail: ChartLiveTailStatus;
  persistenceGapsObserved: number;
}

export interface FixtureOrderKey {
  slot: number;
  txIndex: number;
  ixIndex: number;
  logIndex: number;
  eventIndex: number;
  orderSource: 'source_index' | 'arrival_sequence';
}

/**
 * Top-level shape returned by `GET /token/:mint`. Field names match
 * backend's `TokenSnapshot` after serde camelCase + the manual renames
 * (`bondingCurveATA`, `priceLamports_num`, `priceLamports_den`).
 */
export interface TokenSnapshot {
  mint: string;
  stateKind: 'live' | 'stub' | 'backfilled';
  metadataReady: boolean;
  /** Empty string for stubs (no CREATE landed yet). */
  signature: string;
  slot: number;
  variant: CreateVariant;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  isMayhem: boolean;
  isCashback: boolean;
  bondingCurve: string;
  bondingCurveATA: string;
  metadata: PumpMetadata | null;
  // Bigint-as-string reserves + amounts.
  vsr: string;
  vtr: string;
  realSolLamports: string;
  realTokenBaseUnits: string;
  totalSupplyBaseUnits: string;
  marketCapLamports: string;
  marketCapUsd: number;
  /** Renamed via serde: `priceLamports_num` / `priceLamports_den`. */
  priceLamports_num: string;
  priceLamports_den: string;
  priceSolPerToken: string;
  priceUsdPerToken: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  uniqueTradersApprox: number;
  vol5sLamports: string;
  vol1mLamports: string;
  vol5mLamports: string;
  vol5sUsd: number;
  vol1mUsd: number;
  vol5mUsd: number;
  /** Trailing-24h volume. Absent while the backend's 24h window awaits its
   *  cold seed (and on cached pre-field snapshot blobs) — fall back to 5m. */
  vol24hLamports?: string;
  vol24hUsd?: number;
  /** Keyed by `'1s' | '1m' | '5m' | '15m' | '1h'`. */
  candles: Partial<Record<CandleResolution, SnapshotCandle[]>>;
  recentTrades: TokenTrade[];
  tradeHistory?: TokenTrade[];
  createdAtMs: number;
  lastTradeAtMs: number | null;
  graduatedAtMs: number | null;
  snapshotTakenAtMs: number;
  solUsd: number;
  graduated: boolean;
  /**
   * Pair quote mint (base58). Absent for SOL pairs; the USDC mint
   * (`EPjFWdd5…TDt1v`) marks a USDC-quoted pair. See
   * `lib/trade/spend-currency.ts::isUsdcPair`.
   */
  quoteMint?: string;
}

/** Single holder row returned by `GET /api/token/:mint/holders`. */
export interface TokenHolder {
  rank: number;
  owner: string;
  amountBaseUnits: string;
  supplyPct: number;
  tokenAccountCount: number;
  solBalanceLamports?: string | null;
  lastActiveAtMs?: number | null;
  boughtTokenBaseUnits: string;
  boughtSolLamports: string;
  avgBuyMarketCapUsd?: number | null;
  soldTokenBaseUnits: string;
  soldSolLamports: string;
  avgSellMarketCapUsd?: number | null;
  unrealizedPnlSol?: number | null;
  heldSinceMs?: number | null;
  fundingSource?: string | null;
}

export interface TokenHoldersResponse {
  v: string;
  mint: string;
  totalSupplyBaseUnits: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  holders: TokenHolder[];
}

/** Single trader row returned by `GET /api/token/:mint/top-traders`. */
export interface TokenTopTrader {
  rank: number;
  owner: string;
  solBalanceLamports?: string | null;
  lastActiveAtMs?: number | null;
  firstActiveAtMs?: number | null;
  boughtTokenBaseUnits: string;
  boughtSolLamports: string;
  avgBuyMarketCapUsd?: number | null;
  soldTokenBaseUnits: string;
  soldSolLamports: string;
  avgSellMarketCapUsd?: number | null;
  totalPnlSol?: number | null;
  remainingTokenBaseUnits: string;
  remainingSupplyPct: number;
  buyCount: number;
  sellCount: number;
  txCount: number;
  fundingSource?: string | null;
}

export interface TokenTopTradersResponse {
  v: string;
  mint: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  traders: TokenTopTrader[];
}

export interface TokenCandlesResponse {
  v: string;
  mint: string;
  resolution: CandleResolution;
  beforeSec: number | null;
  limit: number;
  hasMoreOlder: boolean;
  chartStatus?: ChartStatus;
  candles: SnapshotCandle[];
}

export type SelectedTokenStreamEventName =
  | 'snapshot'
  | 'snapshot_lite'
  | 'trade'
  | 'metadata_update'
  | 'enrichment_update'
  | 'graduation'
  | 'heartbeat'
  | 'resync_required'
  | 'viewers';

export interface SelectedTokenTradeEvent {
  mint: string;
  trade: TokenTrade;
  candles: SnapshotCandle[];
  graduatedAtMs?: number | null;
}

export type SelectedTokenSnapshotEvent = TokenSnapshot;

export interface SelectedTokenMetadataUpdateEvent {
  mint?: string;
  snapshot?: TokenSnapshot;
  metadata?: PumpMetadata | null;
  [key: string]: unknown;
}

export interface SelectedTokenEnrichmentUpdateEvent {
  mint?: string;
  snapshot?: TokenSnapshot;
  [key: string]: unknown;
}

export interface SelectedTokenGraduationEvent {
  mint?: string;
  snapshot?: TokenSnapshot;
  graduatedAtMs?: number | null;
  [key: string]: unknown;
}

export interface SelectedTokenHeartbeatEvent {
  mint?: string;
  tsMs?: number;
  serverTimeMs?: number;
  nowMs?: number;
  /** Data-progress watermark: the last per-mint sequence the server wrote
   *  to THIS connection before the heartbeat. A delivered cursor behind it
   *  means frames were lost despite a healthy transport. */
  seq?: number;
  /** Current viewer count (presence) — the 15s passive heal beside the
   *  change-driven `viewers` events. */
  viewers?: number;
  [key: string]: unknown;
}

export interface SelectedTokenResyncRequiredEvent {
  mint?: string;
  reason?: string;
  [key: string]: unknown;
}

/** One top-page row's ledger-owned columns inside `HolderTopDelta`.
 *  `supplyPct` is deliberately NOT wired: the client computes it from its
 *  cached envelope's `totalSupplyBaseUnits`, so the two can never diverge. */
export interface HolderTopDeltaRow {
  owner: string;
  amountBaseUnits: string;
  tokenAccountCount: number;
}

/** Top-100 balance delta riding `holder_version` events (stream-v2).
 *  `upserts` are entrants + changed rows (rank is derived, never wired);
 *  `removes` are owners that left the top page. Balance-truth columns only —
 *  enrichment (PnL / bought / sold / SOL balance) stays a REST concern. */
export interface HolderTopDelta {
  /** The previously emitted version this delta applies on top of. A client
   *  on any other version falls back to the `?v=` refetch. */
  baseVersion: number;
  upserts: HolderTopDeltaRow[];
  removes: string[];
}

/** Payload of the stream's `holder_version` events (stream-v2). */
export interface SelectedTokenHolderVersionEvent {
  mint?: string;
  holderVersion?: number;
  totalHolders?: number;
  /** Additive wire field — absent on the first emit of a mint's process
   *  life; older servers never send it. */
  topDelta?: HolderTopDelta;
  [key: string]: unknown;
}

/** True when the snapshot is for a stub (no CREATE applied yet). */
export function isStubSnapshot(snap: TokenSnapshot): boolean {
  if (snap.stateKind === 'stub') return true;
  // backend populates `signature` from CoinState.signature.unwrap_or_default();
  // an empty string ⇒ no CREATE has been applied.
  return snap.signature === '' && snap.tradeCount === 0 && !snap.name && !snap.symbol;
}

export type BackfillPhase =
  | 'idle'
  | 'queued'
  | 'metadata'
  | 'transactions'
  | 'complete'
  | 'failed';

export interface BackfillStatus {
  mint: string;
  status: BackfillPhase;
  alreadyKnown?: boolean;
  signaturesScanned: number;
  transactionsScanned: number;
  tradesDecoded: number;
  lastError: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
}
