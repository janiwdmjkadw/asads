'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { lamportsStringToNumber } from '@/lib/format';
import { useAnimatedNumber } from '@/components/portfolio/spot/useAnimatedNumber';
import { cn } from '@/lib/utils';
import { pageZoom } from '@/lib/page-zoom';
import { IconCrown } from './icons';

/* ==========================================================================
   Slice "Cashback & Points": shared design system for the Rewards surface.
   ==========================================================================
   One source of truth for every Rewards primitive: etched panels, count-up
   numerals, the meridian section rail, the small segmented lozenge, claim
   CTAs, progress rails, tables, leaderboards. All theme-reactive (CSS-var
   driven); motion and chrome live in rewards.css.
   ========================================================================== */

// ───────── windows / sections / formatting ─────────

export type RewardWindow = 'daily' | 'weekly' | 'monthly' | 'lifetime';
export type RewardSection = 'referral' | 'cashback' | 'points';

/** The fixed listen confetti (same palette as the frens surfaces). */
export const CONFETTI = [
  '#37d67a',
  '#3b82f6',
  '#38bdf8',
  '#f052d2',
  '#fbbf24',
  '#22d3ee',
  '#8b5cf6',
  '#7ce85e',
] as const;

/**
 * Each rewards section owns a confetti color — its tab tick, panel
 * strips, aurora tint and ordinal all re-ink when the section changes
 * (via the --rw-lens CSS var set on the page root).
 */
export const SECTION_COLORS: Record<RewardSection, string> = {
  referral: '#f052d2',
  cashback: '#37d67a',
  points: '#fbbf24',
};

export const REWARD_WINDOWS: ReadonlyArray<{ id: RewardWindow; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'lifetime', label: 'Lifetime' },
];

const LAMPORTS_PER_SOL = 1_000_000_000;

/** lamport decimal string → SOL number (for animation / math). */
export function lamportsToSol(lamports: string | undefined): number {
  const n = lamportsStringToNumber(lamports ?? '0');
  return n == null ? 0 : n / LAMPORTS_PER_SOL;
}

