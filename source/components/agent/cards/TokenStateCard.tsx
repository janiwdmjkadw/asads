'use client';

/**
 * Token analysis card — the rich renderer for a completed
 * `get_token_state` tool result, optionally fed by a paired
 * `get_token_chart` result (sparkline + change pill). Anatomy follows
 * 50-token-data mock A, states per mock E:
 *
 *   - 28px real token art from the ingestion proxy (built from the MINT
 *     alone — never a metadata-supplied url), letter square demoted to
 *     the fallback state;
 *   - freshness and age are separate questions: the top-right beat says
 *     how old the QUOTE is, the identity subline says how old the TOKEN
 *     is. The mint itself is NOT printed — an address on a card surface
 *     is noise the reader cannot use (owner directive, Aug 7 2026);
 *   - past `STALE_AFTER_MS` the beat, its label and one explicit hint
 *     line go amber and the numbers step back one ink level — a stale
 *     price shown as if live is the failure mode that costs money;
 *   - four metrics (mcap / vol / holders / top10), the last two from the
 *     turn-local holders join; a missing cell is an em dash and the
 *     silhouette never changes;
 *   - footer is socials + the graduation badge. The tool-name repeat is
 *     gone — the activity group above the card owns tool names.
 *
 * Every field is nullable: the card renders whatever survives parsing.
 * All values render as TEXT — tool payloads are data, never markup —
 * and social hrefs are the ones `safeSocialUrl` accepted (http/https).
 */

import { useId } from 'react';
import { compactAge, compactNumber, compactUsd, formatPriceUsd } from '@/lib/format';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import type { ChartView, TokenStateView } from '@/lib/agent/view';

/** Past this, the quote is stale: amber beat + the refresh hint (mock E). */
export const STALE_AFTER_MS = 60_000;

/* The app's own face, not the mono. Every figure in the chat used
   to be set in the printout voice the rest of the terminal has
   dropped — the zero gives it away beside any other number on
   screen. `tabular-nums` rides along wherever a figure needs its
   columns to line up, which is what the mono was really for. */
const MONO = { fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums' } as const;

/** A translucent tint of a token colour — pill washes. */
function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

function Sparkline({
  points,
  up,
  stale,
}: {
  points: readonly { close: number }[];
  up: boolean;
  stale: boolean;
}) {
  const gradientId = useId();
  if (points.length < 2) return null;

  const W = 100;
  const H = 30;
  const PAD = 2;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.close < min) min = p.close;
    if (p.close > max) max = p.close;
  }
  const span = max - min;
  const x = (i: number): number => (i / (points.length - 1)) * W;
  const y = (close: number): number =>
    span <= 0 ? H / 2 : PAD + (H - 2 * PAD) * (1 - (close - min) / span);
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const color = up ? 'var(--up)' : 'var(--down)';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className="h-10 w-full"
      style={stale ? { opacity: 0.7 } : undefined}
      data-testid="agent-card-sparkline"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.26" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 28px token art. The proxy route needs nothing but the mint, so it is
 * the one image source the agent card can reach without new tool
 * payload; `useResolvedTokenImage` owns the failure ladder, and the
 * letter square stands in the moment it bottoms out at the placeholder.
 */
function TokenArt({ mint, letter }: { mint: string | null; letter: string }) {
  const proxySrc = mint !== null ? ingestionTokenImageUrl(mint) : null;
  const image = useResolvedTokenImage(proxySrc, null, mint);
  const box = 'h-7 w-7 shrink-0 rounded-[7px] border border-[var(--hairline-2)]';

  if (proxySrc === null || image.isPlaceholder) {
    return (
      <span
        aria-hidden
        data-testid="agent-card-token-art-fallback"
        className={`${box} inline-flex items-center justify-center bg-[var(--flame-wash)] text-[12px] font-medium text-[var(--flame)]`}
        style={MONO}
      >
        {letter}
      </span>
    );
  }
  return (
    <img
      src={image.src}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      decoding="async"
      onError={image.onError}
      onLoad={image.onLoad}
      data-testid="agent-card-token-art"
      className={`${box} block bg-[var(--surface-3)] object-cover`}
    />
  );
}

