'use client';

/**
 * Small status/fallback chip (dim pill with a state dot) — the graceful
 * degradation lane shared by unknown part types, status parts, and
 * unparseable tool previews.
 */

export function Chip({
  label,
  title,
  tone,
  pulse,
  testId,
}: {
  label: string;
  title?: string;
  tone: 'dim' | 'active';
  pulse?: boolean;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
        tone === 'active'
          ? 'border-[var(--hairline-2)] text-[var(--ink-2)]'
          : 'border-[var(--hairline)] text-[var(--ink-3)]'
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === 'active' ? 'bg-[var(--flame)]' : 'bg-[var(--ink-4)]'
        } ${pulse === true ? 'trade-activity-pulse' : ''}`}
      />
      <span className="truncate normal-case tracking-normal">{label}</span>
    </span>
  );
}
