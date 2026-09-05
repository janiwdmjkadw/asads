'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { compactAge, compactUsd } from '@/lib/format';
import { useFrenDetail, type FrenDetail, type TopCall } from '@/lib/api/frens';
import {
  useWalletPnl,
  type WalletPnl,
  type WalletPnlPoint,
  type WalletPnlTimeframe,
} from '@/lib/api/wallet-pnl';
import { lamportsToSol, sol1 } from './solFormat';
import { navigateToToken } from '@/components/listen/navigation';
import { Solana } from '@/components/listen/icons/Icons';

/**
 * Slice "Frens": the fren profile modal — opened by clicking any
 * caller/trader name across the Frens page. One banner-led sheet in the
 * page's confetti-geometric language: identity → the numbers that
 * matter (all-time PnL + balance depth) → their realized-PnL curve
 * (24H/7D/30D/MAX) → a stat band of sleek icon chips (incl. average
 * hold time) → their ten best calls. Every fren gets a deterministic
 * confetti IDENTITY color (hashed from their label) that signs their
 * ring, banner composition, and section marks.
 *
 * Depth data (balances, curve, hold times) rides the ingestion PnL
 * dossier for the fren's primary wallet (`useWalletPnl` — the same
 * fold behind the wallet profile modal). Frens without a linked wallet
 * simply don't render those panels.
 */

interface Props {
  userId: string | null;
  onClose: () => void;
  /** Track affordance delegated to the page (shares its tracked-set state). */
  renderTrack?: (detail: FrenDetail) => React.ReactNode;
  /** Clicking a call opens the page-level call card (stacks above). */
  onOpenCall?: (callId: string, hint: { mint: string; createdAtMs: number | null } | null) => void;
}

/** Same fixed confetti as FrensPage (kept local: page imports this file). */
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