function Metric({ label, value, stale }: { label: string; value: string; stale: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}</div>
      <div
        className={`truncate text-[12px] font-medium tabular-nums ${stale ? 'text-[var(--ink-1)]' : 'text-[var(--ink-0)]'}`}
        style={MONO}
      >
        {value}
      </div>
    </div>
  );
}

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-[15px] w-[15px] items-center justify-center text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
    >
      {children}
    </a>
  );
}

const ICON = { width: 11, height: 11, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export function formatChangePct(changePct: number): string {
  const sign = changePct > 0 ? '+' : '';
  return `${sign}${changePct.toFixed(1)}%`;
}

export function TokenStateCard({
  state,
  chart,
  nowMs = Date.now(),
}: {
  state: TokenStateView;
  chart: ChartView | null;
  nowMs?: number;
}) {
  const symbol = state.symbol ?? state.name ?? '?';
  const letter = symbol.slice(0, 1).toUpperCase();
  const changePct = chart?.changePct ?? null;
  const points = chart?.points ?? [];
  const up =
    changePct !== null
      ? changePct >= 0
      : points.length >= 2
        ? points[points.length - 1].close >= points[0].close
        : true;

  const quoteAgeMs = state.asOfMs !== null ? Math.max(0, nowMs - state.asOfMs) : null;
  const stale = quoteAgeMs !== null && quoteAgeMs >= STALE_AFTER_MS;
  const beat = stale ? 'var(--hold)' : 'var(--up)';

  // `created_at_ms` is when INGESTION first saw the token, not genesis —
  // the tool flags it `age_is_lower_bound`, so the card says "at least".
  const createdAge =
    state.createdAtMs !== null && state.createdAtMs <= nowMs
      ? compactAge(nowMs - state.createdAtMs)
      : null;

  const pumpFunHref =
    state.mint !== null ? `https://pump.fun/${encodeURIComponent(state.mint)}` : null;

  return (
    <div
      data-testid="agent-card-token-state"
      data-stale={stale ? 'true' : undefined}
      className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-2)] px-3 pb-2.5 pt-2.5"
    >
      <div className="flex items-start gap-2">
        <TokenArt mint={state.mint} letter={letter} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[13px] font-semibold tracking-wide text-[var(--ink-0)]">
              {state.symbol ?? state.name ?? '—'}
            </span>
            {state.symbol !== null && state.name !== null && state.name !== state.symbol ? (
              <span className="truncate text-[11px] text-[var(--ink-3)]">{state.name}</span>
            ) : null}
          </div>
          {createdAge !== null ? (
            <div className="mt-px flex items-center gap-[5px] text-[9.5px] text-[var(--ink-3)]">
              <span title="first seen by ingestion — a lower bound on true age">
                created {createdAge} ago
              </span>
            </div>
          ) : null}
        </div>
        {quoteAgeMs !== null ? (
          <span
            data-testid="agent-card-freshness"
            className="inline-flex shrink-0 items-center gap-1 text-[9.5px] tabular-nums"
            style={{ ...MONO, color: stale ? 'var(--hold)' : 'var(--ink-3)' }}
            title={`quote age · ${new Date(state.asOfMs ?? nowMs).toLocaleString()}`}
          >
            <span
              aria-hidden
              className={`h-[5px] w-[5px] rounded-full ${stale ? '' : 'trade-activity-pulse'}`}
              style={{ background: beat }}
            />
            as of {compactAge(quoteAgeMs)}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`text-[17px] font-medium tabular-nums ${stale ? 'text-[var(--ink-1)]' : 'text-[var(--ink-0)]'}`}
          style={MONO}
        >
          {state.priceUsd !== null ? formatPriceUsd(state.priceUsd) : '—'}
        </span>
        {changePct !== null ? (
          <span
            className="rounded px-1 py-px text-[10.5px] font-medium tabular-nums"
            style={{
              ...MONO,
              color: up ? 'var(--up)' : 'var(--down)',
              background: tint(up ? 'var(--up)' : 'var(--down)', 12),
            }}
          >
            {formatChangePct(changePct)}
          </span>
        ) : null}
        {/* The window the change is measured over — read off the chart
            payload rather than assumed, so the label can never claim a
            24h move that is really a 1h one. */}
        {changePct !== null && chart?.timeframe != null ? (
          <span
            data-testid="agent-card-change-window"
            className="ml-auto shrink-0 text-[9.5px] uppercase tracking-[0.06em] text-[var(--ink-4)]"
          >
            {chart.timeframe}
          </span>
        ) : null}
      </div>

      {points.length >= 2 ? (
        <div className="mt-1.5">
          <Sparkline points={points} up={up} stale={stale} />
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-4 gap-2">
        <Metric label="mcap" value={compactUsd(state.marketCapUsd, '—')} stale={stale} />
        <Metric label="vol 24h" value={compactUsd(state.vol24hUsd, '—')} stale={stale} />
        <Metric
          label="holders"
          value={state.holderCount !== null ? compactNumber(state.holderCount) : '—'}
          stale={stale}
        />
        <Metric
          label="top10"
          value={state.top10Pct !== null ? `${state.top10Pct.toFixed(1)}%` : '—'}
          stale={stale}
        />
      </div>

      {stale && quoteAgeMs !== null ? (
        <div
          data-testid="agent-card-stale-hint"
          className="mt-[7px] flex items-center gap-[5px] text-[9.5px] text-[var(--hold)]"
        >
          <svg
            {...ICON}
            width={10}
            height={10}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>quote is {compactAge(quoteAgeMs)} old — ask again to refresh</span>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-[2px] border-t border-[var(--hairline)] pt-1.5">
        {state.twitter !== null ? (
          <SocialLink href={state.twitter} label="X">
            <svg {...ICON} fill="currentColor">
              <path d="M18.9 2H22l-7.1 8.1L23.2 22h-6.6l-5.2-6.8L5.5 22H2.4l7.6-8.7L1.2 2h6.8l4.7 6.2L18.9 2Zm-1.1 18h1.8L7.3 3.9H5.4L17.8 20Z" />
            </svg>
          </SocialLink>
        ) : null}
        {pumpFunHref !== null ? (
          <SocialLink href={pumpFunHref} label="pump.fun">
            <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect
                x="3.2"
                y="7.6"
                width="17.6"
                height="8.8"
                rx="4.4"
                transform="rotate(-45 12 12)"
              />
            </svg>
          </SocialLink>
        ) : null}
        {state.website !== null ? (
          <SocialLink href={state.website} label="website">
            <svg {...ICON} fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18" />
            </svg>
          </SocialLink>
        ) : null}
        {state.telegram !== null ? (
          <SocialLink href={state.telegram} label="Telegram">
            <svg {...ICON} fill="currentColor">
              <path d="M21.7 3.4 2.9 10.6c-1.1.4-1.1 1.1-.2 1.4l4.7 1.5 1.8 5.5c.2.6.4.8.8.8.4 0 .6-.2.9-.5l2.2-2.1 4.6 3.4c.8.5 1.4.2 1.6-.8l3-14c.3-1.2-.5-1.8-1.6-1.4ZM9.3 13.9l9-5.7c.4-.3.8-.1.5.2l-7.4 6.7-.3 3.2-1.8-4.4Z" />
            </svg>
          </SocialLink>
        ) : null}
        <span
          data-testid="agent-card-graduation"
          className="ml-auto shrink-0 rounded-full px-[6px] py-[1.5px] text-[9.5px] leading-[1.5]"
          style={{
            color: state.graduated ? 'var(--up)' : 'var(--hold)',
            background: tint(state.graduated ? 'var(--up)' : 'var(--hold)', 12),
          }}
        >
          {state.graduated ? 'graduated' : 'pre-graduation'}
        </span>
      </div>
    </div>
  );
}