/** lamport decimal string → SOL display string (no animation). */
export function fmtSol(lamports: string | undefined): string {
  return lamportsToSol(lamports).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtInt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function panelStyle(): CSSProperties {
  return { background: 'var(--panel-bg, var(--input-bg))', border: '1px solid var(--hairline)' };
}

/** Inner-tile surface (theme card gradient + hairline; the etch adds light). */
export function tileStyle(): CSSProperties {
  return {
    background: 'var(--card-bg, var(--input-bg))',
    border: '1px solid var(--card-border, var(--hairline))',
    boxShadow: 'var(--card-shadow, none)',
  };
}

// ───────── Art primitives: ghost typography + collage ─────────

/**
 * Ghost word: a giant serif-italic watermark set INSIDE a panel — the
 * same hand as the frens podium numerals and profile-banner initials.
 * Absolutely positioned by the caller; hidden under 900px.
 */
export function GhostWord({
  children,
  color,
  size = 110,
  opacity = 0.1,
  style,
}: {
  children: ReactNode;
  color: string;
  size?: number;
  opacity?: number;
  style?: CSSProperties;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      className="rw-ghost-ordinal"
      style={{
        position: 'absolute',
        fontFamily: 'var(--display)',
        fontStyle: 'italic',
        fontSize: size,
        lineHeight: 1,
        color,
        opacity,
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Collage: three overlapping confetti blocks bleeding off a panel edge,
 * clipped by the frame — the podium-card hand. Position via `style`
 * (usually { top: -18, right: N }). Hidden under 900px.
 */
export function Collage({
  color,
  soft,
  style,
}: {
  color: string;
  soft: string;
  style?: CSSProperties;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      className="rw-ghost-ordinal"
      style={{ position: 'absolute', width: 140, height: 44, pointerEvents: 'none', ...style }}
    >
      <span
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 96,
          height: 34,
          borderRadius: 10,
          background: color,
          opacity: 0.85,
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: 12,
          right: 76,
          width: 40,
          height: 18,
          borderRadius: 7,
          background: soft,
          opacity: 0.75,
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: 24,
          right: 54,
          width: 16,
          height: 9,
          borderRadius: 4,
          background: color,
          opacity: 0.4,
        }}
      />
    </span>
  );
}

/** Lens tick + mono eyebrow: the section voice, one component. */
export function Eyebrow({
  color,
  icon,
  children,
  after,
}: {
  color: string;
  icon?: ReactNode;
  children: string;
  after?: ReactNode;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-2" style={{ minWidth: 0 }}>
      <span aria-hidden style={{ width: 4, height: 13, borderRadius: 2, background: color, flexShrink: 0 }} />
      {icon ? <span aria-hidden style={{ color, display: 'inline-flex' }}>{icon}</span> : null}
      <span
        className="truncate"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {children}
      </span>
      {after}
    </span>
  );
}

// ───────── Panel (etched) ─────────

export function Panel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): React.ReactElement {
  return (
    <section className={cn('panel rw-panel p-4', className)} style={style}>
      <span aria-hidden className="rw-etch" />
      {/* Identity strip: the active section signs every panel's top edge. */}
      <span aria-hidden className="rw-strip" />
      {children}
    </section>
  );
}

/** Section header inside panels: icon chip + title + hairline rule + right slot. */
export function SectionTitle({
  icon,
  title,
  right,
  tone = 'var(--accent-primary)',
}: {
  icon?: ReactNode;
  title: string;
  right?: ReactNode;
  tone?: string;
}): React.ReactElement {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span
            aria-hidden
            className="inline-flex items-center justify-center"
            style={{
              width: 25,
              height: 25,
              borderRadius: 7,
              color: tone,
              background: `color-mix(in srgb, ${tone} 10%, transparent)`,
              border: `1px solid color-mix(in srgb, ${tone} 24%, transparent)`,
              boxShadow: `inset 0 1px 0 color-mix(in srgb, ${tone} 14%, transparent)`,
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
        ) : null}
        <span className="t-title truncate" style={{ fontSize: 13.5, letterSpacing: '-0.005em' }}>
          {title}
        </span>
      </div>
      <span aria-hidden className="rw-rule min-w-4 flex-1" />
      {right ? <div className="flex-shrink-0">{right}</div> : null}
    </div>
  );
}

// ───────── Count-up numeral (optional metallic shine) ─────────

export function CountUp({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  shine = false,
  shineAccent = false,
  className,
  style,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  shine?: boolean;
  shineAccent?: boolean;
  className?: string;
  style?: CSSProperties;
}): React.ReactElement {
  const snap = decimals <= 0 ? 0.5 : 0.5 * Math.pow(10, -decimals);
  const n = useAnimatedNumber(value, { snapThreshold: snap });
  const text =
    prefix +
    n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) +
    suffix;

  if (!shine) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }
  return (
    <span className={cn('rw-shine-stack', shineAccent && 'rw-shine-accent', className)} style={style}>
      <span className="rw-shine-base">{text}</span>
      <span aria-hidden className="rw-shine-glint">
        {text}
      </span>
    </span>
  );
}

// ───────── Stat tile (etched, corner-ticked) ─────────

