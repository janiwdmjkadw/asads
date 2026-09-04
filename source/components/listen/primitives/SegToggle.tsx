import type { CSSProperties } from 'react';

interface Props<T extends string> {
  /** Two-option binary toggle (USD/SOL, MarketCap/Price, log/auto, etc.). */
  options: readonly [T, T];
  value: T;
  onChange: (next: T) => void;
  /**
   * Visual variant.
   *   `accent` — active option lit in `--accent-primary` (toolbar toggles).
   *   `plain`  — active option in `--ink-0` (segmented buttons in panels).
   */
  tone?: 'accent' | 'plain';
  className?: string;
  style?: CSSProperties;
}

/**
 * Typed binary segmented toggle. Replaces the per-callsite `Toggle`
 * helpers in `ChartToolbar` and the chart footer.
 */
export function SegToggle<T extends string>({
  options,
  value,
  onChange,
  tone = 'accent',
  className,
  style,
}: Props<T>) {
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 26,
        borderRadius: 6,
        padding: 2,
        background: 'var(--tabs-bg)',
        border: '1px solid var(--hairline)',
        ...style,
      }}
    >
      {options.map((opt) => {
        const active = value === opt;
        const activeColor = tone === 'accent' ? 'var(--accent-primary)' : 'var(--ink-0)';
        const activeBg =
          tone === 'accent'
            ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)'
            : 'rgba(255,255,255,0.05)';
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: '100%',
              padding: '0 8px',
              borderRadius: 5,
              fontSize: 11,
              cursor: 'pointer',
              color: active ? activeColor : 'var(--ink-3)',
              background: active ? activeBg : 'transparent',
              fontWeight: active ? 600 : 400,
              border: 'none',
              transition: 'color 60ms linear, background 60ms linear',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
