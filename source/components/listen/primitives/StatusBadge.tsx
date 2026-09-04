import { cn } from '@/lib/utils';

interface Props {
  label: string;
  className?: string;
}

/**
 * Small muted status pill — page-header loading/error states
 * (`TradePage`) and the chart OHLC readout's "warming up" cue
 * (`PriceChart`). Non-interactive; mono font, hairline border. One
 * source of truth replacing the two byte-identical local copies.
 */
export function StatusBadge({ label, className }: Props) {
  return (
    <span
      className={cn('t-num-xs inline-flex h-[18px] items-center px-2', className)}
      style={{
        borderRadius: 'var(--r-xs)',
        color: 'var(--ink-3)',
        background: 'var(--chip-bg)',
        border: '1px solid var(--chip-border, var(--hairline))',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </span>
  );
}