export function StatCard({
  label,
  numeric,
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  accent,
  tone,
  icon,
  sub,
  className,
}: {
  label: string;
  /** Animate to this number; omit to render a static `value` string. */
  numeric?: number;
  value?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  accent?: boolean;
  tone?: string;
  icon?: ReactNode;
  sub?: ReactNode;
  className?: string;
}): React.ReactElement {
  const color = accent ? 'var(--accent-primary)' : tone ?? 'var(--ink-0)';
  const washColor = tone ?? (accent ? 'var(--accent-primary)' : 'var(--ink-2)');
  return (
    <div
      className={cn('rw-lift rw-ticks relative overflow-hidden rounded-[14px] p-4', className)}
      style={tileStyle()}
    >
      <span aria-hidden className="rw-etch" />
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, ${washColor} 10%, transparent), transparent 60%)`,
        }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            style={{
              width: 3,
              height: 10,
              borderRadius: 2,
              background: tone ?? (accent ? 'var(--accent-primary)' : 'var(--rw-lens, var(--ink-3))'),
              opacity: 0.9,
              flexShrink: 0,
            }}
          />
          <span
            className="truncate"
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            {label}
          </span>
        </span>
        {icon ? (
          <span aria-hidden style={{ color: washColor, opacity: 0.75, flexShrink: 0 }}>
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className="relative mt-2.5"
        style={{
          fontFamily: 'var(--mono)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 25,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          color,
        }}
      >
        {numeric !== undefined ? (
          <CountUp value={numeric} decimals={decimals} prefix={prefix} suffix={suffix} />
        ) : (
          value
        )}
      </div>
      {sub ? (
        <div className="relative mt-1.5" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

// ───────── Segmented control ─────────
// Two skins over one sliding-indicator mechanism:
//   "seg"  - the small frosted lozenge (time windows, metric toggles)
//   "tabs" - the meridian rail (page sections): baseline hairline, underline
//            lens, mono ordinals

interface SegItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly ordinal?: string;
  /** Confetti tick color (rail variant): lights when the tab is active. */
  readonly tint?: string;
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  variant = 'seg',
  ariaLabel,
}: {
  items: ReadonlyArray<SegItem<T>>;
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  variant?: 'seg' | 'tabs';
  ariaLabel?: string;
}): React.ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const btns = useRef<Map<T, HTMLButtonElement>>(new Map());
  const [ind, setInd] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const measure = useCallback(() => {
    const track = trackRef.current;
    const btn = btns.current.get(value);
    if (!track || !btn) return;
    const t = track.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    // Rects are physical px but the indicator's left/width are layout px
    // (page-zoom-multiplied on render) — divide so it sits under the tab.
    const z = pageZoom();
    const left = (b.left - t.left) / z;
    const width = b.width / z;
    // Bail when unchanged so a fresh `items` reference each render can't
    // ping-pong setInd → re-render → re-measure into a loop.
    setInd((prev) =>
      prev.ready && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
        ? prev
        : { left, width, ready: true },
    );
  }, [value]);

  useLayoutEffect(() => {
    measure();
  }, [measure, items.length]);

  useEffect(() => {
    if (!trackRef.current) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const rail = variant === 'tabs';
  const dims =
    size === 'sm'
      ? { h: 28, pad: '0 11px', font: 11.5, icon: 13 }
      : { h: 34, pad: '0 14px', font: 12.5, icon: 14 };

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={rail ? 'rw-tabs' : 'rw-seg'}
    >
      <span
        aria-hidden
        className={rail ? 'rw-tabs-ind' : 'rw-seg-ind'}
        style={{ left: ind.left, width: ind.width, opacity: ind.ready ? 1 : 0 }}
      />
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              if (el) btns.current.set(it.id, el);
              else btns.current.delete(it.id);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cn(rail ? 'rw-tabs-btn' : 'rw-seg-btn', active && 'is-active')}
            style={rail ? undefined : { height: dims.h, padding: dims.pad, fontSize: dims.font }}
          >
            {rail && it.tint ? (
              <span
                aria-hidden
                style={{
                  width: 4,
                  height: 13,
                  borderRadius: 2,
                  background: it.tint,
                  opacity: active ? 1 : 0.22,
                  transition: 'opacity 200ms ease',
                  flexShrink: 0,
                }}
              />
            ) : null}
            {rail && it.ordinal ? (
              <span aria-hidden className="rw-tabs-ord">
                {it.ordinal}
              </span>
            ) : null}
            {it.icon ? (
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  width: rail ? 15 : dims.icon,
                  height: rail ? 15 : dims.icon,
                }}
              >
                {it.icon}
              </span>
            ) : null}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function WindowToggle({
  window,
  onChange,
  windows = REWARD_WINDOWS,
}: {
  window: RewardWindow;
  onChange: (w: RewardWindow) => void;
  windows?: ReadonlyArray<{ id: RewardWindow; label: string }>;
}): React.ReactElement {
  return <Segmented items={windows} value={window} onChange={onChange} size="sm" ariaLabel="Time window" />;
}

const SECTION_TABS: ReadonlyArray<{ id: RewardSection; label: string; ordinal: string; tint: string }> = [
  { id: 'referral', label: 'Referral', ordinal: '01', tint: SECTION_COLORS.referral },
  { id: 'cashback', label: 'Cashback', ordinal: '02', tint: SECTION_COLORS.cashback },
  { id: 'points', label: 'Points', ordinal: '03', tint: SECTION_COLORS.points },
];

export function SectionTabs({
  section,
  onChange,
  icons,
}: {
  section: RewardSection;
  onChange: (s: RewardSection) => void;
  icons?: Partial<Record<RewardSection, ReactNode>>;
}): React.ReactElement {
  const items = SECTION_TABS.map((t) => ({ ...t, icon: icons?.[t.id] }));
  return (
    <Segmented items={items} value={section} onChange={onChange} variant="tabs" ariaLabel="Rewards sections" />
  );
}

// ───────── Claim CTA ─────────

export function ClaimButton({
  onClick,
  disabled,
  pending,
  children,
  height = 38,
  full,
  className,
  type = 'button',
}: {
  onClick?: () => void;
  disabled?: boolean;
  pending?: boolean;
  children: ReactNode;
  height?: number;
  full?: boolean;
  className?: string;
  /**
   * Must be 'submit' when the CTA is a <form>'s submit control (the
   * referral slug-claim form). The previous hardcoded 'button' made a
   * click on "Claim link" a no-op; only Enter-in-input submitted.
   */
  type?: 'button' | 'submit';
}): React.ReactElement {
  const dead = disabled || pending;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={dead}
      className={cn('rw-cta', !dead && 'rw-shimmer', full && 'w-full', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        height,
        padding: '0 17px',
        borderRadius: 11,
        fontFamily: 'var(--sans)',
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '0.01em',
        cursor: dead ? 'default' : 'pointer',
        color: disabled ? 'var(--ink-3)' : 'var(--ink-0)',
        background: disabled
          ? 'var(--input-bg)'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 88%, black), color-mix(in srgb, var(--accent-secondary) 88%, black))',
        border: disabled
          ? '1px solid var(--hairline)'
          : '1px solid color-mix(in srgb, var(--accent-primary) 45%, transparent)',
        boxShadow: disabled
          ? 'none'
          : 'inset 0 1px 0 rgba(255,255,255,0.22), 0 8px 22px -12px color-mix(in srgb, var(--accent-primary) 60%, transparent)',
        opacity: pending ? 0.8 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ───────── Progress rail ─────────

export function ProgressTrack({
  pct,
  height = 6,
  from = 'var(--accent-primary)',
  to = 'var(--accent-secondary)',
  shimmer = true,
}: {
  pct: number;
  height?: number;
  from?: string;
  to?: string;
  shimmer?: boolean;
}): React.ReactElement {
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <div
      style={{
        height,
        borderRadius: 999,
        background: 'color-mix(in srgb, var(--ink-3) 15%, transparent)',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
      }}
    >
      <div
        className={cn(shimmer ? 'rw-rail-fill' : 'rw-bar-fill')}
        style={{
          height: '100%',
          width: `${clamped}%`,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${from}, ${to})`,
          boxShadow: `0 0 10px -3px color-mix(in srgb, ${to} 60%, transparent)`,
        }}
      />
    </div>
  );
}

