'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Slice "Portfolio Spot tab": typed client for the PnL chart series
 * endpoint.
 */

export type SpotRange = '1d' | '30d' | '90d' | 'max';

export interface SpotPerfPoint {
  readonly t_ms: number;
  readonly total_usd: number;
  readonly sol_usd: number;
  readonly stable_usd: number;
  readonly spl_usd: number;
}

export interface SpotPerfSuccess {
  readonly kind: 'ok';
  readonly range: SpotRange;
  readonly resolutionMs: number;
  readonly points: ReadonlyArray<SpotPerfPoint>;
  readonly chartPartial: boolean;
  readonly trackingStartedMs: number | null;
  readonly changeUsd: number | null;
  readonly changePct: number | null;
}

export type SpotPerfResult =
  | SpotPerfSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePoint(raw: unknown): SpotPerfPoint | null {
  if (!isObject(raw)) return null;
  const t = raw['t_ms'];
  const total = raw['total_usd'];
  if (typeof t !== 'number' || typeof total !== 'number') return null;
  return {
    t_ms: t,
    total_usd: total,
    sol_usd: typeof raw['sol_usd'] === 'number' ? raw['sol_usd'] : 0,
    stable_usd: typeof raw['stable_usd'] === 'number' ? raw['stable_usd'] : 0,
    spl_usd: typeof raw['spl_usd'] === 'number' ? raw['spl_usd'] : 0,
  };
}

export function parseSpotPerfResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): SpotPerfResult {
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
  const rangeRaw = json['range'];
  const range: SpotRange =
    rangeRaw === '1d' || rangeRaw === '30d' || rangeRaw === '90d' || rangeRaw === 'max'
      ? rangeRaw
      : '30d';
  const pointsRaw = json['points'];
  if (!Array.isArray(pointsRaw)) {
    return { kind: 'shape_mismatch', reason: 'points_not_array' };
  }
  const points: SpotPerfPoint[] = [];
  for (const p of pointsRaw) {
    const parsed = parsePoint(p);
    if (parsed) points.push(parsed);
  }
  return {
    kind: 'ok',
    range,
    resolutionMs:
      typeof json['resolution_ms'] === 'number' ? json['resolution_ms'] : 60 * 60 * 1_000,
    points,
    chartPartial: json['chart_partial'] === true,
    trackingStartedMs:
      typeof json['tracking_started_ms'] === 'number'
        ? json['tracking_started_ms']
        : null,
    changeUsd: typeof json['change_usd'] === 'number' ? json['change_usd'] : null,
    changePct: typeof json['change_pct'] === 'number' ? json['change_pct'] : null,
  };
}

export async function fetchSpotPerformance(
  input: { range: SpotRange; walletAccountId?: string | null },
  options: { signal?: AbortSignal; authToken?: string | null } = {},
): Promise<SpotPerfResult> {
  const params = new URLSearchParams();
  params.set('range', input.range);
  if (typeof input.walletAccountId === 'string' && input.walletAccountId.length > 0) {
    params.set('wallet_account_id', input.walletAccountId);
  }
  const url = `/api/v1/portfolio/spot/performance?${params.toString()}`;
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
  return parseSpotPerfResponse(json, res.status);
}
