'use client';

/**
 * The funding address and what the chain says about it.
 *
 * THERE IS NO TRANSFER CONTROL HERE, AND THERE MUST NEVER BE ONE.
 * Inter-wallet transfers — including funding and defunding an agent
 * wallet — are in the permanently-never-exposed tier. The user funds
 * this wallet by sending SOL to the address below from wherever they
 * like; the address IS the funding mechanism, so the only affordance
 * this card offers is copying it.
 *
 * The balance is the server's confirmed read. When the balance RPC did
 * not answer the card says so in as many words rather than showing a
 * zero — "we could not look" and "it is empty" are different facts and
 * the user acts differently on each.
 */

import { Badge, Card, Note, Row, type Tone } from './Card';
import { fundingCopy, solText } from './format';
import type { AgentWalletStatus, FundingState } from './types';

const FUNDING_TONE: Readonly<Record<FundingState, Tone>> = {
  unknown: 'warn',
  unfunded: 'warn',
  insufficient: 'warn',
  funded: 'good',
};

export function AgentWalletFundingCard({
  wallet,
  onCopyAddress,
  copied = false,
}: {
  wallet: AgentWalletStatus;
  /** Optional: the host wires the clipboard. No handler, no button. */
  onCopyAddress?: ((address: string) => void) | undefined;
  copied?: boolean;
}) {
  const { funding, balance, fundingAddress } = wallet;
  const tone: Tone = funding.state.known === null ? 'warn' : FUNDING_TONE[funding.state.known];
  const balanceUnavailable = balance.source.known !== 'rpc' || balance.lamports === null;

  return (
    <Card
      title="Funding"
      testId="agent-wallet-funding"
      tone={tone}
      badge={
        <Badge tone={tone} testId="funding-state-badge">
          {funding.state.known ?? `unrecognised: ${funding.state.raw || 'missing'}`}
        </Badge>
      }
    >
      <Row label="Funding address" value={fundingAddress} testId="funding-address" mono />
      {onCopyAddress === undefined ? null : (
        <button
          type="button"
          data-testid="copy-funding-address"
          className="self-start rounded-[3px] border px-2 py-1 text-[11px] transition-colors hover:border-[var(--hairline-2)]"
          style={{ borderColor: 'var(--hairline)', color: 'var(--ink-0)' }}
          onClick={() => onCopyAddress(fundingAddress)}
        >
          {copied ? 'Copied' : 'Copy address'}
        </button>
      )}
      <Row
        label="Confirmed balance"
        value={balanceUnavailable ? 'unavailable' : solText(balance.lamports)}
        testId="funding-balance"
      />
      <Row
        label="Still required"
        value={solText(funding.requiredLamports)}
        testId="funding-required"
      />
      <Note testId="funding-copy">{fundingCopy(funding.state)}</Note>
      {balanceUnavailable ? (
        <Note testId="balance-unavailable">
          The balance service did not answer, so no balance is shown. This is a reporting gap,
          not a zero balance — retry in a moment, or check the address on a block explorer.
        </Note>
      ) : null}
      <Note testId="manual-funding-notice">
        Send SOL to the address above from any wallet. This card has no control that moves funds
        into or out of the agent wallet — to move SOL between your own wallets, drag onto the
        agent row in Portfolio → Wallets.
      </Note>
    </Card>
  );
}
