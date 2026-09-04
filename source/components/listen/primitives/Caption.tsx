import type { CSSProperties, ReactNode } from 'react';
import { toneVar, type Tone } from './tokens';

interface Props {
  /** `sm` = 10px / 0.14em tracking; `lg` = 11px / 0.16em tracking. */
  size?: 'sm' | 'lg';
  /** Color tone; defaults to `ink-3` (UPPERCASE label tone). */
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * UPPERCASE caption label — the "MC", "BUYS", "AGE / TIME" style headers
 * sprinkled across the trade page. Renders one of the `.t-caption*`
 * helper classes defined in trade.css so theme/font swaps propagate
 * without a re-render.
 */
export function Caption({
  size = 'sm',
  tone = 'ink-3',
  className,
  style,
  children,
}: Props) {
  const cls = size === 'lg' ? 't-caption-lg' : 't-caption';
  return (
    <span
      className={className ? `${cls} ${className}` : cls}
      style={{ color: toneVar(tone, 'ink-3'), ...style }}
    >
      {children}
    </span>
  );
}
