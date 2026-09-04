'use client';

import { memo, useMemo, useState, type CSSProperties } from 'react';
import { FrenProfileModal } from '@/components/frens/FrenProfileModal';
import { compactNumber, compactUsd, formatPriceUsd, formatUsdAmount } from '@/lib/format';
import type { ListenHolder } from '@/lib/api/listen-holders';
import type { TokenHolder } from './types';
import {
  deriveTotalSupplyUi,
  entryMarketCapUsd,
  formatSupplyPct,
  identityColor,
  pnlLine,
  supplyPctOf,
} from './listenHoldersView';

// Slice "Listen holders": the Holders tab's toggleable card view — only
// Listen-platform holders of this mint, richest bags first. The toggle
// button lives beside the DEV filter in the tab row (sibling of the
// Call button's quality bar, but in the house accent duotone instead of
// confetti); each card borrows the frens-card language: identity strip,
// avatar/initials in the holder's confetti color, big mono USD held,
// glowing PnL line, eyebrow stat strip, clamped thesis quote. Clicking
// a name opens the FrenProfileModal (same local-state pattern as
// FrensPage).

const LISTEN_VIEW_KEY = 'trade.holders.listen';

export function readListenViewPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LISTEN_VIEW_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeListenViewPref(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LISTEN_VIEW_KEY, on ? 'true' : 'false');
  } catch {
    // Non-persistent browser contexts still keep the React state.
  }
}

/* ─── Toggle button ──────────────────────────────────────────────────── */


/**
 * The confetti mosaic — the exact five-pixel scatter the FRENS nav pill
 * wears (FrensPillMosaic in TerminalTopNav: same palette, same stepped
 * plot, same `.frens-pill-px` twinkle from listen.css).
 *
 * It leads the button now rather than perching in its top-right corner.
 * As the only coloured thing on the control it should be the first thing
 * read, not something found afterwards — and inline it can carry the
 * whole "this is Listen" job that the wordmark's gradient used to share.
 */
