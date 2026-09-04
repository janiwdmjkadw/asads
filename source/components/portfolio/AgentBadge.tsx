'use client';

/**
 * Slice "Agent wallet as a first-class wallet": the AGENT pill.
 *
 * Extracted verbatim from the Portfolio → Wallets row so every surface
 * that can now SELECT the agent wallet — the trade-page wallet picker,
 * the batch multi-select, the sub-header cluster — marks it with the
 * same treatment the wallets table already established. The agent
 * wallet is a different KIND of wallet (authorized rather than enabled,
 * and the agent trades from it unattended), so it must never read as
 * one more anonymous row in a list the user is choosing from.
 *
 * Deliberately style-only and prop-free: one appearance, one title, no
 * variants to drift apart across the four places it renders.
 */

/** Tooltip shown on the badge. Single source so the copy cannot drift. */
export const AGENT_BADGE_TITLE = 'Your agent wallet — the wallet the agent trades from';

export function AgentBadge(): React.ReactElement {
  return (
    <span
      data-testid="agent-wallet-badge"
      title={AGENT_BADGE_TITLE}
      style={{
        marginLeft: 4,
        fontSize: 9,
        letterSpacing: '0.06em',
        color: 'var(--accent-primary)',
        background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)',
        borderRadius: 999,
        padding: '0 6px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      AGENT
    </span>
  );
}
