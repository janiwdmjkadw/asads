'use client';

import { Wallet } from '@/components/listen/icons/Icons';

/**
 * Slice "Portfolio Spot tab": empty / pre-provisioning state.
 *
 * Two variants:
 *   - `kind="no_wallets"` — user has no Solana wallets yet (the
 *     coordinator hasn't run a wallet-create yet).
 *   - `kind="fund"` — wallets exist but every one of them is empty.
 */

interface Props {
  readonly kind: 'no_wallets' | 'fund';
  readonly onAction?: () => void;
  readonly actionLabel?: string;
}

export function SpotEmpty(props: Props): React.ReactElement {
  const title =
    props.kind === 'no_wallets'
      ? 'No wallets yet'
      : 'Fund your wallet to see your portfolio';
  const body =
    props.kind === 'no_wallets'
      ? 'Create a wallet to start tracking your spot portfolio.'
      : 'Once you receive SOL or any SPL token, your portfolio will appear here in real time.';

  return (
    <div
      style={{
        flex: 1,
        minHeight: 360,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 32,
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 52,
          height: 52,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-1, var(--d-spotempty-1, rgba(11, 14, 20, 0.05)))',
          border: '1px solid var(--hairline)',
          color: 'var(--ink-2)',
        }}
      >
        <Wallet style={{ width: 22, height: 22 }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-0)' }}>{title}</div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink-3)',
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
      {props.onAction ? (
        <button
          type="button"
          onClick={props.onAction}
          style={{
            marginTop: 8,
            padding: '8px 18px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            border: '1px solid transparent',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {props.actionLabel ?? 'Manage wallets'}
        </button>
      ) : null}
    </div>
  );
}