function ListenPillMosaic() {
  const cells: ReadonlyArray<{ x: number; y: number; c: string; d: string }> = [
    { x: 4, y: 0, c: '#f052d2', d: '0s' },
    { x: 8, y: 0, c: '#8b5cf6', d: '1.4s' },
    { x: 0, y: 4, c: '#fbbf24', d: '2.6s' },
    { x: 4, y: 4, c: '#37d67a', d: '0.8s' },
    { x: 8, y: 4, c: '#38bdf8', d: '2s' },
  ];
  return (
    <span className="lh-mosaic" aria-hidden>
      {cells.map((cell) => (
        <span
          key={`${cell.x}-${cell.y}`}
          className="frens-pill-px"
          style={{
            left: cell.x,
            top: cell.y,
            background: cell.c,
            boxShadow: `0 0 4px color-mix(in srgb, ${cell.c} 65%, transparent)`,
            animationDelay: cell.d,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The Listen view toggle — a gradient-shell pill (1px accent ring around a
 * dark core, echoing the Call button's construction) that sits quiet as a
 * ghost chip until switched on, then wears the accent ring, glow, gradient
 * wordmark, a live holder-count badge, and the frens-pill confetti mosaic
 * in its top-right corner.
 */
export function ListenToggleButton({
  active,
  count,
  onToggle,
}: {
  active: boolean;
  count: number | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={active ? 'Showing Listen holders — click for all holders' : 'Show Listen holders only'}
      title={active ? 'Showing Listen holders — click for all holders' : 'Show Listen holders only'}
      onClick={onToggle}
      className="lh-toggle"
      data-on={active ? '' : undefined}
    >
      {/*
       * ── THE MOSAIC LEADS, AND NOTHING ELSE MOVES ────────────────────
       *
       * The equaliser is gone. The mosaic already twinkles, and two
       * things animating inside a 90px pill is one too many — the pixels
       * say "live" on their own, and they are the mark you recognise.
       *
       * It is inline now rather than perched in the corner: as the only
       * coloured thing on the button it should be read first, not found.
       */}
      <ListenPillMosaic />
      <span className="lh-word">Listen</span>
      {active && count != null ? <b className="lh-count">{compactNumber(count)}</b> : null}
    </button>
  );
}

/* ─── Card body ──────────────────────────────────────────────────────── */

const PNL_GLOW_UP = '0 0 26px color-mix(in srgb, var(--up) 40%, transparent)';
const PNL_GLOW_DOWN = '0 0 26px color-mix(in srgb, var(--down) 40%, transparent)';

export function ListenHoldersBody({
  holders,
  total,
  loading,
  error,
  reauth,
  topHolders,
}: {
  holders: ListenHolder[];
  total: number | null;
  loading: boolean;
  error: string | null;
  reauth: boolean;
  /** Regular top-holder rows — pins the mint's total supply for supply-%. */
  topHolders: TokenHolder[];
}) {
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const totalSupplyUi = useMemo(() => deriveTotalSupplyUi(topHolders), [topHolders]);

  let content: React.ReactNode;
  if (holders.length > 0) {
    content = (
      <>
        {holders.map((holder, i) => (
          <ListenHolderCard
            key={holder.user_id}
            holder={holder}
            rank={i + 1}
            totalSupplyUi={totalSupplyUi}
            onOpenProfile={setProfileUserId}
          />
        ))}
        {total != null && total > holders.length ? (
          <div
            className="py-1.5 text-center text-[10px]"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
          >
            top {holders.length} of {total.toLocaleString()} Listen holders
          </div>
        ) : null}
      </>
    );
  } else if (reauth) {
    content = (
      <StateNote
        headline="Sign in to see Listen holders"
        sub="Listen traders holding this coin show up here once you're signed in."
      />
    );
  } else if (loading) {
    content = (
      <>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} delay={i * 0.18} />
        ))}
      </>
    );
  } else if (error) {
    content = (
      <StateNote
        headline="Listen holders unavailable"
        sub="couldn't reach the holder feed — retrying shortly"
        title={error}
      />
    );
  } else {
    content = (
      <StateNote
        headline="No Listen holders yet"
        sub="Listen traders who pick up a bag of this coin appear here."
      />
    );
  }

  return (
    <div className="relative z-[1] flex flex-1 flex-col gap-2 px-4 py-3">
      {content}
      <FrenProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </div>
  );
}

// Memoized: TradesTable re-renders on a 1s clock, and react-query's
// structural sharing keeps each holder's identity stable — so the tick is
// a no-op for every unchanged card.
const ListenHolderCard = memo(function ListenHolderCard({
  holder,
  rank,
  totalSupplyUi,
  onOpenProfile,
}: {
  holder: ListenHolder;
  rank: number;
  totalSupplyUi: number | null;
  onOpenProfile: (userId: string) => void;
}) {
  const ic = identityColor(holder.label);
  const pct = supplyPctOf(holder.tokens_ui, totalSupplyUi);
  const pnl = pnlLine(holder.unrealized_pnl_pct, holder.unrealized_pnl_usd);
  const entryMc = entryMarketCapUsd(holder.avg_entry_price_usd, totalSupplyUi);
  return (
    <div
      className="lh-card"
      style={
        {
          '--fc': ic,
          position: 'relative',
          overflow: 'hidden',
          background: 'var(--surface-1)',
          border: '1px solid var(--hairline)',
          borderRadius: 14,
          padding: '11px 14px 12px',
        } as CSSProperties
      }
    >
      {/* Identity strip: this holder's confetti color, fading out. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 3,
          width: '46%',
          background: `linear-gradient(90deg, ${ic}, transparent)`,
        }}
      />
      <div className="flex items-start gap-2.5">
        <span
          className="shrink-0 pt-2 text-[10px] tabular-nums"
          style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', width: 18 }}
        >
          {String(rank).padStart(2, '0')}
        </span>
        <ListenAvatar holder={holder} color={ic} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenProfile(holder.user_id)}
              className="lh-name min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              style={{ color: 'var(--ink-0)' }}
              title={`Open @${holder.label}'s profile`}
            >
              @{holder.label}
            </button>
            <span
              className="shrink-0 rounded-full px-1.5 text-[9.5px] tabular-nums"
              style={{
                color: 'var(--ink-2)',
                background: 'var(--chip-bg)',
                border: '1px solid var(--hairline)',
                fontFamily: 'var(--mono)',
                lineHeight: '15px',
              }}
              title="Share of token supply held"
            >
              {formatSupplyPct(pct)} supply
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Eyebrow
              label="Avg entry"
              value={compactUsd(entryMc, '—')}
              title={
                holder.avg_entry_price_usd != null
                  ? `Avg entry price ${formatPriceUsd(holder.avg_entry_price_usd)}`
                  : undefined
              }
            />
            <Eyebrow
              label="Invested"
              value={
                holder.invested_usd == null ? '—' : formatUsdAmount(holder.invested_usd, '—')
              }
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span
            className="text-[15px] tabular-nums"
            style={{
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: holder.value_usd == null ? 'var(--ink-3)' : 'var(--ink-0)',
            }}
          >
            {holder.value_usd == null ? '—' : compactUsd(holder.value_usd, '$0')}
          </span>
          <span
            className="text-[10.5px] tabular-nums"
            style={{
              fontFamily: 'var(--mono)',
              ...(pnl.text === null
                ? { color: 'var(--ink-3)' }
                : pnl.tone === 'flat'
                  ? { color: 'var(--ink-2)' }
                  : {
                      color: pnl.tone === 'up' ? 'var(--up)' : 'var(--down)',
                      textShadow: pnl.tone === 'up' ? PNL_GLOW_UP : PNL_GLOW_DOWN,
                    }),
            }}
          >
            {pnl.text ?? '—'}
          </span>
        </div>
      </div>
      {holder.thesis ? (
        <div
          className="mt-2"
          style={{
            marginLeft: 28,
            paddingLeft: 10,
            borderLeft: `2px solid color-mix(in srgb, ${ic} 55%, transparent)`,
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-1)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
          title={holder.thesis}
        >
          “{holder.thesis}”
        </div>
      ) : null}
    </div>
  );
});

/** Circular thumb (data-url) or 2-char initials over the identity color. */
function ListenAvatar({ holder, color }: { holder: ListenHolder; color: string }) {
  const initials = holder.label.replace(/^@/, '').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{
        width: 32,
        height: 32,
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ink-0)',
        background: holder.avatar_thumb_data_url
          ? `center / cover no-repeat url(${JSON.stringify(holder.avatar_thumb_data_url)})`
          : `linear-gradient(135deg, color-mix(in srgb, ${color} 60%, var(--surface-2)), color-mix(in srgb, ${color} 25%, var(--surface-2)))`,
        boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {holder.avatar_thumb_data_url ? null : initials}
    </span>
  );
}

function Eyebrow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span className="inline-flex min-w-0 flex-col leading-tight" title={title}>
      {/* FrenProfileModal eyebrow recipe — --ink-4 is the disabled ink and
          dies on the light theme. */}
      <span
        className="uppercase"
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: 'var(--ink-3)',
          fontFamily: 'var(--mono)',
          letterSpacing: '0.16em',
        }}
      >
        {label}
      </span>
      <span
        className="truncate text-[11px] tabular-nums"
        style={{ color: 'var(--ink-1)', fontFamily: 'var(--mono)' }}
      >
        {value}
      </span>
    </span>
  );
}

/** Pulse skeleton row — same silhouette as a loaded card. The pulse lives
 *  on `.lh-skel` (listen.css) so reduced-motion can switch it off. */
function SkeletonCard({ delay }: { delay: number }) {
  const block = (w: number | string, h: number): CSSProperties => ({
    width: w,
    height: h,
    borderRadius: 6,
    background: 'color-mix(in srgb, var(--ink-3) 16%, transparent)',
    animationDelay: `${delay}s`,
  });
  return (
    <div
      aria-hidden
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--hairline)',
        borderRadius: 14,
        padding: '11px 14px 12px',
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="lh-skel" style={{ ...block(18, 10) }} />
        <span className="lh-skel" style={{ ...block(32, 32), borderRadius: '50%' }} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="lh-skel" style={block('38%', 12)} />
          <span className="lh-skel" style={block('58%', 9)} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="lh-skel" style={block(64, 13)} />
          <span className="lh-skel" style={block(88, 9)} />
        </div>
      </div>
    </div>
  );
}

function StateNote({ headline, sub, title }: { headline: string; sub: string; title?: string }) {
  return (
    <div
      className="flex min-h-[140px] flex-1 flex-col items-center justify-center gap-1 px-4 text-center"
      title={title}
    >
      <span className="text-[12px] font-semibold" style={{ color: 'var(--ink-1)' }}>
        {headline}
      </span>
      <span
        className="text-[10.5px]"
        style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', lineHeight: '16px' }}
      >
        {sub}
      </span>
    </div>
  );
}
