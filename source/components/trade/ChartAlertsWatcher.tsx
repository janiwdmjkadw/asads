'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { playAlphaCallBell } from '@/components/discover/attentionSounds';
import { navigateToToken } from '@/components/listen/navigation';
import { fetchIngestionJson, ingestionApiUrl } from '@/lib/api/ingestion';
import { compactUsd } from '@/lib/format';
import {
  useChartAlertsStore,
  type ArmedChartAlert,
} from '@/lib/state/chart-alerts-store';

/**
 * Cross-page watcher for armed chart alerts — PUSH-based so it scales
 * to thousands of users each alerting different mints:
 *
 *   - one seed snapshot per armed mint (immediate threshold check +
 *     the token supply / SOL price needed to derive MC from trades);
 *   - then the mint's existing SSE trade stream (the same channel every
 *     open trade page holds, whose fan-out is built for thousands of
 *     subscribers) delivers each trade's reserves, and MC is derived
 *     client-side — no polling, instant triggers, heartbeat-only cost
 *     while the coin is quiet.
 *
 * Zero armed alerts = zero connections. The trade page's live snapshot
 * remains the fast path for the coin being viewed; `disarm` through the
 * store keeps the tiers from double-firing.
 */

const LAMPORTS_PER_SOL = 1e9;

// Client-side ceiling on concurrent alert EventSources: each armed MINT
// costs one SSE connection, and the edge caps per-client connections (~50
// at the edge) shared with the trade page's own streams — an unbounded alert
// fan-out could starve the actual trading surfaces. Mints past the cap
// still get the one-shot seed-snapshot check on (re)mount, just not a live
// stream. The live subset is the MOST RECENTLY ARMED mints (base58 order
// silently killed alerts on coins the user just armed) — the arm toast
// warns when the cap is exceeded. Exported for that warning.
export const MAX_ALERT_STREAMS = 20;

