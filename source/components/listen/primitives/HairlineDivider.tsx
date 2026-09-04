import type { CSSProperties } from 'react';

interface Props {
  /** `v` = vertical hairline (default); `h` = horizontal. */
  orientation?: 'v' | 'h';
  /** Length along the major axis in px. Defaults to `'auto'` for stretching. */
  length?: number | 'auto';
  /** Override the hairline color. Defaults to `var(--hairline)`. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Thin 1px hairline divider — used to separate clusters in the token
 * header, columns in the PnL row, and segment groups in the chart
 * toolbar. Fixed thickness of 1px on the cross-axis.
 */
export function HairlineDivider({
  orientation = 'v',
  length = 'auto',
  color = 'var(--hairline)',
  className,
  style,
}: Props) {
  const isV = orientation === 'v';
  const lengthCss = length === 'auto' ? '100%' : `${length}px`;
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: isV ? 1 : lengthCss,
        height: isV ? lengthCss : 1,
        background: color,
        ...style,
      }}
    />
  );
}
