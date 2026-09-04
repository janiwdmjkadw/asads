'use client';

import { fetchAuthenticatedApi } from './trading';
import type { EvmPortfolioChain } from './evm-positions';

export const EVM_PERFORMANCE_RANGES = ['1d', '30d', '90d', 'max'] as const;
export type EvmPerformanceRange = (typeof EVM_PERFORMANCE_RANGES)[number];

export interface EvmPerformancePoint {
  readonly tMs: number;
  readonly measuredValueUsdAtto: string;
  readonly measuredUnrealizedPnlUsdAtto: string;
  readonly positionCount: number;
  readonly valueMeasuredCount: number;
  readonly pnlMeasuredCount: number;
  readonly unavailableReasons: ReadonlyArray<string>;
}

export interface EvmPerformanceSuccess {
  readonly kind: 'ok';
  readonly chain: EvmPortfolioChain;
  readonly walletAccountId: string | null;
  readonly range: EvmPerformanceRange;
  readonly resolutionMs: number;
  readonly points: ReadonlyArray<EvmPerformancePoint>;
  readonly chartPartial: boolean;
  readonly trackingStartedMs: number | null;
  readonly changeValueUsdAtto: string | null;
  readonly changeUnrealizedPnlUsdAtto: string | null;
  readonly asObserved: true;
  readonly forwardOnly: true;
}