export function ChartAlertsWatcher(): null {
  // Live/seed-only membership key. Live streams go to the MAX_ALERT_STREAMS
  // most recently armed mints (newest arm per mint; base58 tiebreak keeps it
  // deterministic); the rest keep only the (re)mount seed check. Each side
  // is then SORTED, so arming another alert on an already-live mint changes
  // nothing and reconnects nothing — only membership changes re-key the
  // effect below.
  const armedMintsKey = useChartAlertsStore((s) => {
    const newestArmByMint = new Map<string, number>();
    for (const alert of s.alerts) {
      const prev = newestArmByMint.get(alert.mint);
      if (prev === undefined || alert.armedAtMs > prev) {
        newestArmByMint.set(alert.mint, alert.armedAtMs);
      }
    }
    const byRecency = [...newestArmByMint.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([mint]) => mint);
    const live = byRecency.slice(0, MAX_ALERT_STREAMS).sort();
    const seedOnly = byRecency.slice(MAX_ALERT_STREAMS).sort();
    return seedOnly.length === 0 ? live.join(',') : `${live.join(',')}|${seedOnly.join(',')}`;
  });

  useEffect(() => {
    if (armedMintsKey.length === 0) return;
    const [liveKey = '', seedOnlyKey = ''] = armedMintsKey.split('|');
    const stops = [
      ...liveKey.split(',').filter((mint) => mint.length > 0).map((mint) => watchMint(mint, true)),
      ...seedOnlyKey.split(',').filter((mint) => mint.length > 0).map((mint) => watchMint(mint, false)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [armedMintsKey]);

  return null;
}

interface SeedSnapshot {
  marketCapUsd?: number | null;
  totalSupplyBaseUnits?: string;
  solUsd?: number;
}

/** Watch one mint until stopped: seed snapshot, then SSE trades.
 *  `withStream` false (past MAX_ALERT_STREAMS) keeps only the seed check. */
function watchMint(mint: string, withStream = true): () => void {
  let cancelled = false;
  let es: EventSource | null = null;
  let supplyBaseUnits = 0;
  let solUsd = 0;

  const check = (mcUsd: number) => {
    if (cancelled || !Number.isFinite(mcUsd) || mcUsd <= 0) return;
    const { alerts, disarm } = useChartAlertsStore.getState();
    fireCrossedChartAlerts(mint, mcUsd, alerts, disarm);
  };

  void fetchIngestionJson<SeedSnapshot>(`/api/token/${encodeURIComponent(mint)}`)
    .then((snap) => {
      if (cancelled || !snap) return;
      const supply = Number(snap.totalSupplyBaseUnits ?? '0');
      if (Number.isFinite(supply) && supply > 0) supplyBaseUnits = supply;
      if (typeof snap.solUsd === 'number' && snap.solUsd > 0) solUsd = snap.solUsd;
      if (typeof snap.marketCapUsd === 'number') check(snap.marketCapUsd);
    })
    .catch(() => undefined);

  const url = ingestionApiUrl(`/api/token/${encodeURIComponent(mint)}/stream`);
  let retryMs = 1_000;
  let retryTimer: number | null = null;
  const connect = () => {
    if (cancelled || !url || !withStream) return;
    const source = new EventSource(url);
    es = source;
    source.addEventListener('open', () => {
      retryMs = 1_000;
    });
    // EventSource self-retries transient errors, but a CLOSED source
    // (network change, server error on reconnect) is permanent — without
    // a manual reconnect, armed alerts silently stop firing forever.
    source.onerror = () => {
      if (cancelled || source.readyState !== EventSource.CLOSED) return;
      source.close();
      retryTimer = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };
    source.addEventListener('trade', (event) => {
      const mc = tradeEventMcUsd(
        (event as MessageEvent<string>).data,
        mint,
        supplyBaseUnits,
        solUsd,
      );
      if (mc != null) check(mc);
    });
    // Merged-snapshot pushes carry authoritative MC (and refresh the
    // supply/SOL-price factors the trade derivation uses). `snapshot_lite`
    // (Stage 5) carries the same scalars and is the ONLY recurring frame on
    // a quiet mint — without it, solUsd/MC here could go stale for hours.
    const onSnapshot = (event: Event) => {
      const snap = parseStreamPayload((event as MessageEvent<string>).data);
      if (!snap || snap['mint'] !== mint) return;
      const supply = Number(snap['totalSupplyBaseUnits'] ?? '0');
      if (Number.isFinite(supply) && supply > 0) supplyBaseUnits = supply;
      const nextSolUsd = snap['solUsd'];
      if (typeof nextSolUsd === 'number' && nextSolUsd > 0) solUsd = nextSolUsd;
      const mcUsd = snap['marketCapUsd'];
      if (typeof mcUsd === 'number') check(mcUsd);
    };
    source.addEventListener('snapshot', onSnapshot);
    source.addEventListener('snapshot_lite', onSnapshot);
  };
  connect();

  return () => {
    cancelled = true;
    if (retryTimer != null) window.clearTimeout(retryTimer);
    es?.close();
  };
}

/** Derive USD market cap from a stream trade's post-trade reserves. */
function tradeEventMcUsd(
  rawData: string,
  mint: string,
  supplyBaseUnits: number,
  solUsd: number,
): number | null {
  if (supplyBaseUnits <= 0 || solUsd <= 0) return null;
  const payload = parseStreamPayload(rawData);
  if (!payload || payload['mint'] !== mint) return null;
  const trade = payload['trade'];
  if (typeof trade !== 'object' || trade === null) return null;
  const vsr = Number((trade as Record<string, unknown>)['vsr']);
  const vtr = Number((trade as Record<string, unknown>)['vtr']);
  if (!Number.isFinite(vsr) || !Number.isFinite(vtr) || vtr <= 0) return null;
  // lamports-per-base-unit ratio × supply → lamports of MC → USD.
  return ((vsr / vtr) * supplyBaseUnits * solUsd) / LAMPORTS_PER_SOL;
}

/** Frames arrive either bare or wrapped as `{ event, payload }`. */
function parseStreamPayload(rawData: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const payload = record['payload'];
    if (typeof payload === 'object' && payload !== null) {
      return payload as Record<string, unknown>;
    }
    return record;
  } catch {
    return null;
  }
}

/**
 * Fire-and-disarm every armed alert for `mint` that the given live MC
 * satisfies. Shared by the shell watcher and the trade page's live
 * fast path — disarming through the store keeps the two tiers from
 * double-firing.
 */
export function fireCrossedChartAlerts(
  mint: string,
  mcUsd: number,
  alerts: ReadonlyArray<ArmedChartAlert>,
  disarm: (ids: ReadonlyArray<string>) => void,
): void {
  const fired = alerts.filter(
    (alert) =>
      alert.mint === mint &&
      (alert.direction === 'above' ? mcUsd >= alert.usdMc : mcUsd <= alert.usdMc),
  );
  if (fired.length === 0) return;
  disarm(fired.map((alert) => alert.id));
  playAlphaCallBell();
  const { recordFired } = useChartAlertsStore.getState();
  for (const alert of fired) {
    // Into the bell's local notification log (badge + popover row)…
    recordFired(alert, mcUsd);
    // …and the immediate toast.
    showChartAlertToast(alert, mcUsd);
  }
}

/** Rich clickable toast: coin image + ticker; click → trade page. */
function showChartAlertToast(alert: ArmedChartAlert, mcUsd: number): void {
  const id = `chart-alert-${alert.id}`;
  toast(
    <button
      type="button"
      onClick={() => {
        toast.dismiss(id);
        navigateToToken(alert.mint, { symbol: alert.ticker.replace(/^\$/, '') });
      }}
      className="flex w-full items-center gap-2.5 text-left"
      style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      aria-label={`Open ${alert.ticker} trade page`}
    >
      <CoinThumb imageUrl={alert.imageUrl} ticker={alert.ticker} />
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          {alert.ticker} crossed {alert.direction} {compactUsd(alert.usdMc, '$0')} MC
        </span>
        <span className="block text-[11px]" style={{ color: 'var(--ink-3)' }}>
          Now {compactUsd(mcUsd, '$0')} — tap to open the chart
        </span>
      </span>
    </button>,
    { id, duration: 10_000 },
  );
}

export function CoinThumb(props: {
  imageUrl: string | null;
  ticker: string;
}): React.ReactElement {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: 26,
        height: 26,
        background: 'color-mix(in srgb, var(--ink-3) 22%, transparent)',
        color: 'var(--ink-2)',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {props.imageUrl ? (
        <img
          src={props.imageUrl}
          alt=""
          width={26}
          height={26}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        props.ticker.replace(/^\$/, '').slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
