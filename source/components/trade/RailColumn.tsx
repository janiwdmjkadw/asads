import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * The fixed-width right rail column shared by the chart row (TradePanel)
 * and the bottom row (AnalyticsPanel): full-width stacked below `lg`,
 * then a fixed rail (`--w-rail-md` at lg, `--w-rail` at xl). Fills the
 * panel height on `lg+` so its child scrolls internally rather than
 * pushing the viewport-locked page. One source of truth for the width
 * combo that was duplicated across both panels.
 */
export function RailColumn({ children, className }: Props) {
  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col lg:h-full lg:w-[var(--w-rail-md)] xl:w-[var(--w-rail)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