export type EvmPerformanceResult =
  | EvmPerformanceSuccess
  | { readonly kind: 'reauth'; readonly reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { readonly kind: 'error'; readonly status: number; readonly errorCode: string; readonly message: string }
  | { readonly kind: 'network_error'; readonly reason: string }
  | { readonly kind: 'shape_mismatch'; readonly reason: string };

const UNSIGNED = /^\d{1,39}$/;
const SIGNED = /^-?\d{1,39}$/;
const SIGNED_CHANGE = /^-?\d{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parsePoint(raw: unknown): EvmPerformancePoint | null {
  if (!isObject(raw)) return null;
  const tMs = raw['t_ms'];
  const value = raw['measured_value_usd_atto'];
  const pnl = raw['measured_unrealized_pnl_usd_atto'];
  const positions = raw['position_count'];
  const values = raw['value_measured_count'];
  const pnls = raw['pnl_measured_count'];
  const reasons = raw['unavailable_reasons'];
  if (
    typeof tMs !== 'number' || !Number.isSafeInteger(tMs) || tMs <= 0
    || typeof value !== 'string' || !UNSIGNED.test(value)
    || typeof pnl !== 'string' || !SIGNED.test(pnl)
    || !isCount(positions) || !isCount(values) || !isCount(pnls)
    || values > positions || pnls > positions
    || !Array.isArray(reasons)
    || reasons.some((reason) => typeof reason !== 'string' || reason.length === 0 || reason.length > 128)
    || (values === positions && pnls === positions && reasons.length > 0)
  ) {
    return null;
  }
  return {
    tMs,
    measuredValueUsdAtto: value,
    measuredUnrealizedPnlUsdAtto: pnl,
    positionCount: positions,
    valueMeasuredCount: values,
    pnlMeasuredCount: pnls,
    unavailableReasons: reasons as string[],
  };
}

export function parseEvmPerformanceResponse(
  json: Record<string, unknown>,
  httpStatus: number,
  expected?: {
    readonly chain: EvmPortfolioChain;
    readonly range: EvmPerformanceRange;
    readonly walletAccountId: string | null;
  },
): EvmPerformanceResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason = raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
      ? raw
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
  if (httpStatus < 200 || httpStatus >= 300 || json['reauth_required'] !== false) {
    return { kind: 'shape_mismatch', reason: `http_or_auth_${httpStatus}` };
  }

  const chain = json['chain'];
  const walletAccountId = json['wallet_account_id'];
  const range = json['range'];
  const resolutionMs = json['resolution_ms'];
  const trackingStartedMs = json['tracking_started_ms'];
  const changeValue = json['change_value_usd_atto'];
  const changePnl = json['change_unrealized_pnl_usd_atto'];
  const rawPoints = json['points'];
  if (
    (chain !== 'bsc' && chain !== 'robinhood_chain')
    || (walletAccountId !== null
      && (typeof walletAccountId !== 'string' || !UUID.test(walletAccountId)))
    || !EVM_PERFORMANCE_RANGES.includes(range as EvmPerformanceRange)
    || typeof resolutionMs !== 'number' || !Number.isSafeInteger(resolutionMs) || resolutionMs <= 0
    || (trackingStartedMs !== null
      && (typeof trackingStartedMs !== 'number' || !Number.isSafeInteger(trackingStartedMs) || trackingStartedMs <= 0))
    || (changeValue !== null && (typeof changeValue !== 'string' || !SIGNED.test(changeValue)))
    || (changePnl !== null && (typeof changePnl !== 'string' || !SIGNED_CHANGE.test(changePnl)))
    || json['as_observed'] !== true
    || json['forward_only'] !== true
    || typeof json['chart_partial'] !== 'boolean'
    || !Array.isArray(rawPoints)
  ) {
    return { kind: 'shape_mismatch', reason: 'performance_metadata_invalid' };
  }
  if (expected !== undefined && (
    chain !== expected.chain
    || range !== expected.range
    || walletAccountId !== expected.walletAccountId
  )) {
    return { kind: 'shape_mismatch', reason: 'performance_subject_mismatch' };
  }

  const points: EvmPerformancePoint[] = [];
  let previousMs = -1;
  for (const raw of rawPoints) {
    const point = parsePoint(raw);
    if (point === null || point.tMs <= previousMs) {
      return { kind: 'shape_mismatch', reason: 'performance_point_invalid' };
    }
    previousMs = point.tMs;
    points.push(point);
  }
  const coveragePartial = points.length === 0 || points.some(
    (point) => point.valueMeasuredCount !== point.positionCount
      || point.pnlMeasuredCount !== point.positionCount,
  );
  if (coveragePartial && json['chart_partial'] !== true) {
    return { kind: 'shape_mismatch', reason: 'performance_coverage_inconsistent' };
  }
  const first = points[0];
  const last = points.at(-1);
  if (
    (first !== undefined && trackingStartedMs === null)
    || (trackingStartedMs !== null && first !== undefined && trackingStartedMs > first.tMs)
    || (changeValue !== null && (
      points.length < 2
      || first?.valueMeasuredCount !== first?.positionCount
      || last?.valueMeasuredCount !== last?.positionCount
      || BigInt(changeValue) !== (
        BigInt(last!.measuredValueUsdAtto) - BigInt(first.measuredValueUsdAtto)
      )
    ))
    || (changePnl !== null && (
      points.length < 2
      || first?.pnlMeasuredCount !== first?.positionCount
      || last?.pnlMeasuredCount !== last?.positionCount
      || BigInt(changePnl) !== (
        BigInt(last!.measuredUnrealizedPnlUsdAtto)
        - BigInt(first.measuredUnrealizedPnlUsdAtto)
      )
    ))
  ) {
    return { kind: 'shape_mismatch', reason: 'performance_series_inconsistent' };
  }
  return {
    kind: 'ok',
    chain,
    walletAccountId: walletAccountId as string | null,
    range: range as EvmPerformanceRange,
    resolutionMs,
    points,
    chartPartial: json['chart_partial'] as boolean,
    trackingStartedMs: trackingStartedMs as number | null,
    changeValueUsdAtto: changeValue as string | null,
    changeUnrealizedPnlUsdAtto: changePnl as string | null,
    asObserved: true,
    forwardOnly: true,
  };
}

export async function fetchEvmPerformance(
  input: {
    readonly chain: EvmPortfolioChain;
    readonly range: EvmPerformanceRange;
    readonly walletAccountId?: string | null;
  },
  options: { readonly signal?: AbortSignal; readonly authToken?: string | null } = {},
): Promise<EvmPerformanceResult> {
  const params = new URLSearchParams({ chain: input.chain, range: input.range });
  if (typeof input.walletAccountId === 'string' && input.walletAccountId.length > 0) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      `/api/v1/portfolio/evm/performance?${params.toString()}`,
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (error) {
    return { kind: 'network_error', reason: (error as Error).message ?? 'network_error' };
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return parseEvmPerformanceResponse(json, response.status, {
    chain: input.chain,
    range: input.range,
    walletAccountId: input.walletAccountId ?? null,
  });
}
