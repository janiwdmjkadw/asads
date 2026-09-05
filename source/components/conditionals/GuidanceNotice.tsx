'use client';

/**
 * One degraded-state notice: what happened, and what to do about it.
 *
 * The next step is ALWAYS rendered as text. The button appears only when
 * the host page actually wired a handler for that action — an
 * unactionable notice must never render a dead button, and the user must
 * never be left with a diagnosis and no instruction.
 */

import type { Guidance, GuidanceActionKind, GuidanceSeverity } from './guidance';

const SEVERITY_COLOR: Readonly<Record<GuidanceSeverity, string>> = {
  info: 'var(--hairline)',
  warn: 'var(--warn, #c08a12)',
  blocked: 'var(--neg, #b4482e)',
};

export function GuidanceNotice({
  guidance,
  onAction,
}: {
  guidance: Guidance;
  onAction?: ((action: GuidanceActionKind) => void) | undefined;
}) {
  const actionable = guidance.action !== 'none' && onAction !== undefined;
  return (
    <div
      role="status"
      data-testid="guidance"
      data-kind={guidance.kind}
      data-severity={guidance.severity}
      className="flex flex-col gap-1 rounded-[4px] border px-2.5 py-2"
      style={{ borderColor: SEVERITY_COLOR[guidance.severity] }}
    >
      <span className="text-[12px]" style={{ color: 'var(--ink-0)' }}>
        {guidance.title}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--ink-2)' }}>
        {guidance.detail}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--ink-1)' }} data-testid="next-step">
        {guidance.nextStep}
      </span>
      {actionable ? (
        <button
          type="button"
          className="mt-1 self-start rounded-[3px] border px-2 py-1 text-[11px] transition-colors hover:border-[var(--hairline-2)]"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink-0)' }}
          onClick={() => onAction(guidance.action)}
        >
          {guidance.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