/** Deterministic identity color: this fren always signs in this color. */
function identityColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return CONFETTI[((hash % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

function confetti(index: number): string {
  return CONFETTI[((index % CONFETTI.length) + CONFETTI.length) % CONFETTI.length]!;
}

function formatCallPct(pct: number): string {
  const multiple = pct / 100 + 1;
  if (multiple >= 2) return `${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}x`;
  return `+${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

// ───────── hold time ─────────

/** Below this remaining value a position is dust, not a live hold —
 *  same threshold the wallet dossier's Active tab uses. */
const DUST_SOL = 0.000001;

/**
 * Average hold across every traded token. Per position:
 *   - still meaningfully holding (incl. partial sells) → first buy → now;
 *   - fully exited (or dust remainder)                 → first buy → last trade;
 *   - bought but never sold AND now worthless (rugs)   → skipped — the
 *     tape has no honest exit time to measure against;
 *   - zero/negative durations and missing timestamps   → skipped.
 */
export function averageHoldMs(
  positions: ReadonlyArray<{
    firstTradeAtMs: number;
    lastTradeAtMs: number;
    remainingTokens: number;
    remainingValueSol: number | null;
    sells: number;
  }>,
  nowMs: number,
): { avgMs: number; counted: number } | null {
  let sum = 0;
  let counted = 0;
  for (const p of positions) {
    if (!Number.isFinite(p.firstTradeAtMs) || p.firstTradeAtMs <= 0) continue;
    const holding = p.remainingTokens > 0 && (p.remainingValueSol ?? 0) > DUST_SOL;
    if (!holding && p.sells === 0) continue; // rugged buy-and-hold: no exit time
    const end = holding ? nowMs : p.lastTradeAtMs;
    const duration = end - p.firstTradeAtMs;
    if (!Number.isFinite(duration) || duration <= 0) continue;
    sum += duration;
    counted += 1;
  }
  return counted > 0 ? { avgMs: sum / counted, counted } : null;
}

/** "1d 22h" / "3h 12m" / "45m" / "2mo 4d" — two units, largest first. */
export function formatDuration(ms: number): string {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const MONTH = DAY * 30.44;
  if (ms >= MONTH) {
    const months = Math.floor(ms / MONTH);
    const days = Math.floor((ms % MONTH) / DAY);
    return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
  }
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    const mins = Math.floor((ms % HOUR) / MIN);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${Math.max(1, Math.floor(ms / MIN))}m`;
}

export function FrenProfileModal({ userId, onClose, renderTrack, onOpenCall }: Props): React.ReactElement {
  const query = useFrenDetail(userId);
  const detail = query.data?.kind === 'ok' ? query.data.data : null;
  const open = userId !== null;
  // Depth data: the ingestion dossier for the fren's primary wallet.
  const pnl = useWalletPnl(detail?.primary_wallet_pubkey ?? null, open && detail !== null);

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="p-0 overflow-hidden"
        style={{
          width: 'min(600px, calc(100vw - 32px))',
          maxWidth: 'none',
          maxHeight: 'min(760px, calc(100vh - 48px))',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-1, #ffffff)',
          border: '1px solid var(--hairline-2)',
          borderRadius: 20,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 32px 90px rgba(11, 14, 20, 0.18)',
        }}
      >
        <DialogTitle className="sr-only">Fren profile</DialogTitle>
        <FrenProfileStyles />
        {/* Edition band: the confetti hairline that signs every frens surface. */}
        <div
          aria-hidden
          style={{
            height: 3,
            flexShrink: 0,
            background: 'linear-gradient(90deg, #0f8a5f, #1f8fc4, #6b46c8, #b8339c, #c08a12)',
            opacity: 0.85,
          }}
        />
        {detail === null ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            {query.isLoading ? (
              <span
                aria-label="Loading fren"
                className="frenprof-shimmer"
                style={{
                  display: 'inline-block',
                  width: '70%',
                  height: 2,
                  borderRadius: 2,
                  background:
                    'linear-gradient(90deg, transparent, rgba(11, 14, 20, 0.18), transparent)',
                  backgroundSize: '200% 100%',
                }}
              />
            ) : (
              'This fren is private or unavailable.'
            )}
          </div>
        ) : (
          <FrenProfileBody
            detail={detail}
            track={renderTrack?.(detail)}
            onOpenCall={onOpenCall}
            pnl={pnl.data ?? null}
            pnlLoading={pnl.loading}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Namespaced (`frenprof-`) styles; motion off under reduced-motion. */
export function FrenProfileStyles(): React.ReactElement {
  return (
    <style>{`
      @keyframes frenprof-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      @keyframes frenprof-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
      .frenprof-sec { animation: frenprof-rise 380ms cubic-bezier(0.16, 1, 0.3, 1) both; }
      .frenprof-sec-2 { animation: frenprof-rise 400ms cubic-bezier(0.16, 1, 0.3, 1) 60ms both; }
      .frenprof-sec-3 { animation: frenprof-rise 420ms cubic-bezier(0.16, 1, 0.3, 1) 120ms both; }
      .frenprof-shimmer { animation: frenprof-shimmer 1.4s linear infinite; }
      .frenprof-row { transition: background 120ms ease; border-radius: 8px; }
      .frenprof-row:hover { background: rgba(11, 14, 20, 0.04); }
      .frenprof-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      @media (max-width: 520px) { .frenprof-stats { grid-template-columns: repeat(2, 1fr); } }
      .frenprof-chip { transition: background 140ms ease; }
      .frenprof-chip:hover { background: linear-gradient(180deg, rgba(11, 14, 20, 0.06), rgba(11, 14, 20, 0.02) 60%), var(--surface-1, #ffffff) !important; }
      .frenprof-tf { transition: color 120ms ease, background 120ms ease; }
      @media (prefers-reduced-motion: reduce) {
        .frenprof-sec, .frenprof-sec-2, .frenprof-sec-3, .frenprof-shimmer { animation: none; }
      }
    `}</style>
  );
}

/** Default banner streaks (only when the fren hasn't set a banner). */
const BANNER_STREAKS: ReadonlyArray<{ top: number; right: number; w: number; c: string }> = [
  { top: 12, right: -30, w: 150, c: '#0f8a5f' },
  { top: 12, right: 130, w: 60, c: '#0d7a45' },
  { top: 30, right: -14, w: 100, c: '#1f8fc4' },
  { top: 30, right: 96, w: 46, c: '#b8339c' },
  { top: 48, right: -36, w: 170, c: '#c08a12' },
  { top: 66, right: -10, w: 90, c: '#0e93ac' },
];

export function FrenProfileBody({
  detail,
  track,
  onOpenCall,
  pnl = null,
  pnlLoading = false,
}: {
  detail: FrenDetail;
  track: React.ReactNode;
  onOpenCall?: (callId: string, hint: { mint: string; createdAtMs: number | null } | null) => void;
  /** Ingestion dossier for the fren's primary wallet (null: none/loading). */
  pnl?: WalletPnl | null;
  pnlLoading?: boolean;
}): React.ReactElement {
  const pnlAll = lamportsToSol(detail.trading.all.pnl_lamports);
  const settled = detail.wins + detail.losses;
  const tradeWinRate = settled > 0 ? (detail.wins / settled) * 100 : null;
  const callWinRate =
    detail.calls_count > 0 ? (detail.calls_2x / detail.calls_count) * 100 : null;
  const initials = detail.label.replace(/^@/, '').slice(0, 2).toUpperCase();
  const identity = identityColor(detail.label);

  // Balance depth — from the primary wallet's dossier.
  const solUsd = pnl?.solUsd ?? 0;
  const cashSol = pnl?.solBalanceLamports != null ? pnl.solBalanceLamports / 1e9 : null;
  const holdingsSol = pnl?.holdingsValueSol ?? null;
  const totalSol =
    holdingsSol !== null ? holdingsSol + (cashSol ?? 0) : cashSol;
  const toUsd = (v: number | null): string =>
    v === null || solUsd <= 0 ? '—' : compactUsd(Math.abs(v * solUsd), '$0');

  const hold = useMemo(
    () => (pnl ? averageHoldMs(pnl.positions, Date.now()) : null),
    [pnl],
  );

  return (
    <div className="scroll-hide" style={{ overflowY: 'auto' }}>
      {/* Banner + identity */}
      <div className="frenprof-sec" style={{ position: 'relative' }}>
        <div
          aria-hidden
          style={{
            position: 'relative',
            height: 110,
            overflow: 'hidden',
            background: detail.banner_data_url
              ? `center / cover no-repeat url(${JSON.stringify(detail.banner_data_url)})`
              /* The default banner, when a fren has set none. It ran
                 from a near black into the card, which was a fade to
                 the card's own ground — and the ground moved. It fades
                 out of a soft ink into paper now, so the streaks still
                 have something to sit on and the avatar's ring still
                 has an edge to break. */
              : 'linear-gradient(180deg, #eef1f0 0%, #ffffff 100%)',
          }}
        >
          {detail.banner_data_url ? null : (
            <>
              {/* Default banner: the fren's own confetti composition. */}
              {BANNER_STREAKS.map((bar, index) => (
                <span
                  key={index}
                  style={{
                    position: 'absolute',
                    top: bar.top,
                    right: bar.right,
                    width: bar.w,
                    height: 10,
                    borderRadius: 999,
                    background: bar.c,
                    opacity: 0.85,
                  }}
                />
              ))}
              <span
                style={{
                  position: 'absolute',
                  left: 118,
                  bottom: -26,
                  fontFamily: 'var(--display)',
                  fontStyle: 'italic',
                  fontSize: 96,
                  lineHeight: 1,
                  color: identity,
                  opacity: 0.14,
                  userSelect: 'none',
                }}
              >
                {initials.slice(0, 1).toLowerCase()}
              </span>
            </>
          )}
        </div>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, var(--surface-1, #ffffff) 0%, transparent 55%)',
            pointerEvents: 'none',
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 24,
            bottom: -30,
            width: 72,
            height: 72,
            borderRadius: '50%',
            border: '3px solid var(--surface-1, #ffffff)',
            boxShadow: `0 0 0 2px color-mix(in srgb, ${identity} 70%, transparent), 0 0 18px -4px color-mix(in srgb, ${identity} 55%, transparent)`,
            background: detail.avatar_data_url
              ? `center / cover no-repeat url(${JSON.stringify(detail.avatar_data_url)})`
              : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 55%, #333), color-mix(in srgb, var(--accent-secondary, var(--accent-primary)) 55%, #133))',
            color: 'var(--ink-0)',
            fontSize: 22,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {detail.avatar_data_url ? null : initials}
        </span>
      </div>

      <div style={{ padding: '38px 24px 8px' }}>
        <div className="frenprof-sec" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--ink-0)',
                letterSpacing: '-0.01em',
                minWidth: 0,
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {detail.label}
              </span>
              <span
                aria-hidden
                style={{ width: 7, height: 7, borderRadius: 2, background: identity, flexShrink: 0 }}
              />
            </div>
            {detail.bio ? (
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.45 }}>
                {detail.bio}
              </div>
            ) : null}
          </div>
          {track}
        </div>

        {/* THE DATA SHEET: one framed object, every region separated by
            crisp internal hairlines (1px gaps over the hairline color). */}
        <div
          className="frenprof-sec-2"
          style={{
            marginTop: 16,
            border: '1px solid var(--hairline-2)',
            borderRadius: 14,
            overflow: 'hidden',
            display: 'grid',
            gap: 1,
            background: 'var(--hairline)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Row 1: PnL | Balance — split by an internal vertical line. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.12fr) minmax(0, 1fr)',
              gap: 1,
              background: 'var(--hairline)',
            }}
          >
            {/* PnL cell */}
            <div style={{ ...cellStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Eyebrow color={identity}>ALL-TIME PNL</Eyebrow>
              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  color: pnlAll >= 0 ? 'var(--up)' : 'var(--down)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {/* No token mark. The figure is this fren's all time
                    PnL and the whole card is denominated in SOL — a
                    logo in front of it is a second thing to read
                    before the number, saying what the number already
                    says. */}
                {pnlAll >= 0 ? '+' : ''}
                {sol1(pnlAll)}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                {(
                  [
                    ['7D', detail.trading.d7],
                    ['30D', detail.trading.d30],
                  ] as const
                ).map(([label, agg]) => {
                  const v = lamportsToSol(agg.pnl_lamports);
                  return (
                    <span key={label} style={miniChipStyle}>
                      {label}{' '}
                      <span style={{ color: v >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {v >= 0 ? '+' : ''}
                        {sol1(v)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Balance cell — from the primary wallet's dossier. */}
            <div style={{ ...cellStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Eyebrow color={identity}>TOTAL BALANCE</Eyebrow>
              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--ink-0)',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {pnlLoading && !pnl ? '…' : toUsd(totalSol)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 'auto' }}>
                <BalanceLine label="Holdings" value={toUsd(holdingsSol)} />
                <BalanceLine
                  label="Cash · SOL"
                  value={cashSol === null ? '—' : `${toUsd(cashSol)} · ${sol1(cashSol)} ◎`}
                />
              </div>
            </div>
          </div>

          {/* Row 2: the performance curve. */}
          <div style={cellStyle}>
            <FrenPerfSection pnl={pnl} loading={pnlLoading} identity={identity} />
          </div>

          {/* Row 3: stat cells — icon badges, internal vertical lines. */}
          <div className="frenprof-stats" style={{ gap: 1, background: 'var(--hairline)' }}>
            <StatChip
              icon={<TargetIcon />}
              label="TRADE WIN RATE"
              value={tradeWinRate === null ? '·' : `${tradeWinRate.toFixed(1)}%`}
              sub={settled > 0 ? `${detail.wins}W / ${detail.losses}L` : undefined}
            />
            <StatChip
              icon={<MegaphoneMini />}
              label="CALL WIN RATE"
              value={callWinRate === null ? '·' : `${callWinRate.toFixed(0)}%`}
              sub={detail.calls_count > 0 ? `${detail.calls_2x} of ${detail.calls_count} hit 2x` : 'no calls yet'}
            />
            <StatChip
              icon={<ClockIcon />}
              label="AVG HOLD"
              value={hold === null ? (pnlLoading ? '…' : '·') : formatDuration(hold.avgMs)}
              sub={hold !== null ? `across ${hold.counted} token${hold.counted === 1 ? '' : 's'}` : 'no closed holds yet'}
            />
            <StatChip
              icon={<Solana style={{ width: 13, height: 13 }} />}
              label="VOLUME"
              value={sol1(lamportsToSol(detail.trading.all.volume_lamports))}
              sub="all-time ◎"
            />
            <StatChip
              icon={<PulseIcon />}
              label="TRADES"
              value={String(detail.trading.all.trades)}
              sub={
                pnl && pnl.positions.length > 0
                  ? `${pnl.positions.length} token${pnl.positions.length === 1 ? '' : 's'} touched`
                  : undefined
              }
            />
            {/* Filler cell keeps the hairline grid rectangular when the
                5 stats leave an odd slot. */}
            <span aria-hidden style={{ background: 'var(--surface-1, #ffffff)' }} />
          </div>
        </div>

        {/* Top calls */}
        <div className="frenprof-sec-3" style={{ marginTop: 20, paddingBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Eyebrow color={identity}>TOP CALLS</Eyebrow>
            {detail.best_call_pct !== null ? (
              <span
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--up)',
                }}
              >
                best {formatCallPct(detail.best_call_pct)}
              </span>
            ) : null}
          </div>
          {detail.top_calls.length === 0 ? (
            <div style={{ padding: '18px 0', color: 'var(--ink-3)', fontSize: 12 }}>
              No calls yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 4 }}>
              {detail.top_calls.map((call, index) => (
                <CallLine key={call.call_id} call={call} rank={index + 1} onOpenCall={onOpenCall} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────── performance curve ─────────

const TIMEFRAMES: readonly { id: WalletPnlTimeframe; label: string }[] = [
  { id: '1d', label: '24H' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'max', label: 'MAX' },
];

const DAY_MS = 86_400_000;
const CHART_W = 520;
const CHART_H = 110;

interface SeriesSlice {
  points: WalletPnlPoint[];
  baseline: number;
  finalValue: number;
}

/** Window the realized series, carrying the pre-window level in as the
 *  opening point so every curve starts at 0 (same math as the wallet
 *  dossier chart). */
function sliceSeries(pnl: WalletPnl | null, timeframe: WalletPnlTimeframe): SeriesSlice | null {
  if (!pnl || pnl.series.length === 0) return null;
  const cutoff =
    timeframe === 'max'
      ? Number.NEGATIVE_INFINITY
      : Date.now() - (timeframe === '1d' ? 1 : timeframe === '7d' ? 7 : 30) * DAY_MS;
  const inWindow = pnl.series.filter((p) => p.tMs >= cutoff);
  const before = pnl.series.filter((p) => p.tMs < cutoff);
  const baseline = before.length > 0 ? before[before.length - 1]!.realizedSol : 0;
  const points: WalletPnlPoint[] =
    inWindow.length > 0
      ? [{ tMs: Math.max(cutoff, inWindow[0]!.tMs - 1), realizedSol: baseline }, ...inWindow]
      : [];
  if (points.length === 0) return null;
  return { points, baseline, finalValue: points[points.length - 1]!.realizedSol - baseline };
}

function FrenPerfSection({
  pnl,
  loading,
  identity,
}: {
  pnl: WalletPnl | null;
  loading: boolean;
  identity: string;
}): React.ReactElement {
  const [timeframe, setTimeframe] = useState<WalletPnlTimeframe>('max');
  const slice = useMemo(() => sliceSeries(pnl, timeframe), [pnl, timeframe]);
  const tone = slice && slice.finalValue < 0 ? 'var(--down)' : 'var(--up)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Eyebrow color={identity}>PERFORMANCE</Eyebrow>
          {slice ? (
            <span
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: tone,
                whiteSpace: 'nowrap',
              }}
            >
              {slice.finalValue >= 0 ? '+' : ''}
              {sol1(slice.finalValue)} ◎
            </span>
          ) : null}
        </span>
        {/* Sleek window buttons. */}
        <span
          style={{
            display: 'inline-flex',
            gap: 2,
            padding: 2,
            borderRadius: 9,
            border: '1px solid var(--hairline)',
            background: 'rgba(11, 14, 20, 0.03)',
            flexShrink: 0,
          }}
        >
          {TIMEFRAMES.map((t) => {
            const active = t.id === timeframe;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeframe(t.id)}
                aria-pressed={active}
                className="frenprof-tf"
                style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  padding: '3px 7px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  color: active ? 'var(--ink-0)' : 'var(--ink-3)',
                  background: active
                    ? `color-mix(in srgb, ${identity} 16%, transparent)`
                    : 'transparent',
                  boxShadow: active
                    ? `inset 0 0 0 1px color-mix(in srgb, ${identity} 40%, transparent)`
                    : undefined,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </span>
      </div>
      <div style={{ height: CHART_H }}>
        {slice && slice.points.length > 1 ? (
          <FrenPerfChart slice={slice} />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-3)',
              fontSize: 11,
            }}
          >
            {loading && !pnl
              ? 'reading the tape…'
              : pnl === null
                ? 'no wallet linked yet'
                : 'no realized trades in this window'}
          </div>
        )}
      </div>
    </div>
  );
}

/** The realized-PnL curve: gradient area + glow tip, draw-in on window
 *  switch. Pure SVG — weighs nothing, matches the ink exactly. */
function FrenPerfChart({ slice }: { slice: SeriesSlice }): React.ReactElement {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    const handle = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(handle);
  }, [slice]);

  const tone = slice.finalValue >= 0 ? 'var(--up)' : 'var(--down)';
  const geometry = useMemo(() => {
    const values = slice.points.map((p) => p.realizedSol - slice.baseline);
    const t0 = slice.points[0]!.tMs;
    const t1 = slice.points[slice.points.length - 1]!.tMs;
    const spanT = Math.max(t1 - t0, 1);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (max - min < 1e-9) {
      max += 1;
      min -= 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const x = (tMs: number) => ((tMs - t0) / spanT) * CHART_W;
    const y = (value: number) => CHART_H - ((value - min) / (max - min)) * CHART_H;
    const coords = slice.points.map((p, i) => ({ px: x(p.tMs), py: y(values[i]!) }));
    const line = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.px.toFixed(1)},${c.py.toFixed(1)}`)
      .join(' ');
    const area = `${line} L${CHART_W},${CHART_H} L0,${CHART_H} Z`;
    return { coords, line, area, zeroY: y(0) };
  }, [slice]);

  const last = geometry.coords[geometry.coords.length - 1]!;
  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden
    >
      <defs>
        <linearGradient id="frenprof-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.08" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        x2={CHART_W}
        y1={geometry.zeroY}
        y2={geometry.zeroY}
        stroke="var(--hairline)"
        strokeDasharray="3 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={geometry.area}
        fill="url(#frenprof-fill)"
        style={{ opacity: drawn ? 1 : 0, transition: 'opacity 600ms var(--ease-out, ease-out)' }}
      />
      <path
        d={geometry.line}
        fill="none"
        stroke={tone}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={drawn ? 0 : 1}
        style={{ transition: 'stroke-dashoffset 700ms var(--ease-out, ease-out)' }}
      />
      <circle
        cx={last.px}
        cy={last.py}
        r={3}
        fill={tone}
        style={{
          opacity: drawn ? 1 : 0,
          transition: 'opacity 300ms var(--ease-out, ease-out) 500ms',
        }}
      />
    </svg>
  );
}

// ───────── chrome ─────────

/** A data-sheet cell: solid surface between the internal hairlines. */
const cellStyle: CSSProperties = {
  padding: '13px 16px',
  minWidth: 0,
  background:
    'linear-gradient(180deg, rgba(11, 14, 20, 0.03), rgba(11, 14, 20, 0.004) 55%), var(--surface-1, #ffffff)',
};

const miniChipStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--ink-3)',
  fontFamily: 'var(--sans)',
  fontWeight: 600,
  letterSpacing: '0.05em',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '4px 9px',
  background: 'rgba(11, 14, 20, 0.03)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

function BalanceLine({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--sans)',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-1)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Eyebrow({ color, children }: { color: string; children: string }): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span aria-hidden style={{ width: 12, height: 4, borderRadius: 999, background: color }} />
      <span style={eyebrowStyle}>{children}</span>
    </span>
  );
}

/** A stat cell: icon badge + numeral, living between the sheet's
 *  internal hairlines. */
function StatChip({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}): React.ReactElement {
  return (
    <div
      className="frenprof-chip"
      style={{
        padding: '11px 12px 10px',
        minWidth: 0,
        background:
          'linear-gradient(180deg, rgba(11, 14, 20, 0.03), rgba(11, 14, 20, 0.004) 60%), var(--surface-1, #ffffff)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--ink-1)',
            background: 'rgba(11, 14, 20, 0.06)',
            border: '1px solid var(--hairline)',
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            ...eyebrowStyle,
            fontSize: 8.5,
            letterSpacing: '0.1em',
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
          fontFamily: 'var(--sans)',
          fontSize: 16,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-0)',
          whiteSpace: 'nowrap',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontSize: 9,
            color: 'var(--ink-3)',
            marginTop: 3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

// ───────── icons (12-13px, 1.6 stroke — the chip badge set) ─────────

function ClockIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </svg>
  );
}

function TargetIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} style={{ width: 13, height: 13 }} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MegaphoneMini(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden>
      <path d="M3 11l14-6v14L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 11-5.8-1.6" />
    </svg>
  );
}

function PulseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }} aria-hidden>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </svg>
  );
}

function CallLine({
  call,
  rank,
  onOpenCall,
}: {
  call: TopCall;
  rank: number;
  onOpenCall?: (callId: string, hint: { mint: string; createdAtMs: number | null } | null) => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="frenprof-row"
      onClick={() =>
        onOpenCall
          ? onOpenCall(call.call_id, { mint: call.mint, createdAtMs: Date.parse(call.created_at) })
          : navigateToToken(call.mint)
      }
      title={call.thesis}
      style={{
        display: 'grid',
        gridTemplateColumns: '30px 30px minmax(70px, auto) 1fr auto auto',
        alignItems: 'center',
        gap: 10,
        padding: '9px 6px',
        background: 'transparent',
        border: 'none',
        borderTop: rank === 1 ? 'none' : '1px solid color-mix(in srgb, var(--hairline) 55%, transparent)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span
          aria-hidden
          style={{
            width: 3,
            height: 12,
            borderRadius: 2,
            background: confetti(rank - 1),
            opacity: rank <= 3 ? 1 : 0.3,
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--ink-3)' }}>{rank}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--ink-2)',
        }}
      >
        {call.image_url ? (
          <img src={call.image_url} alt="" width={26} height={26} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          (call.ticker ?? '?').slice(0, 1).toUpperCase()
        )}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)', whiteSpace: 'nowrap' }}>
        ${call.ticker ?? '·'}
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {call.thesis}
      </span>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 10, color: 'var(--ink-3)' }}>
        {compactAge(Date.now() - Date.parse(call.created_at))}
      </span>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 700, color: 'var(--up)', textAlign: 'right', minWidth: 52 }}>
        {formatCallPct(call.pct)}
      </span>
    </button>
  );
}

const eyebrowStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.16em',
  color: 'var(--ink-3)',
  fontFamily: 'var(--sans)',
  fontWeight: 600,
};
