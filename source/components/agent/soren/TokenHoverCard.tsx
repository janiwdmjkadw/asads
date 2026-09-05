'use client';

/**
 * The glimpse (spec/10-system.md §1.4.2) — the ONE picture Soren points
 * at, reached through the token tag. A pearl pane at the reply width,
 * UNDER the paragraph (flipping above the tag when the composer is too
 * close), carrying identity · price · the 336×64 lime chart · a dotted
 * hairline · the four stats. No live dot, no actions, no axes — all of
 * those were built and rejected on the record.
 *
 * Data: one seed snapshot (`GET /api/token/:mint?hydrateIdentity=1` —
 * identity, price, mcap, volume, embedded candles) plus the first
 * holders page (count + top-10 share). Cached per mint for a minute so
 * re-hovers in a conversation cost nothing.
 *
 * The chart hover is the Stocks behaviour the owner picked: a thin solid
 * hairline at the pointer, a filled lime dot on the line, ONLY the time
 * above the chart — the hovered value updates the big price row instead
 * of labelling the dot ("gross").
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUsdPrice } from '@/lib/agent/atoms';
import { fetchIngestionJson, ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { compactUsd } from '@/lib/format';
import { useResolvedTokenImage } from '@/lib/token-image';
import {
  cardPosition,
  chartGeometry,
  rationalToNumber,
  scrubIndex,
  scrubTime,
  subscribeTokenHover,
  windowChangePct,
  type HoverRequest,
} from './hoverCard';

const CARD_W = 370;
const CHART_W = 336;
const CHART_H = 64;
const CARD_H_ESTIMATE = 241; // measured on the FINAL board (§1.4.2)
const OPEN_DELAY_MS = 160;
const CLOSE_DELAY_MS = 140;
const CACHE_TTL_MS = 60_000;
/** Points the 64px chart draws — about an hour of 1m closes. */
const CHART_POINTS = 60;

/** The slice of the seed snapshot the pane reads — defensively optional. */
interface SeedSlice {
  name?: string | null;
  symbol?: string | null;
  priceUsdPerToken?: number;
  marketCapUsd?: number;
  vol24hUsd?: number;
  vol5mUsd?: number;
  candles?: Partial<
    Record<string, Array<{ bucketStartSec: number; close_num: string; close_den: string }>>
  >;
}

interface HoldersSlice {
  total?: number;
  holders?: Array<{ supplyPct?: number }>;
}

interface GlimpseData {
  readonly name: string;
  readonly symbol: string;
  readonly priceUsd: number | null;
  readonly mcapUsd: number | null;
  readonly volUsd: number | null;
  readonly holdersCount: number | null;
  readonly top10Pct: number | null;
  readonly closes: readonly number[];
  readonly bucketsSec: readonly number[];
}

const cache = new Map<string, { at: number; data: GlimpseData }>();

async function loadGlimpse(mint: string, signal: AbortSignal): Promise<GlimpseData> {
  const cached = cache.get(mint);
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const [seed, holders] = await Promise.all([
    fetchIngestionJson<SeedSlice>(`/api/token/${encodeURIComponent(mint)}?hydrateIdentity=1`, {
      signal,
    }),
    fetchIngestionJson<HoldersSlice>(
      `/api/token/${encodeURIComponent(mint)}/holders?limit=10&page=1`,
      { signal },
    ).catch(() => null),
  ]);
  const series = seed.candles?.['1m'] ?? seed.candles?.['5m'] ?? seed.candles?.['1s'] ?? [];
  const tail = series.slice(-CHART_POINTS);
  const closes = tail.map((c) => rationalToNumber(c.close_num, c.close_den));
  const top10 =
    holders?.holders !== undefined && holders.holders.length > 0
      ? holders.holders
          .slice(0, 10)
          .reduce((sum, h) => sum + (Number.isFinite(h.supplyPct) ? (h.supplyPct ?? 0) : 0), 0)
      : null;
  const data: GlimpseData = {
    name: seed.name ?? '—',
    symbol: seed.symbol ?? '',
    priceUsd: Number.isFinite(seed.priceUsdPerToken) ? (seed.priceUsdPerToken ?? null) : null,
    mcapUsd: Number.isFinite(seed.marketCapUsd) ? (seed.marketCapUsd ?? null) : null,
    volUsd:
      seed.vol24hUsd !== undefined && Number.isFinite(seed.vol24hUsd)
        ? seed.vol24hUsd
        : Number.isFinite(seed.vol5mUsd)
          ? (seed.vol5mUsd ?? null)
          : null,
    holdersCount: holders?.total ?? null,
    top10Pct: top10,
    closes,
    bucketsSec: tail.map((c) => c.bucketStartSec),
  };
  cache.set(mint, { at: Date.now(), data });
  return data;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ag-glimpse-stat">
      <div className="ag-glimpse-stat-k">{label}</div>
      <div className="ag-glimpse-stat-v">{value}</div>
    </div>
  );
}

