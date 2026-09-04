'use client';

/**
 * The one visual shell the agent-wallet cards share: a hairline box, a
 * title, an optional status badge. Kept here so five cards cannot drift
 * into five slightly different boxes.
 *
 * `tone` is severity only — it colours the badge and border and carries
 * no meaning of its own. Callers decide the tone from SERVER state; this
 * component never inspects the wallet.
 */

import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

const TONE_COLOR: Readonly<Record<Tone, string>> = {
  neutral: 'var(--hairline)',
  good: 'var(--pos, #2fbf71)',
  warn: 'var(--warn, #e0b341)',
  bad: 'var(--neg, #ff5c5c)',
};

export function Badge({
  tone,
  children,
  testId,
}: {
  tone: Tone;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <span
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      data-tone={tone}
      className="rounded-[3px] border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
      style={{ borderColor: TONE_COLOR[tone], color: TONE_COLOR[tone] }}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  testId,
  tone = 'neutral',
  badge,
  children,
}: {
  title: string;
  testId: string;
  tone?: Tone;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      data-tone={tone}
      className="flex flex-col gap-2 rounded-[4px] border px-3 py-2.5"
      style={{ borderColor: TONE_COLOR[tone] }}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[12px]" style={{ color: 'var(--ink-0)' }}>
          {title}
        </h2>
        {badge}
      </header>
      {children}
    </section>
  );
}

/** A label/value row. Values are server-reported strings, shown as-is. */
export function Row({
  label,
  value,
  testId,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span style={{ color: 'var(--ink-2)' }}>{label}</span>
      <span
        {...(testId === undefined ? {} : { 'data-testid': testId })}
        className={mono ? 'break-all text-right font-mono' : 'text-right'}
        style={{ color: 'var(--ink-0)' }}
      >
        {value}
      </span>
    </div>
  );
}

/** Explanatory prose. Never a place for a diagnosis without a next step. */
export function Note({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      {...(testId === undefined ? {} : { 'data-testid': testId })}
      className="text-[11px] leading-snug"
      style={{ color: 'var(--ink-2)' }}
    >
      {children}
    </p>
  );
}
