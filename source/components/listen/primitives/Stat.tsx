import type { CSSProperties, ReactNode } from 'react';
import { Caption } from './Caption';
import { Numeral } from './Numeral';
import type { Tone } from './tokens';

interface Props {
  label: string;
  value: ReactNode;
  /** Numeral size step; defaults to `display` (17px). */
  valueSize?: 'hero' | 'display' | 'sm' | 'xs';
  /** Numeral tone; pass `auto` (default) to let consumer style via CSS-var. */
  valueTone?: Tone;
  /** Caption tracking step. */
  labelSize?: 'sm' | 'lg';
  /** `column` (default, label above) or `row` (label inline before value). */
  orientation?: 'column' | 'row';
  /** Center vs left-align. Defaults to centered (matches token-header). */
  align?: 'center' | 'start';
  className?: string;
  style?: CSSProperties;
}

/**
 * Label + numeric-value stack used everywhere data is shown with a
 * caption — TokenHeaderBar (5m Vol/Buys/Sells), TradePanel PnL row,
 * AnalyticsPanel Smart$/Score badges. Generalizes the inline `Stat` /
 * `PnLStat` helpers that existed inside each component.
 */
export function Stat({
  label,
  value,
  valueSize = 'display',
  valueTone,
  labelSize = 'lg',
  orientation = 'column',
  align = 'center',
  className,
  style,
}: Props) {
  const isRow = orientation === 'row';
  const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: isRow ? 'row' : 'column',
    alignItems: align === 'center' ? 'center' : 'flex-start',
    gap: isRow ? 8 : 6,
    minWidth: 0,
    ...style,
  };
  return (
    <div className={className} style={wrapStyle}>
      <Caption size={labelSize}>{label}</Caption>
      <Numeral size={valueSize} tone={valueTone}>
        {value}
      </Numeral>
    </div>
  );
}
