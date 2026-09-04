'use client';

/**
 * The funnel pill that opens the Discover filters modal.
 *
 * LIFTED OUT OF `DiscoverPage.tsx` UNCHANGED so the EVM board can mount the
 * same control. A second hand-rolled filters button is how two surfaces end up
 * disagreeing about what "active" looks like — the same duplication that
 * `CoinCard` was extended to end for the card itself.
 */

import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export function DiscoverFiltersButton({
  active,
  onClick,
  iconOnly = false,
}: {
  active: boolean;
  onClick: () => void;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Filters"
      title="Filters"
      aria-pressed={active}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
        // Icon-only matches the 26px column controls (cog/quick-buy); the
        // text form keeps its 22px row-mode size next to the "Filters" label.
        iconOnly ? 'h-[26px] w-[26px]' : 'h-[22px] gap-1.5 px-2',
      )}
      style={{
        color: active ? 'var(--ink-0)' : 'var(--ink-2)',
        background: active
          ? 'color-mix(in srgb, var(--accent-primary) 16%, var(--input-bg))'
          : 'var(--input-bg)',
        border: `1px solid ${active ? 'color-mix(in srgb, var(--accent-primary) 48%, var(--hairline))' : 'var(--input-border)'}`,
        boxShadow: active
          ? '0 0 12px -5px var(--accent-primary), inset 0 1px 0 rgba(255,255,255,0.05)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <SlidersHorizontal style={{ width: 12, height: 12, display: 'block' }} aria-hidden />
      {iconOnly ? null : 'Filters'}
      {active && !iconOnly ? (
        <span
          aria-hidden
          className="inline-block rounded-full"
          style={{
            width: 6,
            height: 6,
            background: 'var(--accent-primary)',
            boxShadow: '0 0 8px var(--accent-primary)',
          }}
        />
      ) : null}
    </button>
  );
}
