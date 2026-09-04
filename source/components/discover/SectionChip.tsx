import { LiveDot } from '@/components/listen/primitives';

interface Props {
  label: string;
  /** Alpha variant uses a slightly larger dot/label (8px / 13px vs 7px / 12px). */
  isAlpha?: boolean;
}

/**
 * Section header label chip — pulsing accent dot + UPPERCASE label inside
 * a tinted glass pill. The dot pulses via the shared `listen-pulse`
 * keyframes (in listen.css) and tints with the active theme's primary
 * accent — when the user picks a different theme via the cog, every
 * SectionChip instantly retints.
 */
export function SectionChip({ label, isAlpha = false }: Props) {
  const dotSize = isAlpha ? 8 : 7;
  const textSize = isAlpha ? 13 : 12;

  return (
    <span
      className="relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 leading-none"
      style={{
        border: '1px solid var(--chip-border)',
        background: 'var(--chip-bg)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px color-mix(in srgb, var(--accent-primary) 10%, transparent)',
      }}
    >
      <LiveDot size={dotSize} tone="primary" />
      <span
        className="font-semibold uppercase"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: `${textSize}px`,
          letterSpacing: '0.16em',
          color: 'var(--ink-0)',
          textShadow:
            '0 0 12px color-mix(in srgb, var(--accent-primary) 30%, transparent)',
        }}
      >
        {label}
      </span>
    </span>
  );
}
