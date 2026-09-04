'use client';

import { type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { LiveDot } from '@/components/listen/primitives';
import { QuickBuyPanel } from '../QuickBuyPanel';
import { SectionSearch } from '../SectionSearch';

import './section-header-narrow.css';
import { SectionChip } from '../SectionChip';
import { ColumnShell } from '../column/ColumnShell';
import { CardLane } from './CardLane';
import type { Axis, CardVariant, PanelSizing } from './types';
import type { QuickBuySectionId } from '@/lib/state/trade-store';

interface SectionProps<T> {
  label: string;
  variant: CardVariant;
  sizing: PanelSizing;
  tracks: number;
  cardFlow: Axis;
  /** Max card zoom (active size preset); cards fit-scale up to this in rows. */
  maxZoom: number;
  /**
   * The quick-buy slot's section, or `null` to OMIT the control entirely.
   *
   * `null` is the non-Solana branch and nothing else: every Solana panel passes
   * a real `SectionId`, so this is unreachable there and the rendered output of
   * a Solana section is byte-identical to before it existed. It is the same
   * opt-out idiom `CoinCardProps.sectionId` already uses, for the same reason —
   * quick-buy sizes a spend in SOL, and a chain-bound row's spend is
   * denominated in that chain's own asset. A section id that made the control
   * reachable on a chain whose spend path is not wired would post a Solana
   * order for a token that is not on Solana.
   */
  quickBuySectionId: QuickBuySectionId | null;
  isAlpha: boolean;
  live?: boolean;
  headerAction?: ReactNode;
  headerBadge?: string | null;
  /** Column mode only: opens the filters modal on this section. */
  onFilters?: () => void;
  /** Column mode only: whether this section has any filter set. */
  filtersActive?: boolean;
  /**
   * Column mode only: the rows to put in the list.
   *
   * Built by the caller rather than from `items` here, because column
   * rows read a COIN and `items` is a lane key — the lane pipeline hands
   * this component identifiers and a card renderer, and neither is what
   * a row needs. The caller already holds the coins.
   *
   * Absent renders the empty list this branch shipped with.
   */
  rows?: ReactNode;
  /** Controlled header-search query + setter (owned by DiscoverPage). */
  searchValue: string;
  onSearchChange: (value: string) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  items: T[];
  getKey: (item: T, index: number) => string;
  renderCard: (item: T, index: number) => ReactNode;
  /**
   * Body to render INSTEAD of the card lane when there is nothing to lay out.
   *
   * Opt-in and absent by default, so every existing caller renders exactly the
   * bare lane it rendered before. It exists for the one distinction a lane of
   * zero cards cannot draw on its own: a section that holds nothing because the
   * feed says so looks identical to one that holds nothing because the feed
   * could not be read, and only the caller knows which.
   */
  emptyState?: ReactNode;
}

/**
 * One section = chrome + header + a `CardLane`. Every difference between the
 * Alpha section and the others is a prop (variant, sizing, isAlpha, live) —
 * there is no Alpha code branch. Fills its panel when flex;
 * sits at natural height when fixed (pinned Alpha in rows).
 */
export function Section<T>({
  label,
  variant,
  sizing,
  tracks,
  cardFlow,
  maxZoom,
  quickBuySectionId,
  isAlpha,
  live = false,
  headerAction,
  headerBadge,
  onFilters,
  filtersActive,
  rows,
  searchValue,
  onSearchChange,
  onPointerEnter,
  onPointerLeave,
  items,
  getKey,
  renderCard,
  emptyState,
}: SectionProps<T>) {
  const fill = sizing === 'flex';
  // Column mode = narrow columns: condense the header (no search, compact
  // quick-buy, allow controls to wrap instead of clip).
  const dense = cardFlow === 'vertical';

  /*
   * ── COLUMN MODE IS THE COLUMN NOW ──────────────────────────────────
   *
   * The surface settled on `/whatever` replaces this whole branch: its
   * own head, its own ground, its own scroller, and an empty list. None
   * of the chrome below applies to it — no `section-shell`, no accent
   * edge bar, no dense header, no `CardLane` — so it returns before any
   * of that is built rather than being wrapped in it.
   *
   * ROWS MODE IS UNTOUCHED. Everything past this guard is the horizontal
   * carousel path exactly as it was.
   *
   * `label` is the only thing carried across, because the head prints
   * it. The search value, the quick buy id, the filters action and the
   * pause badge are all still passed in by `DiscoverPage` and are simply
   * not read here yet — the column owns its own versions of those
   * controls and wiring them to the real state is the next step, not a
   * silent half job hidden inside this render.
   */
  if (dense)
    return (
      <ColumnShell
        label={label}
        uid={String(quickBuySectionId ?? label)}
        onFilters={onFilters}
        filtersActive={filtersActive}
      >
        {rows}
      </ColumnShell>
    );

  return (
    <section
      className={cn(
        'section-shell relative overflow-hidden rounded-[16px] px-[var(--section-pad-x)] py-[var(--section-pad-y)]',
        // Column mode: grid-like density — cards run nearly full-bleed to the
        // section edge (see .section-shell--dense in discover.css).
        dense && 'section-shell--dense',
        isAlpha && 'alpha-section',
        fill && 'flex h-full min-h-0 flex-col',
      )}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={
        {
          background: 'var(--section-bg)',
          border: '1px solid var(--section-border)',
          boxShadow: 'var(--section-shadow)',
          '--row-tone': 'var(--accent-primary)',
          '--row-tone-2': 'var(--accent-secondary)',
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full"
        style={{
          background: 'linear-gradient(to bottom, transparent, var(--accent-primary), transparent)',
          opacity: isAlpha ? 0.7 : 0.55,
        }}
      />

      {dense ? (
        /* Column-mode header: plain label in a fixed-width slot (sized to the
           longest label) so search + controls line up across every column.
           No chip, no LIVE, compact quick-buy, no presets, filters as an icon. */
        <div className="discover-col-header relative z-[1] mb-[4px] flex items-center gap-2">
          <span
            title={label}
            className="shrink-0 truncate font-semibold"
            style={{
              width: 'var(--col-label-w)',
              color: 'var(--ink-0)',
              fontSize: 14,
              letterSpacing: '0.01em',
            }}
          >
            {label}
          </span>
          {/* Search is part of the right-hand control unit, sharing one gap-2
              rhythm with the quick-buy / settings / filters so it reads as a
              single toolbar. ml-auto pushes the whole unit to the right edge. */}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <SectionSearch fluid placeholder="Search" value={searchValue} onChange={onSearchChange} />
            {/* On a narrow column these controls scale down (container query in
                discover.css) so the flex search reclaims the freed width; wider
                columns keep them full size. */}
            <div className="discover-col-controls flex shrink-0 items-center gap-2">
              {quickBuySectionId === null ? null : (
                <QuickBuyPanel sectionId={quickBuySectionId} compact />
              )}
              {headerAction}
            </div>
          </div>
          {/* Paused badge is dropped in dense mode — the column header is too
              compact for it (same treatment as Mayhem / search). */}
        </div>
      ) : (
        <div className="discover-row-header relative z-[1] mb-[6px] flex items-center gap-3">
          {/* Fixed-width label slot holds the chip + (Alpha's) LIVE pill, so
              LIVE stays attached to the chip and every section's controls start
              at the same x — rows line up vertically. minWidth:0 pins the slot
              to exactly --row-label-w so a wide chip can never grow it (which
              would stagger the quick-buy); the width clears the widest label. */}
          <div
            className="flex shrink-0 items-center gap-2 overflow-hidden"
            style={{ width: 'var(--row-label-w)', minWidth: 0 }}
          >
            <SectionChip label={label} isAlpha={isAlpha} />
            {live ? (
              <span className="inline-flex items-center gap-1.5">
                <LiveDot size={6} tone="primary" />
                <span
                  className="uppercase"
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    letterSpacing: '0.2em',
                    color: 'var(--accent-primary)',
                    opacity: 0.85,
                    textShadow: '0 0 8px var(--accent-glow)',
                  }}
                >
                  LIVE
                </span>
              </span>
            ) : null}
          </div>
          {quickBuySectionId === null ? null : <QuickBuyPanel sectionId={quickBuySectionId} />}
          {headerAction}
          {headerBadge ? <HeaderBadge label={headerBadge} /> : null}

          <div className="flex-1" />

          <SectionSearch
            placeholder={`Search ${label.toLowerCase()}`}
            value={searchValue}
            onChange={onSearchChange}
          />
        </div>
      )}

      {emptyState !== undefined && items.length === 0 ? (
        /* Takes the lane's own box so the section keeps its height instead of
           collapsing to the header. */
        <div className={cn('relative z-[1] flex items-center px-1 pb-[4px]', fill && 'min-h-0 flex-1')}>
          {emptyState}
        </div>
      ) : (
        <CardLane
          cardFlow={cardFlow}
          variant={variant}
          tracks={tracks}
          fill={fill}
          // Alpha caps at its natural size (1); regular cards grow to the preset.
          maxZoom={variant === 'alpha' ? 1 : maxZoom}
          cardBaseHeight={variant === 'alpha' ? 192 : 100}
          items={items}
          getKey={getKey}
          renderCard={renderCard}
        />
      )}
    </section>
  );
}

function HeaderBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-[22px] items-center rounded-full px-2 uppercase"
      style={{
        color: 'var(--accent-primary)',
        background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 28%, transparent)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        boxShadow: '0 0 10px -4px color-mix(in srgb, var(--accent-primary) 60%, transparent)',
      }}
    >
      {label}
    </span>
  );
}