function GlimpsePane({ request }: { request: HoverRequest }) {
  const { mint } = request;
  const [data, setData] = useState<GlimpseData | null>(cache.get(mint)?.data ?? null);
  const [scrub, setScrub] = useState<number | null>(null);
  const image = useResolvedTokenImage(ingestionTokenImageUrl(mint), null, mint);

  useEffect(() => {
    setScrub(null);
    const controller = new AbortController();
    loadGlimpse(mint, controller.signal)
      .then((d) => setData(d))
      .catch(() => undefined); // the pane simply stays in its quiet state
    return () => controller.abort();
  }, [mint]);

  const geometry = useMemo(
    () => (data === null ? null : chartGeometry(data.closes, CHART_W, CHART_H)),
    [data],
  );
  const change = useMemo(() => (data === null ? null : windowChangePct(data.closes)), [data]);

  const scrubbed = scrub !== null && data !== null && data.closes[scrub] !== undefined;
  const shownPrice = scrubbed ? data.closes[scrub] : (data?.priceUsd ?? null);
  const symbol = data?.symbol !== undefined && data.symbol !== '' ? `$${data.symbol}` : request.label;

  return (
    <div className="ag-glimpse" data-testid="agent-glimpse">
      <div className="ag-glimpse-id">
        {image.isPlaceholder ? (
          <span aria-hidden className="ag-glimpse-art ag-glimpse-art--letter">
            {symbol.replace(/^\$/, '').slice(0, 1).toUpperCase()}
          </span>
        ) : (
          <img
            src={image.src}
            alt=""
            width={24}
            height={24}
            onError={image.onError}
            onLoad={image.onLoad}
            className="ag-glimpse-art"
          />
        )}
        <span className="ag-glimpse-name">{data?.name ?? '—'}</span>
        <span className="ag-glimpse-sym">{symbol}</span>
      </div>
      <div className="ag-glimpse-price-row">
        <span className="ag-glimpse-price">
          {shownPrice !== null ? formatUsdPrice(shownPrice) : '—'}
        </span>
        {change !== null ? (
          <span className="ag-glimpse-chg" data-tone={change < 0 ? 'red' : 'green'}>
            {`${change < 0 ? '−' : '+'}${Math.abs(change).toFixed(1)}%`}
          </span>
        ) : null}
      </div>
      <div className="ag-glimpse-chart-slot">
        {scrubbed && data !== null ? (
          <div className="ag-glimpse-time" style={{ left: geometry?.xs[scrub] ?? 0 }}>
            {scrubTime(data.bucketsSec[scrub] ?? 0)}
          </div>
        ) : null}
        {geometry !== null ? (
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            width={CHART_W}
            height={CHART_H}
            className="ag-glimpse-chart"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setScrub(scrubIndex(geometry.xs, e.clientX - rect.left));
            }}
            onMouseLeave={() => setScrub(null)}
          >
            <defs>
              <linearGradient id={`agw-${mint.slice(0, 8)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#D9F0B8" stopOpacity="0.14" />
                <stop offset="1" stopColor="#D9F0B8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={geometry.wash} fill={`url(#agw-${mint.slice(0, 8)})`} />
            <path d={geometry.line} fill="none" stroke="#D9F0B8" strokeWidth="1.5" />
            {scrubbed ? (
              <>
                <line
                  x1={geometry.xs[scrub]}
                  x2={geometry.xs[scrub]}
                  y1="0"
                  y2={CHART_H}
                  stroke="var(--d-tokenhovercard-1, #0B0E14)"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
                <circle cx={geometry.xs[scrub]} cy={geometry.ys[scrub]} r="3.5" fill="#D9F0B8" />
              </>
            ) : null}
          </svg>
        ) : (
          <div className="ag-glimpse-chart ag-glimpse-chart--empty" />
        )}
      </div>
      <svg className="ag-glimpse-rule" width="100%" height="1" aria-hidden>
        <line x1="0" x2="100%" y1="0.5" y2="0.5" stroke="var(--d-tokenhovercard-2, #0B0E14)" strokeOpacity="0.18" strokeDasharray="2 4" />
      </svg>
      <div className="ag-glimpse-stats">
        <Stat label="MCAP" value={compactUsd(data?.mcapUsd, '—')} />
        <Stat label="VOL" value={compactUsd(data?.volUsd, '—')} />
        <Stat
          label="HOLDERS"
          value={data?.holdersCount != null ? data.holdersCount.toLocaleString('en-US') : '—'}
        />
        <Stat label="TOP-10" value={data?.top10Pct != null ? `${data.top10Pct.toFixed(1)}%` : '—'} />
      </div>
    </div>
  );
}

/**
 * The layer: mounted once by the conversation (soren only). Debounces the
 * tag's enter/leave, keeps the card open while the pointer is on it, and
 * positions it under the paragraph with the flip rule.
 */
export function SorenTokenHoverLayer() {
  const [request, setRequest] = useState<HoverRequest | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overCard = useRef(false);

  useEffect(() => {
    const clear = () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      openTimer.current = null;
      closeTimer.current = null;
    };
    const off = subscribeTokenHover((next) => {
      clear();
      if (next !== null) {
        openTimer.current = setTimeout(() => setRequest(next), OPEN_DELAY_MS);
      } else {
        closeTimer.current = setTimeout(() => {
          if (!overCard.current) setRequest(null);
        }, CLOSE_DELAY_MS);
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRequest(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      clear();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (request === null) return null;
  const bounds = { top: 8, bottom: typeof window !== 'undefined' ? window.innerHeight : 800 };
  const pos = cardPosition(request.anchor, CARD_H_ESTIMATE, bounds.top, bounds.bottom);
  const left = Math.max(
    8,
    Math.min(request.anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - CARD_W - 8),
  );
  return (
    <div
      className="ag-glimpse-layer"
      style={{ top: pos.top, left }}
      onMouseEnter={() => {
        overCard.current = true;
      }}
      onMouseLeave={() => {
        overCard.current = false;
        setRequest(null);
      }}
    >
      <GlimpsePane request={request} />
    </div>
  );
}
