'use client';

import { useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { compactUsd } from '@/lib/format';
import { fetchIngestionJson, isIngestionApiConfigured } from '@/lib/api/ingestion';
import { useCallCard, type CallBadge, type CallCard } from '@/lib/api/frens';
import { navigateToToken } from '@/components/listen/navigation';
import type { SnapshotCandle, TokenCandlesResponse } from '@/components/trade/types';
import { dropIsolatedSpikeCandles } from '@/components/trade/snapshotAdapter';
import type { CandlestickData, Time } from 'lightweight-charts';

/**
 * Slice "Frens": the call card — a fomo-style verdict sheet for ONE
 * call. Reads top-down: caller + verdict badge → the coin's 15m chart
 * with the caller's B/S bubbles (static, one read, non-interactive) →
 * token + hero multiple → Called at / Sold at / Current MC → thesis.
 * Framed in the viewer's theme accent: hairline top/sides, a thicker
 * accent band at the bottom carrying the listen wordmark.
 *
 * Speed posture: the chart fetch fires IN PARALLEL with the card fetch
 * (openers pass mint/createdAt hints, so neither waits on the other) and
 * uses the SAME ingestion candle read the trade page loads mints with.
 */

export interface CallOpenHint {
  mint: string;
  /** ms epoch of the call; sizes the candle window. */
  createdAtMs: number | null;
}

interface Props {
  callId: string | null;
  hint: CallOpenHint | null;
  onClose: () => void;
}

const BADGE_COPY: Record<CallBadge, { label: string; color: string }> = {
  banger: { label: 'Banger', color: 'var(--up)' },
  semi_fumble: { label: 'Semi-fumble', color: '#f3c04a' },
  fumble: { label: 'Fumble', color: '#ff6a3d' },
  loss: { label: 'Loss', color: 'var(--down)' },
  holding: { label: 'Holding', color: 'var(--accent-primary)' },
};

/** Same fixed confetti as the frens page (kept local: no import cycle). */
const CONFETTI = [
  '#0f8a5f',
  '#2a5fd0',
  '#1f8fc4',
  '#b8339c',
  '#c08a12',
  '#0e93ac',
  '#6b46c8',
  '#4f9c33',
] as const;

/**
 * Deterministic caller identity: the same hash as the profile modal, so
 * a fren carries ONE color across every frens surface. `main` signs the
 * card; `soft` is its collage companion.
 */
function callerIdentity(label: string): { main: string; soft: string } {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  const index = ((hash % CONFETTI.length) + CONFETTI.length) % CONFETTI.length;
  return { main: CONFETTI[index]!, soft: CONFETTI[(index + 3) % CONFETTI.length]! };
}

/** One read, capped. Resolution ADAPTS to the call's age (below). */
const MAX_FETCH_CANDLES = 672;
/** Drawn columns cap — grouped down so bodies stay ≥ ~2px wide after
 *  pixel-snapping (below ~120 columns at card width, fractional bodies
 *  alternate 1px/2px and read as ragged gaps). */
const MAX_DRAWN_CANDLES = 160;

/**
 * Adaptive timeframe: a fixed 15m on a young call yields a few dozen
 * candles — measured live, ~60% of them rendered as 1px hairlines that
 * READ as gaps. Real chart products auto-fit resolution to span; the
 * ladder targets ~120–160 columns for any call age.
 */
const RESOLUTION_LADDER = [
  { maxSpanMs: 3 * 3600_000, resolution: '1m', bucketSec: 60 },
  { maxSpanMs: 14 * 3600_000, resolution: '5m', bucketSec: 300 },
  { maxSpanMs: 60 * 3600_000, resolution: '15m', bucketSec: 900 },
  { maxSpanMs: Number.POSITIVE_INFINITY, resolution: '1h', bucketSec: 3600 },
] as const;

function resolutionForSpan(spanMs: number): (typeof RESOLUTION_LADDER)[number] {
  return RESOLUTION_LADDER.find((step) => spanMs <= step.maxSpanMs) ?? RESOLUTION_LADDER[2];
}

function formatMultipleFromPct(pct: number): string {
  const multiple = pct / 100 + 1;
  if (multiple >= 2) return `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}x`;
  return `+${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

function formatCallDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CallDetailModal({ callId, hint, onClose }: Props): React.ReactElement {
  const query = useCallCard(callId);
  const call = query.data?.kind === 'ok' ? query.data.data : null;
  const open = callId !== null;

  // Candle read: keyed by mint only (15m latest window is viewer-agnostic),
  // fired from the HINT so it races the card fetch instead of waiting.
  // Empty-string hints (defensive fallback shapes) count as absent.
  const chartMint = (hint?.mint || call?.mint) ?? null;
  const createdAtMs = hint?.createdAtMs ?? (call ? Date.parse(call.created_at) : null);
  const chartPlan = useMemo(() => {
    const spanMs =
      createdAtMs !== null && Number.isFinite(createdAtMs)
        ? Math.max(3600_000, Date.now() - createdAtMs)
        : 24 * 3600_000;
    const step = resolutionForSpan(spanMs);
    const span = Math.ceil(spanMs / (step.bucketSec * 1000)) + 6;
    // Quantized limit: thousands of concurrent viewers produce a handful
    // of distinct (mint, resolution, limit) request shapes for client
    // caches and ingestion's cold-read coalescing, not one per call age.
    const limit = Math.min(MAX_FETCH_CANDLES, Math.ceil(span / 96) * 96);
    return { resolution: step.resolution, bucketSec: step.bucketSec, limit };
  }, [createdAtMs]);
  const candlesQuery = useQuery({
    queryKey: ['frens', 'call-candles', chartMint, chartPlan.resolution, chartPlan.limit],
    enabled: open && chartMint !== null && isIngestionApiConfigured(),
    staleTime: 60_000,
    // Bounded memory under modal-hopping: a session clicking dozens of
    // calls drops each mint's candles two minutes after close.
    gcTime: 120_000,
    queryFn: ({ signal }) =>
      fetchIngestionJson<TokenCandlesResponse>(
        `/api/token/${encodeURIComponent(chartMint ?? '')}/candles?resolution=${chartPlan.resolution}&limit=${chartPlan.limit}`,
        { signal },
      ),
  });
  const candles =
    candlesQuery.data && candlesQuery.data.mint === chartMint ? candlesQuery.data.candles : null;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="p-0 overflow-hidden"
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          maxWidth: 'none',
          background: 'var(--panel-bg, #ffffff)',
          // The frame: slim accent hairlines top/left/right; the bottom
          // edge is carried by the wordmark band below (thicker).
          border: '1px solid color-mix(in srgb, var(--accent-primary) 55%, var(--hairline))',
          borderBottom: 'none',
          borderRadius: 22,
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 44px -18px color-mix(in srgb, var(--accent-primary) 65%, transparent), 0 24px 60px rgba(11, 14, 20, 0.18)',
        }}
      >
        <DialogTitle className="sr-only">Call card</DialogTitle>
        <CallCardStyles />
        {/* Edition band: the confetti hairline that signs every frens surface. */}
        <div
          aria-hidden
          style={{
            height: 3,
            background: 'linear-gradient(90deg, #0f8a5f, #1f8fc4, #6b46c8, #b8339c, #c08a12)',
            opacity: 0.85,
          }}
        />
        {/* Aurora: a faint accent light source above the card — gives the
            sheet depth without competing with the chart. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(130% 38% at 50% -8%, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 62%)',
          }}
        />
        {call === null ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            {query.isLoading ? 'Loading call…' : 'This call is private or unavailable.'}
          </div>
        ) : (
          <CallCardBody
            call={call}
            candles={candles}
            candlesLoading={candlesQuery.isLoading}
            bucketSec={chartPlan.bucketSec}
          />
        )}
        <ListenBand />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Scoped styles: entrance choreography, hover physics, live-dot pulse.
 * Class names are namespaced (`callcard-`) so nothing bleeds; motion is
 * fully disabled under prefers-reduced-motion.
 */
export function CallCardStyles(): React.ReactElement {
  return (
    <style>{`
      @keyframes callcard-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes callcard-hero { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } }
      @keyframes callcard-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
      @keyframes callcard-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.85; } }
      .callcard-rise { animation: callcard-rise 360ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      .callcard-rise-2 { animation: callcard-rise 380ms cubic-bezier(0.22, 1, 0.36, 1) 50ms both; }
      .callcard-hero { animation: callcard-hero 420ms cubic-bezier(0.22, 1, 0.36, 1) 100ms both; }
      .callcard-rise-3 { animation: callcard-rise 400ms cubic-bezier(0.22, 1, 0.36, 1) 150ms both; }
      .callcard-cta { transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease; }
      .callcard-cta:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--accent-primary) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.22); }
      .callcard-cta:active { transform: translateY(0) scale(0.99); filter: brightness(0.97); }
      .callcard-livedot { animation: callcard-pulse 2.4s ease-in-out infinite; }
      .callcard-shimmerbar { animation: callcard-shimmer 1.4s linear infinite; }
      @media (prefers-reduced-motion: reduce) {
        .callcard-rise, .callcard-rise-2, .callcard-hero, .callcard-rise-3, .callcard-livedot, .callcard-shimmerbar { animation: none; }
      }
    `}</style>
  );
}

/** The fomo-style footer: a thick accent band signing the card. */
export function ListenBand(): React.ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        height: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background:
          'linear-gradient(100deg, var(--accent-primary) 0%, color-mix(in srgb, var(--accent-secondary, var(--accent-primary)) 85%, var(--accent-primary)) 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28)',
      }}
    >
      {/* A single diagonal light streak — foil-stamp feel, no motion. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -24,
          left: '58%',
          width: 64,
          height: 96,
          transform: 'rotate(20deg)',
          background: 'linear-gradient(90deg, transparent, rgba(11, 14, 20, 0.18), transparent)',
          pointerEvents: 'none',
        }}
      />
      {/* Floating divider: a short rule hanging dead-center between the
          wordmark and the domain — touches neither edge of the band. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 1,
          height: 20,
          borderRadius: 1,
          background: 'color-mix(in srgb, var(--accent-ink) 45%, transparent)',
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--display, var(--sans))',
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'var(--accent-ink)',
          lineHeight: 1,
          textShadow: '0 1px 0 rgba(11, 14, 20, 0.18)',
        }}
      >
        listen
      </span>
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          color: 'color-mix(in srgb, var(--accent-ink) 75%, transparent)',
        }}
      >
        listen.money
      </span>
    </div>
  );
}

export function CallCardBody({
  call,
  candles,
  candlesLoading,
  bucketSec,
}: {
  call: CallCard;
  candles: SnapshotCandle[] | null;
  candlesLoading: boolean;
  bucketSec: number;
}): React.ReactElement {
  const badge = BADGE_COPY[call.badge];
  const peakPct =
    call.called_mc_usd > 0
      ? Math.max(0, ((call.peak_mc_usd - call.called_mc_usd) / call.called_mc_usd) * 100)
      : 0;
  // A losing exit never "banked" anything — show the drawdown from the
  // call instead of a nonsense share-of-peak line (loss AND fumble alike).
  const soldAtLoss = call.sold_mc_usd !== null && call.sold_mc_usd < call.called_mc_usd;
  const lossPct =
    call.sold_mc_usd !== null && soldAtLoss && call.called_mc_usd > 0
      ? ((call.called_mc_usd - call.sold_mc_usd) / call.called_mc_usd) * 100
      : null;
  const bankedRatio =
    call.sold_mc_usd !== null && !soldAtLoss && call.peak_mc_usd > 0
      ? Math.max(0, Math.min(1, call.sold_mc_usd / call.peak_mc_usd))
      : null;
  const initials = call.caller_label.replace(/^@/, '').slice(0, 2).toUpperCase();
  const identity = callerIdentity(call.caller_label);

  return (
    <div style={{ position: 'relative', padding: '18px 18px 16px' }}>
      {/* The collage: the caller's confetti blocks bleeding off the top
          edge, clipped by the frame — same hand as the podium cards. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -20,
          right: 42,
          width: 96,
          height: 34,
          borderRadius: 10,
          background: identity.main,
          opacity: 0.85,
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -8,
          right: 118,
          width: 40,
          height: 18,
          borderRadius: 7,
          background: identity.soft,
          opacity: 0.75,
          pointerEvents: 'none',
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 4,
          right: 96,
          width: 16,
          height: 9,
          borderRadius: 4,
          background: identity.main,
          opacity: 0.4,
          pointerEvents: 'none',
        }}
      />
      {/* Caller header */}
      <div className="callcard-rise" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Gradient ring: the caller set in their own identity colors,
            like a signet — 2px gradient, 2px panel gap, then the face. */}
        <span
          aria-hidden
          style={{
            padding: 2,
            borderRadius: '50%',
            flexShrink: 0,
            display: 'inline-flex',
            background: `linear-gradient(135deg, ${identity.main}, ${identity.soft})`,
            boxShadow: `0 0 14px -4px color-mix(in srgb, ${identity.main} 60%, transparent)`,
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--ink-0)',
              border: '2px solid var(--panel-bg, #ffffff)',
              background: call.caller_avatar_data_url
                ? `center / cover no-repeat url(${JSON.stringify(call.caller_avatar_data_url)})`
                : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 55%, #333), color-mix(in srgb, var(--accent-secondary, var(--accent-primary)) 55%, #133))',
            }}
          >
            {call.caller_avatar_data_url ? null : initials}
          </span>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--ink-0)',
              letterSpacing: '-0.01em',
              minWidth: 0,
            }}
          >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {call.caller_label}
            </span>
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: 2, background: identity.main, flexShrink: 0 }}
            />
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              marginTop: 3,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.01em',
              color: badge.color,
              background: `color-mix(in srgb, ${badge.color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${badge.color} 40%, transparent)`,
              borderRadius: 7,
              padding: '2px 9px',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: badge.color,
                boxShadow: `0 0 6px ${badge.color}`,
              }}
            />
            {badge.label}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            fontFamily: 'var(--mono)',
            letterSpacing: '0.04em',
            border: '1px solid var(--hairline)',
            borderRadius: 999,
            padding: '3px 9px',
            background: 'rgba(11, 14, 20, 0.03)',
            whiteSpace: 'nowrap',
          }}
        >
          {formatCallDate(call.created_at)}
        </span>
      </div>

      {/* Chart: static candles + caller B/S bubbles */}
      <div
        className="callcard-rise-2"
        style={{
          marginTop: 14,
          borderRadius: 14,
          border: `1px solid color-mix(in srgb, ${identity.main} 20%, var(--hairline))`,
          background: `radial-gradient(140% 70% at 50% 0%, color-mix(in srgb, ${identity.main} 4%, transparent) 0%, transparent 48%), rgba(11, 14, 20, 0.18)`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          overflow: 'hidden',
        }}
      >
        <CallChart
          candles={candles}
          loading={candlesLoading}
          trades={call.caller_trades}
          calledAtMs={Date.parse(call.created_at)}
          bucketSec={bucketSec}
          callColor={identity.main}
        />
      </div>

      {/* Token + hero multiple */}
      <div className="callcard-hero" style={{ marginTop: 14, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              overflow: 'hidden',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--ink-2)',
              background: 'var(--input-bg)',
              border: '1px solid var(--hairline)',
            }}
          >
            {call.image_url ? (
              <img
                src={call.image_url}
                alt=""
                width={24}
                height={24}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              (call.ticker ?? '?').slice(0, 1).toUpperCase()
            )}
          </span>
          <span
            style={{
              fontFamily: 'var(--display, var(--sans))',
              fontStyle: 'italic',
              fontSize: 17,
              fontWeight: 400,
              letterSpacing: '0.005em',
              color: 'var(--ink-0)',
            }}
          >
            {call.name?.trim() || `$${call.ticker ?? '·'}`}
          </span>
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: 'var(--mono)',
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            // A coin that never ran doesn't get the triumphant green glow.
            color: peakPct > 0 ? 'var(--up)' : 'var(--ink-2)',
            fontVariantNumeric: 'tabular-nums',
            textShadow:
              peakPct > 0 ? '0 0 28px color-mix(in srgb, var(--up) 45%, transparent)' : 'none',
          }}
        >
          {formatMultipleFromPct(peakPct)}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            call → ATH
          </span>
          {soldAtLoss ? (
            <span style={{ marginLeft: 8, color: badge.color, fontWeight: 600 }}>
              {lossPct !== null ? `sold ${lossPct.toFixed(0)}% below the call` : 'sold below the call'}
            </span>
          ) : bankedRatio !== null ? (
            <span style={{ marginLeft: 8, color: badge.color, fontWeight: 600 }}>
              banked {(bankedRatio * 100).toFixed(0)}% of the peak
            </span>
          ) : (
            <span style={{ marginLeft: 8, color: badge.color, fontWeight: 600 }}>
              still holding
            </span>
          )}
        </div>
      </div>

      {/* Called at / Sold at / Current MC */}
      <div
        className="callcard-rise-3"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1,
          marginTop: 12,
          border: '1px solid var(--hairline)',
          borderRadius: 14,
          overflow: 'hidden',
          background: 'var(--hairline)',
        }}
      >
        <McStat tick={identity.main} label="Called at" value={compactUsd(call.called_mc_usd, '·')} />
        <McStat
          tick={badge.color}
          label="Sold at"
          value={call.sold_mc_usd !== null ? compactUsd(call.sold_mc_usd, '·') : '·'}
          tone={call.sold_mc_usd !== null ? BADGE_COPY[call.badge].color : undefined}
        />
        <McStat
          tick="#c08a12"
          label="Current MC"
          value={call.current_mc_usd !== null ? compactUsd(call.current_mc_usd, '·') : '·'}
        />
      </div>

      {/* Thesis — set like a pull quote in the caller's identity color. */}
      <div
        className="callcard-rise-3"
        style={{
          position: 'relative',
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--ink-1)',
          background: `color-mix(in srgb, ${identity.main} 4%, transparent)`,
          border: `1px solid color-mix(in srgb, ${identity.main} 14%, var(--hairline))`,
          borderLeft: `2px solid color-mix(in srgb, ${identity.main} 60%, transparent)`,
          borderRadius: 12,
          padding: '10px 14px 10px 32px',
          overflowWrap: 'anywhere',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 11,
            top: 5,
            fontFamily: 'var(--display, Georgia, serif)',
            fontStyle: 'italic',
            fontSize: 26,
            lineHeight: 1,
            color: `color-mix(in srgb, ${identity.main} 65%, transparent)`,
            userSelect: 'none',
          }}
        >
          &ldquo;
        </span>
        {call.thesis}
      </div>

      <button
        type="button"
        className="callcard-cta callcard-rise-3"
        onClick={() => navigateToToken(call.mint)}
        style={{
          marginTop: 14,
          width: '100%',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: 'var(--accent-ink)',
          background:
            'linear-gradient(135deg, var(--accent-primary), color-mix(in srgb, var(--accent-secondary, var(--accent-primary)) 80%, var(--accent-primary)))',
          border: 'none',
          borderRadius: 12,
          padding: '12px 0',
          cursor: 'pointer',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
        }}
      >
        Open chart →
      </button>
    </div>
  );
}

// ───────── static SVG candle chart ─────────

export interface DrawCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  startSec: number;
  endSec: number;
}

function toNumber(num: string, den: string): number | null {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

/** Real-candle window bound: newest N kept, oldest trimmed. */
const MAX_REAL_CANDLES = 700;

/**
 * Normalize the RAW candle payload EXACTLY the way the trade page does
 * — its charts are the working reference, so this is a faithful copy of
 * that pipeline rather than a parallel invention:
 *
 *   1. dedupe by bucket + sort ascending (the trade page's
 *      toSortedCandles contract; ours additionally SNAPS off-grid
 *      buckets into their 15m bucket and merges OHLC so mixed-resolution
 *      tails contribute instead of poisoning the series);
 *   2. NO gap filling — like lightweight-charts, only REAL candles draw,
 *      adjacent to each other, which is why trade-page charts read dense
 *      wall-to-wall (the gap-filled flats here rendered as the "gaps");
 *   3. drop isolated spike candles via the trade page's OWN exported
 *      filter, so one glitch wick can't crush the y-scale;
 *   4. group down to ≤ max drawable columns, OHLC-preserving.
 */
export function groupCandles(
  rawIn: SnapshotCandle[],
  max: number,
  bucketSec: number = 900,
): DrawCandle[] {
  interface MergedBucket extends DrawCandle {
    firstSourceSec: number;
    lastSourceSec: number;
  }
  const byBucket = new Map<number, MergedBucket>();
  for (const candle of rawIn) {
    const open = toNumber(candle.open_num, candle.open_den);
    const high = toNumber(candle.high_num, candle.high_den);
    const low = toNumber(candle.low_num, candle.low_den);
    const close = toNumber(candle.close_num, candle.close_den);
    if (open === null || high === null || low === null || close === null) continue;
    if (!Number.isFinite(candle.bucketStartSec)) continue;
    const snapped = Math.floor(candle.bucketStartSec / bucketSec) * bucketSec;
    const existing = byBucket.get(snapped);
    if (!existing) {
      byBucket.set(snapped, {
        open,
        high,
        low,
        close,
        startSec: snapped,
        endSec: snapped + bucketSec,
        firstSourceSec: candle.bucketStartSec,
        lastSourceSec: candle.bucketStartSec,
      });
    } else {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      if (candle.bucketStartSec < existing.firstSourceSec) {
        existing.open = open;
        existing.firstSourceSec = candle.bucketStartSec;
      }
      if (candle.bucketStartSec >= existing.lastSourceSec) {
        existing.close = close;
        existing.lastSourceSec = candle.bucketStartSec;
      }
    }
  }
  const sorted = [...byBucket.values()].sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) return [];

  // Spike filter: run the trade page's own exported implementation over
  // the same shape it expects, then map survivors back.
  const asSeries: CandlestickData<Time>[] = sorted.map((candle) => ({
    time: candle.startSec as Time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  const surviving = new Set(dropIsolatedSpikeCandles(asSeries).map((c) => Number(c.time)));
  const real = sorted.filter((candle) => surviving.has(candle.startSec)).slice(-MAX_REAL_CANDLES);
  if (real.length === 0) return [];

  if (real.length <= max) return real;
  const stride = Math.ceil(real.length / max);
  const grouped: DrawCandle[] = [];
  for (let i = 0; i < real.length; i += stride) {
    const bucket = real.slice(i, i + stride);
    grouped.push({
      open: bucket[0]!.open,
      close: bucket[bucket.length - 1]!.close,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      startSec: bucket[0]!.startSec,
      endSec: bucket[bucket.length - 1]!.endSec,
    });
  }
  return grouped;
}

function CallChart({
  candles,
  loading,
  trades,
  calledAtMs,
  bucketSec,
  callColor = 'var(--accent-primary)',
}: {
  candles: SnapshotCandle[] | null;
  loading: boolean;
  trades: Array<{ t_ms: number; side: 'buy' | 'sell' }>;
  calledAtMs: number;
  bucketSec: number;
  /** Color of the call-moment guide, label and post-call wash. */
  callColor?: string;
}): React.ReactElement {
  const W = 400;
  const H = 160;
  const PAD_Y = 8;

  const drawn = useMemo(
    () => (candles ? groupCandles(candles, MAX_DRAWN_CANDLES, bucketSec) : []),
    [candles, bucketSec],
  );

  if (drawn.length === 0) {
    return (
      <div
        style={{
          height: H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-3)',
          fontSize: 11,
        }}
      >
        {loading ? (
          <div
            aria-label="Loading chart"
            className="callcard-shimmerbar"
            style={{
              width: '82%',
              height: 2,
              borderRadius: 2,
              background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${callColor} 55%, transparent), transparent)`,
              backgroundSize: '200% 100%',
            }}
          />
        ) : (
          'No chart data yet.'
        )}
      </div>
    );
  }

  let min = Infinity;
  let max = -Infinity;
  for (const candle of drawn) {
    if (candle.low < min) min = candle.low;
    if (candle.high > max) max = candle.high;
  }
  if (!(max > min)) {
    max = min * 1.01 + 1e-12;
  }
  const y = (price: number): number =>
    PAD_Y + (H - 2 * PAD_Y) * (1 - (price - min) / (max - min));
  const colWidth = W / drawn.length;
  // Pixel discipline: snapped integer body edges + crispEdges rendering,
  // or fractional columns alias into alternating 1px/2px bodies (ragged
  // "gaps"). Bodies fill ~72% of the column, wicks sit on half-pixels.
  const bodyWidth = Math.max(2, Math.floor(colWidth * 0.8));

  // Map a timestamp to its candle index (clamped into range).
  const indexForMs = (tMs: number): number => {
    const sec = tMs / 1000;
    if (sec <= drawn[0]!.startSec) return 0;
    for (let i = 0; i < drawn.length; i += 1) {
      if (sec < drawn[i]!.endSec) return i;
    }
    return drawn.length - 1;
  };

  // Bubbles: cluster same-candle same-side fills into ONE marker so a
  // 50-fill scalper doesn't shingle the chart.
  const markers = new Map<string, { index: number; side: 'buy' | 'sell' }>();
  for (const trade of trades) {
    const index = indexForMs(trade.t_ms);
    markers.set(`${index}:${trade.side}`, { index, side: trade.side });
  }
  const callIndex = Number.isFinite(calledAtMs) ? indexForMs(calledAtMs) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height: H }}
      aria-label="Price chart since the call"
      role="img"
    >
      {/* Depth: three whisper-quiet gridlines. */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={0}
          x2={W}
          y1={PAD_Y + (H - 2 * PAD_Y) * f}
          y2={PAD_Y + (H - 2 * PAD_Y) * f}
          stroke="rgba(11, 14, 20, 0.05)"
          strokeWidth={1}
        />
      ))}
      {/* The era after the call: a faint accent wash, so the eye reads
          "everything right of this line happened on their word". */}
      {callIndex !== null ? (
        <rect
          x={(callIndex + 0.5) * colWidth}
          y={0}
          width={Math.max(0, W - (callIndex + 0.5) * colWidth)}
          height={H}
          fill={`color-mix(in srgb, ${callColor} 4%, transparent)`}
        />
      ) : null}
      {/* Call moment: a quiet accent guide with its label. */}
      {callIndex !== null ? (
        <g>
          <line
            x1={(callIndex + 0.5) * colWidth}
            x2={(callIndex + 0.5) * colWidth}
            y1={2}
            y2={H - 2}
            stroke={`color-mix(in srgb, ${callColor} 55%, transparent)`}
            strokeWidth={1}
            strokeDasharray="3 4"
          />
          <text
            x={
              (callIndex + 0.5) * colWidth > W - 34
                ? (callIndex + 0.5) * colWidth - 5
                : (callIndex + 0.5) * colWidth + 5
            }
            y={10}
            textAnchor={(callIndex + 0.5) * colWidth > W - 34 ? 'end' : 'start'}
            fontSize={7}
            fontWeight={700}
            letterSpacing="0.16em"
            fontFamily="var(--mono)"
            fill={`color-mix(in srgb, ${callColor} 85%, transparent)`}
          >
            CALL
          </text>
        </g>
      ) : null}
      {drawn.map((candle, index) => {
        const up = candle.close >= candle.open;
        const color = up ? 'var(--up)' : 'var(--down)';
        const cx = Math.round((index + 0.5) * colWidth * 2) / 2;
        const bodyX = Math.round(cx - bodyWidth / 2);
        const bodyTop = Math.round(y(Math.max(candle.open, candle.close)));
        const bodyBottom = Math.round(y(Math.min(candle.open, candle.close)));
        return (
          <g key={candle.startSec} shapeRendering="crispEdges">
            <line
              x1={bodyX + bodyWidth / 2}
              x2={bodyX + bodyWidth / 2}
              y1={y(candle.high)}
              y2={y(candle.low)}
              stroke={color}
              strokeWidth={1}
            />
            <rect
              x={bodyX}
              y={bodyTop}
              width={bodyWidth}
              height={Math.max(2, bodyBottom - bodyTop)}
              fill={color}
            />
          </g>
        );
      })}
      {/* Where the story stands now: a breathing dot on the last close. */}
      {(() => {
        const last = drawn[drawn.length - 1]!;
        const color = last.close >= last.open ? 'var(--up)' : 'var(--down)';
        const cx = Math.min(W - 4, (drawn.length - 0.5) * colWidth);
        const cy = y(last.close);
        return (
          <g>
            <circle
              className="callcard-livedot"
              cx={cx}
              cy={cy}
              r={6}
              fill={`color-mix(in srgb, ${color} 35%, transparent)`}
            />
            <circle cx={cx} cy={cy} r={2.2} fill={color} />
          </g>
        );
      })()}
      {[...markers.values()].map(({ index, side }) => {
        const candle = drawn[index]!;
        const cx = (index + 0.5) * colWidth;
        const cy = side === 'buy' ? Math.min(H - 12, y(candle.low) + 10) : Math.max(12, y(candle.high) - 10);
        const fill = side === 'buy' ? 'var(--up)' : '#ff6a3d';
        return (
          <g key={`${index}:${side}`}>
            <circle cx={cx} cy={cy} r={10} fill={`color-mix(in srgb, ${fill} 22%, transparent)`} />
            <circle cx={cx} cy={cy} r={7} fill={fill} stroke="rgba(11, 14, 20, 0.18)" strokeWidth={1.5} />
            <text
              x={cx}
              y={cy + 3.2}
              textAnchor="middle"
              fontSize={8.5}
              fontWeight={800}
              fill="#0b0b10"
              fontFamily="var(--mono)"
            >
              {side === 'buy' ? 'B' : 'S'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function McStat({
  label,
  value,
  tone,
  tick,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Tiny confetti mark above the label — the frens system's accent. */
  tick?: string;
}): React.ReactElement {
  return (
    <div style={{ background: 'var(--panel-bg, #ffffff)', padding: '11px 10px', textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          maxWidth: '100%',
        }}
      >
        {tick ? (
          <span
            aria-hidden
            style={{ width: 3, height: 9, borderRadius: 2, background: tick, flexShrink: 0 }}
          />
        ) : null}
        <span
          style={{
            ...mcLabelStyle,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          marginTop: 3,
          fontFamily: 'var(--mono)',
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
          color: tone ?? 'var(--ink-0)',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const mcLabelStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontFamily: 'var(--mono)',
  fontWeight: 600,
};