// ───────── Tables (generic, hairline-separated) ─────────

export function Row({
  cells,
  head,
  highlight,
  template,
}: {
  cells: ReactNode[];
  head?: boolean;
  highlight?: boolean;
  template?: string;
}): React.ReactElement {
  const gridTemplateColumns = template ?? `repeat(${cells.length}, minmax(0, 1fr))`;
  return (
    <div
      className={cn('rw-trow items-center px-2.5 transition-colors', head ? 'rw-trow-head py-1.5' : 'py-2.5')}
      style={{
        display: 'grid',
        gridTemplateColumns,
        gap: 8,
        color: head ? 'var(--ink-3)' : 'var(--ink-1)',
        background: highlight ? 'var(--chip-bg, rgba(255,255,255,0.04))' : 'transparent',
        fontFamily: head ? 'var(--sans)' : undefined,
        fontSize: head ? 9.5 : 12.5,
        fontWeight: head ? 600 : 400,
        letterSpacing: head ? '0.12em' : undefined,
        textTransform: head ? 'uppercase' : undefined,
      }}
    >
      {cells.map((c, i) => (
        <span
          key={i}
          className={cn(i === 0 ? 'truncate text-left' : 'text-right')}
          style={i === 0 ? undefined : { fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/** Hairline-separated table body wrapper (separators live in rewards.css). */
export function Table({ children }: { children: ReactNode }): React.ReactElement {
  return <div className="flex flex-col">{children}</div>;
}

// ───────── Leaderboard (rank medals + you-highlight) ─────────

const MEDALS: Record<number, { a: string; b: string; ink: string }> = {
  1: { a: '#ffe48a', b: '#e5b23a', ink: '#3a2c05' },
  2: { a: '#e6e9f0', b: '#aeb4c2', ink: '#272a31' },
  3: { a: '#ecb27a', b: '#c1813f', ink: '#3a2510' },
};

export function RankBadge({ rank }: { rank: number }): React.ReactElement {
  const m = MEDALS[rank];
  if (!m) {
    return (
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 11.5,
          color: 'var(--ink-3)',
          width: 22,
          textAlign: 'center',
        }}
      >
        {rank}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: 999,
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        fontWeight: 700,
        color: m.ink,
        background: `linear-gradient(150deg, ${m.a}, ${m.b})`,
        border: '1px solid rgba(255,255,255,0.3)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
      }}
    >
      {rank}
    </span>
  );
}

export interface LeaderRow {
  readonly rank: number;
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly isMe: boolean;
}

export function Leaderboard({
  rows,
  valueHead,
}: {
  rows: ReadonlyArray<LeaderRow>;
  valueHead: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col">
      <div
        className="grid items-center px-2.5 pb-1.5"
        style={{
          gridTemplateColumns: '36px 1fr auto',
          gap: 10,
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        <span>#</span>
        <span>Fren</span>
        <span className="text-right">{valueHead}</span>
      </div>
      {rows.map((r) => (
        <div
          key={`${r.rank}-${r.label}`}
          className={cn(
            'rw-lrow grid items-center px-2.5 py-2 transition-colors',
            r.isMe && 'rw-you-row rounded-[10px]',
          )}
          style={{
            gridTemplateColumns: '36px 1fr auto',
            gap: 10,
          }}
        >
          <div className="flex items-center">
            <RankBadge rank={r.rank} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="truncate"
              style={{ fontSize: 12.5, color: 'var(--ink-0)', fontWeight: r.isMe ? 600 : 500 }}
            >
              {r.label}
            </span>
            {r.isMe ? (
              <span
                style={{
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  color: 'var(--accent-primary)',
                  border: '1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent)',
                  borderRadius: 999,
                  padding: '1px 6px',
                  flexShrink: 0,
                }}
              >
                YOU
              </span>
            ) : null}
          </div>
          <div className="text-right">
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 12.5,
                color: 'var(--ink-0)',
                fontWeight: 600,
              }}
            >
              {r.value}
            </div>
            {r.sub ? <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{r.sub}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────── States ─────────

/** Mini pixel mosaic — the confetti crowd, waiting for data. */
const EMPTY_PIXELS: ReadonlyArray<[number, number, number]> = [
  [0, 1, 2],
  [0, 3, 4],
  [1, 0, 1],
  [1, 2, 0],
  [1, 4, 3],
  [2, 1, 5],
  [2, 3, 6],
];

export function Empty({ text }: { text: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-9 text-center">
      <span aria-hidden style={{ position: 'relative', width: 5 * 13, height: 3 * 13 }}>
        {EMPTY_PIXELS.map(([r, c, ci], index) => (
          <span
            key={index}
            style={{
              position: 'absolute',
              top: r * 13,
              left: c * 13,
              width: 10,
              height: 10,
              borderRadius: 3,
              background: CONFETTI[ci],
              opacity: 0.55,
            }}
          />
        ))}
      </span>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{text}</p>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rw-shimmer"
          style={{
            height: 13,
            width: i === rows - 1 ? '55%' : i === 0 ? '85%' : '70%',
            borderRadius: 6,
            background: 'color-mix(in srgb, var(--ink-3) 13%, transparent)',
          }}
        />
      ))}
    </div>
  );
}

// ───────── Partner program ─────────

export const PARTNER_COLOR = '#ffd700';

/**
 * Slice "Partner Program": gilded "Partner" chip shown across the rewards
 * surface while the user has an active partner override.
 */
export function PartnerBadge({ size = 'md' }: { size?: 'sm' | 'md' }): React.ReactElement {
  const dims = size === 'sm'
    ? { height: 20, padding: '0 8px', font: 9, icon: 11 }
    : { height: 24, padding: '0 10px', font: 10, icon: 13 };
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        height: dims.height,
        padding: dims.padding,
        borderRadius: 999,
        fontSize: dims.font,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#3a2c05',
        background: `linear-gradient(135deg, #ffe48a, ${PARTNER_COLOR} 55%, #e5b23a)`,
        border: '1px solid rgba(255,255,255,0.4)',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 0 12px -5px ${PARTNER_COLOR}`,
        flexShrink: 0,
      }}
    >
      <IconCrown size={dims.icon} />
      Partner
    </span>
  );
}

// ───────── Tier colors (clay → owl) ─────────

export const TIER_COLORS: Record<string, string> = {
  clay: '#b08d57',
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#ffd700',
  emerald: '#50c878',
  owl: '#a78bfa',
};

export function tierColor(key: string): string {
  return TIER_COLORS[key] ?? 'var(--accent-primary)';
}
