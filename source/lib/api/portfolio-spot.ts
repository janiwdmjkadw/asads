'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Portfolio Spot tab": typed client for `GET /portfolio/spot`.
 *
 * Defensive parsing throughout — every branch returns a tagged union
 * variant instead of throwing. The orchestrator (`SpotTab.tsx`) maps
 * union members directly to UI states (loading / reauth / empty /
 * priced / unpriced / outage).
 */

export type HoldingBucket = 'sol' | 'stable' | 'spl' | 'unknown';

export interface SpotHoldingBreakdown {
  readonly wallet_account_id: string;
  readonly wallet_pubkey: string;
  readonly amount_ui: number;
  readonly value_usd: number | null;
}

export type CostBasisProvenance =
  | 'observed_fill'
  | 'inferred_swap'
  | 'internal_transfer'
  | 'imported_unknown';

export interface SpotHolding {
  readonly mint: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly logo: string | null;
  readonly decimals: number;
  readonly amount_raw: string;
  readonly amount_ui: number;
  readonly price_usd: number | null;
  readonly value_usd: number | null;
  readonly pct_of_portfolio: number;
  readonly change_24h_pct: number | null;
  readonly bucket: HoldingBucket;
  readonly wallet_breakdown: ReadonlyArray<SpotHoldingBreakdown>;
  readonly cost_basis_usd: number | null;
  readonly unrealized_usd: number | null;
  readonly unrealized_pct: number | null;
  readonly realized_usd: number | null;
  readonly cost_basis_provenance: CostBasisProvenance | null;
}

export interface SpotWalletAgg {
  readonly wallet_account_id: string;
  readonly wallet_pubkey: string;
  readonly total_usd: number;
}

export interface SpotBackfillEntry {
  readonly wallet_account_id: string;
  readonly status: 'pending' | 'running' | 'done' | 'failed';
  readonly earliest_at_ms: number | null;
  readonly last_run_at_ms: number | null;
  readonly last_error: string | null;
}

export interface SpotSuccess {
  readonly kind: 'ok';
  readonly totalUsd: number;
  readonly solUsd: number;
  readonly stableUsd: number;
  readonly splUsd: number;
  readonly solPriceUsd: number;
  readonly coveragePct: number;
  readonly change24hUsd: number | null;
  readonly change24hPct: number | null;
  readonly holdings: ReadonlyArray<SpotHolding>;
  readonly walletAggregates: ReadonlyArray<SpotWalletAgg>;
  readonly backfill: ReadonlyArray<SpotBackfillEntry>;
  readonly degradedReasons: ReadonlyArray<string>;
  readonly snapshotAtMs: number;
  readonly realizedUsd: number;
  readonly unrealizedUsd: number;
  readonly costBasisUsd: number;
}

export type SpotResult =
  | SpotSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

function asNullableNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function asNullableStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asBucket(v: unknown): HoldingBucket {
  if (v === 'sol' || v === 'stable' || v === 'spl' || v === 'unknown') return v;
  // Back-compat with early dev builds of the endpoint.
  if (v === 'spam') return 'unknown';
  return 'spl';
}

function parseBreakdown(raw: unknown): SpotHoldingBreakdown | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw['wallet_account_id'] !== 'string' ||
    typeof raw['wallet_pubkey'] !== 'string'
  ) {
    return null;
  }
  return {
    wallet_account_id: raw['wallet_account_id'],
    wallet_pubkey: raw['wallet_pubkey'],
    amount_ui: asNum(raw['amount_ui']),
    value_usd: asNullableNum(raw['value_usd']),
  };
}

function asProvenance(v: unknown): CostBasisProvenance | null {
  if (
    v === 'observed_fill' ||
    v === 'inferred_swap' ||
    v === 'internal_transfer' ||
    v === 'imported_unknown'
  ) {
    return v;
  }
  return null;
}

function parseHolding(raw: unknown): SpotHolding | null {
  if (!isObject(raw)) return null;
  const mint = raw['mint'];
  if (typeof mint !== 'string') return null;
  const breakdownRaw = raw['wallet_breakdown'];
  const breakdown: SpotHoldingBreakdown[] = [];
  if (Array.isArray(breakdownRaw)) {
    for (const b of breakdownRaw) {
      const parsed = parseBreakdown(b);
      if (parsed) breakdown.push(parsed);
    }
  }
  return {
    mint,
    symbol: asNullableStr(raw['symbol']),
    name: asNullableStr(raw['name']),
    logo: asNullableStr(raw['logo']),
    decimals: Math.max(0, Math.floor(asNum(raw['decimals']))),
    amount_raw: typeof raw['amount_raw'] === 'string' ? raw['amount_raw'] : '0',
    amount_ui: asNum(raw['amount_ui']),
    price_usd: asNullableNum(raw['price_usd']),
    value_usd: asNullableNum(raw['value_usd']),
    pct_of_portfolio: asNum(raw['pct_of_portfolio']),
    change_24h_pct: asNullableNum(raw['change_24h_pct']),
    bucket: asBucket(raw['bucket']),
    wallet_breakdown: breakdown,
    cost_basis_usd: asNullableNum(raw['cost_basis_usd']),
    unrealized_usd: asNullableNum(raw['unrealized_usd']),
    unrealized_pct: asNullableNum(raw['unrealized_pct']),
    realized_usd: asNullableNum(raw['realized_usd']),
    cost_basis_provenance: asProvenance(raw['cost_basis_provenance']),
  };
}

