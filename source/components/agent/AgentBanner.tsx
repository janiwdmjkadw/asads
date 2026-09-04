'use client';

/**
 * Explicit degraded-state banner (F§ inv. 5 / 04 "Degraded states are
 * explicit"): kill switch, budget exhausted, dead-lettered run, admission
 * expiry — the UI says so, with a retry affordance where applicable.
 * Silent hangs are bugs.
 */

import { useAgentChatStore } from '@/lib/agent/chat-store';

export function AgentBanner() {
  const banner = useAgentChatStore((s) => s.banner);
  const sendFailure = useAgentChatStore((s) => s.sendFailure);
  const retrySend = useAgentChatStore((s) => s.retrySend);
  const retryLastTurn = useAgentChatStore((s) => s.retryLastTurn);
  const dismissBanner = useAgentChatStore((s) => s.dismissBanner);

  if (banner === null) return null;

  const retry = (): void => {
    // POST-level failure retries the SAME key; a failed run is a new turn.
    if (sendFailure !== null) void retrySend();
    else void retryLastTurn();
  };

  return (
    <div
      role="alert"
      data-testid="agent-banner"
      className="ag-turn relative z-[2] flex items-start justify-between gap-2 border-b border-[rgba(229,185,80,0.3)] bg-[linear-gradient(170deg,rgba(229,185,80,0.16),rgba(229,185,80,0.05))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      <div className="min-w-0">
        <div className="text-[12px] leading-snug text-[var(--hold)]">{banner.message}</div>
        <div className="mt-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--ink-3)]">
          {banner.code}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {banner.retryable ? (
          <button
            type="button"
            onClick={retry}
            className="rounded border border-[var(--hairline-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[var(--ink-1)] transition-colors hover:border-[var(--hold)] hover:text-[var(--hold)]"
          >
            retry
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismissBanner}
          className="rounded px-1 text-[12px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink-1)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
