import type { CSSProperties } from 'react';
import { toneVar, type Tone } from './tokens';

interface Props {
  size?: number;
  tone?: Tone;
  /** Animate with `listen-pulse`. Defaults to true. */
  pulse?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Small pulsing dot used as a live indicator (top-nav, AnalyticsPanel
 * "LIVE" tag, header status). Tone defaults to the primary accent so it
 * tracks the current theme; pass `tone="up"` for a green health-style
 * indicator.
 */
export function LiveDot({
  size = 6,
  tone = 'primary',
  pulse = true,
  className,
  style,
}: Props) {
  const color = toneVar(tone);
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 ${Math.max(6, size + 2)}px ${color}`,
        animation: pulse ? 'listen-pulse 2.4s ease-in-out infinite' : undefined,
        ...style,
      }}
    />
  );
}