function parseAgg(raw: unknown): SpotWalletAgg | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw['wallet_account_id'] !== 'string' ||
    typeof raw['wallet_pubkey'] !== 'string'
  ) {
    return null;
  }
  return {
    wallet_account_id: raw['wallet_account_id'],
    wallet_pubkey: raw['wallet_pubkey'],
    total_usd: asNum(raw['total_usd']),
  };
}

function parseBackfillEntry(raw: unknown): SpotBackfillEntry | null {
  if (!isObject(raw)) return null;
  const id = raw['wallet_account_id'];
  const status = raw['status'];
  if (typeof id !== 'string') return null;
  if (
    status !== 'pending' &&
    status !== 'running' &&
    status !== 'done' &&
    status !== 'failed'
  ) {
    return null;
  }
  return {
    wallet_account_id: id,
    status,
    earliest_at_ms:
      typeof raw['earliest_at_ms'] === 'number' ? raw['earliest_at_ms'] : null,
    last_run_at_ms:
      typeof raw['last_run_at_ms'] === 'number' ? raw['last_run_at_ms'] : null,
    last_error: asNullableStr(raw['last_error']),
  };
}

export function parseSpotResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): SpotResult {
  if (json['reauth_required'] === true) {
    const r = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      r === 'no_session' || r === 'session_expired' || r === 'session_invalid'
        ? r
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  if (typeof json['error_code'] === 'string') {
    return {
      kind: 'error',
      status: httpStatus,
      errorCode: json['error_code'],
      message: typeof json['message'] === 'string' ? json['message'] : 'request failed',
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: 'shape_mismatch', reason: `http_${httpStatus}` };
  }
  const holdingsRaw = json['holdings'];
  const aggsRaw = json['wallet_aggregates'];
  const backfillRaw = json['backfill'];
  const degradedRaw = json['degraded_reasons'];
  if (!Array.isArray(holdingsRaw)) {
    return { kind: 'shape_mismatch', reason: 'holdings_not_array' };
  }
  const holdings: SpotHolding[] = [];
  for (const h of holdingsRaw) {
    const parsed = parseHolding(h);
    if (parsed) holdings.push(parsed);
  }
  const aggregates: SpotWalletAgg[] = [];
  if (Array.isArray(aggsRaw)) {
    for (const a of aggsRaw) {
      const parsed = parseAgg(a);
      if (parsed) aggregates.push(parsed);
    }
  }
  const backfill: SpotBackfillEntry[] = [];
  if (Array.isArray(backfillRaw)) {
    for (const b of backfillRaw) {
      const parsed = parseBackfillEntry(b);
      if (parsed) backfill.push(parsed);
    }
  }
  const degraded: string[] = Array.isArray(degradedRaw)
    ? degradedRaw.filter((d): d is string => typeof d === 'string')
    : [];
  return {
    kind: 'ok',
    totalUsd: asNum(json['total_usd']),
    solUsd: asNum(json['sol_usd']),
    stableUsd: asNum(json['stable_usd']),
    splUsd: asNum(json['spl_usd']),
    solPriceUsd: asNum(json['sol_price_usd']),
    coveragePct: asNum(json['coverage_pct'], 1),
    change24hUsd: asNullableNum(json['change_24h_usd']),
    change24hPct: asNullableNum(json['change_24h_pct']),
    holdings,
    walletAggregates: aggregates,
    backfill,
    degradedReasons: degraded,
    snapshotAtMs: asNum(json['snapshot_at_ms'], Date.now()),
    realizedUsd: asNum(json['realized_usd']),
    unrealizedUsd: asNum(json['unrealized_usd']),
    costBasisUsd: asNum(json['cost_basis_usd']),
  };
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface FetchSpotInput {
  /**
   * Optional filter — scope the snapshot to a single wallet the
   * authenticated user owns. The route still returns
   * `wallet_aggregates` for ALL wallets so the picker keeps its
   * full list while the filter is active.
   */
  readonly walletAccountId?: string | null;
}

export async function fetchSpot(
  input: FetchSpotInput = {},
  options: { signal?: AbortSignal; authToken?: string | null } = {},
): Promise<SpotResult> {
  const params = new URLSearchParams();
  if (
    typeof input.walletAccountId === 'string' &&
    UUID_REGEX.test(input.walletAccountId)
  ) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  const qs = params.toString();
  const url = qs.length > 0
    ? `/api/v1/portfolio/spot?${qs}`
    : '/api/v1/portfolio/spot';
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      url,
      { method: 'GET' },
      {
        authToken: options.authToken,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
  } catch (err) {
    return { kind: 'network_error', reason: (err as Error).message ?? 'network_error' };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseSpotResponse(json, res.status);
}
