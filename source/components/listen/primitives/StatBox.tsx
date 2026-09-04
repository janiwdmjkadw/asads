import type { CSSProperties } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Caption } from './Caption';
import { Numeral } from './Numeral';
import type { Tone } from './tokens';

export type StatBoxTone = 'up' | 'neutral';

/**
 * Inset label+value chip — `AnalyticsPanel`'s Smart$/Score badges and
 * any compact "labelled metric in a bordered box" surface. `cva` owns the
 * shared class composition; the per-tone fill/border are CSS-var
 * (`color-mix`, var-fallback) values that can't live in Tailwind classes,
 * so they're driven by a typed map instead of ternary soup (rule #10).
 * One source of truth replacing the two inline copies.
 */
const statBox = cva('flex h-[34px] flex-1 items-center gap-2 rounded-[var(--r-lg)] px-2.5');

const TONE_SURFACE: Record<StatBoxTone, CSSProperties> = {
  up: {
    background:
      'linear-gradient(135deg, color-mix(in srgb, var(--up) 10%, transparent), color-mix(in srgb, var(--accent-primary) 6%, transparent))',
    border: '1px solid color-mix(in srgb, var(--up) 25%, transparent)',
  },
  neutral: {
    background: 'var(--chip-bg)',
    border: '1px solid var(--chip-border, var(--hairline))',
  },
};

const VALUE_TONE: Record<StatBoxTone, Tone> = {
  up: 'up',
  neutral: 'ink-0',
};

interface Props {
  label: string;
  value: React.ReactNode;
  tone?: StatBoxTone;
  className?: string;
}

export function StatBox({ label, value, tone = 'neutral', className }: Props) {
  return (
    <div className={cn(statBox(), className)} style={TONE_SURFACE[tone]}>
      <Caption size="sm" tone="ink-3" style={{ letterSpacing: '0.14em' }}>
        {label}
      </Caption>
      <Numeral size="sm" tone={VALUE_TONE[tone]} emphasis className="ml-auto">
        {value}
      </Numeral>
    </div>
  );
}
