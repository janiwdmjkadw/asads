import type { CSSProperties, ReactNode } from 'react';
import { toneVar, type Tone } from './tokens';

interface Props {
  /**
   * Type-scale step:
   *   `hero`    = 26px / 600 (MC headline)
   *   `display` = 17px / 500 (MC supporting values)
   *   `sm`      = 13px / 500 (panel readouts)
   *   `xs`      = 11px / 400 (table cells)
   */
  size?: 'hero' | 'display' | 'sm' | 'xs';
  tone?: Tone;
  /** Bump weight one notch (e.g. `Smart $` value at +600 in AnalyticsPanel). */
  emphasis?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  hero: 't-num-hero',
  display: 't-num',
  sm: 't-num-sm',
  xs: 't-num-xs',
};

/**
 * Tabular-numeric span that pulls font/size from CSS tokens. All numeric
 * data on the page (price, MC, ages, percentages, addresses) goes through
 * here so font swaps from the ThemeSwitcher hit consistently.
 */
export function Numeral({
  size = 'display',
  tone,
  emphasis,
  className,
  style,
  children,
}: Props) {
  const cls = SIZE_CLASS[size];
  return (
    <span
      className={className ? `${cls} ${className}` : cls}
      style={{
        color: tone ? toneVar(tone) : undefined,
        fontWeight: emphasis ? 600 : undefined,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
