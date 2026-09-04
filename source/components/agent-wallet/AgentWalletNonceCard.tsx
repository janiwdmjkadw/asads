'use client';

/**
 * Nonce-pool provisioning: progress AND failure, side by side.
 *
 * `complete: false` on its own is not an answer — "3 of 5" with two
 * slots quietly failing looks identical to "3 of 5, still working". So
 * every slot list the server reports is rendered whenever it is
 * non-empty: missing (never attempted), failed (attempted, did not
 * land) and disabled (present, taken out of service). A silent hang is
 * a bug, so the pending state says what is running and how long it
 * takes.
 *
 * The action itself is the server's; this card only reports what came
 * back, including the partial-failure body's per-slot reasons.
 */

import type { NonceSetupResult } from '@/lib/api/wallet-nonce-setup';
import { Badge, Card, Note, Row, type Tone } from './Card';
import { solText } from './format';
import type { AgentWalletNoncePool } from './types';

function SlotList({
  label,
  slots,
  testId,
}: {
  label: string;
  slots: readonly number[];
  testId: string;
}) {
  if (slots.length === 0) return null;
  return (
    <Row label={label} value={slots.join(', ')} testId={testId} mono />
  );
}

function lamportsText(value: number): string {
  return solText(String(Math.trunc(value)));
}

function NonceOutcome({ result }: { result: NonceSetupResult }) {
  switch (result.kind) {
    case 'preflight':
      return (
        <div data-testid="nonce-preflight" className="flex flex-col gap-1">
          <Row label="Slots to create" value={result.preflight.missing_slots.length} />
          <Row
            label="Estimated cost"
            value={lamportsText(result.preflight.estimated_cost_lamports)}
          />
          <Row
            label="Wallet balance"
            value={lamportsText(result.preflight.wallet_balance_lamports)}
          />
          <Note>
            {result.preflight.sufficient
              ? 'The balance covers this. Run the provisioning to create the accounts.'
              : 'The balance does not cover this. Send more SOL to the funding address first.'}
          </Note>
        </div>
      );
    case 'ok':
      return (
        <Note testId="nonce-ok">
          Created {result.setup.created_count} account(s); {result.setup.total_count} of{' '}
          {result.setup.target_count} slots are now provisioned.
        </Note>
      );
    case 'insufficient_balance':
      return (
        <Note testId="nonce-insufficient">
          Not enough SOL: the wallet holds {lamportsText(result.observed_balance_lamports)} and{' '}
          {lamportsText(result.required_lamports)} is required. Send the shortfall to the funding
          address, then run this again.
        </Note>
      );
    case 'partial_failure':
      return (
        <div data-testid="nonce-partial-failure" className="flex flex-col gap-1">
          <Note>
            {result.created_count} account(s) were created and {result.failures.length} slot(s)
            failed. Re-running provisions only the slots that are still missing.
          </Note>
          <ul className="flex flex-col gap-0.5">
            {result.failures.map((failure) => (
              <li
                key={failure.slot}
                data-testid={`nonce-failure-${failure.slot}`}
                className="text-[11px] font-mono"
                style={{ color: 'var(--neg, #ff5c5c)' }}
              >
                slot {failure.slot}: {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'wrong_state':
      return (
        <Note testId="nonce-wrong-state">
          Provisioning is not available in the current account state ({result.state}).
        </Note>
      );
    case 'reauth':
      return (
        <Note testId="nonce-reauth">
          Your session needs to be re-established before provisioning. Sign in again and retry —
          nothing was changed.
        </Note>
      );
    default:
      return (
        <Note testId="nonce-error">
          {result.errorCode === 'agent_wallet_not_found'
            ? 'The server has no agent wallet for this account. Create one first.'
            : `Provisioning failed (${result.errorCode}): ${result.message}`}
        </Note>
      );
  }
}

export function AgentWalletNonceCard({
  pool,
  result,
  pending = false,
  onProvision,
}: {
  pool: AgentWalletNoncePool;
  /** Last provisioning response, or `null` if none has been run here. */
  result?: NonceSetupResult | null;
  pending?: boolean;
  onProvision?: ((options: { dryRun: boolean }) => void) | undefined;
}) {
  const hasFailures = pool.failedSlots.length > 0 || pool.disabledSlots.length > 0;
  const tone: Tone = hasFailures ? 'bad' : pool.complete ? 'good' : 'warn';

  return (
    <Card
      title="Nonce pool"
      testId="agent-wallet-nonce"
      tone={tone}
      badge={
        <Badge tone={tone} testId="nonce-badge">
          {pool.activeCount} / {pool.targetCount} active
        </Badge>
      }
    >
      <Row label="Complete" value={pool.complete ? 'yes' : 'no'} testId="nonce-complete" />
      <SlotList label="Missing slots" slots={pool.missingSlots} testId="nonce-missing-slots" />
      <SlotList label="Failed slots" slots={pool.failedSlots} testId="nonce-failed-slots" />
      <SlotList
        label="Disabled slots"
        slots={pool.disabledSlots}
        testId="nonce-disabled-slots"
      />
      {pool.failedSlots.length > 0 ? (
        <Note testId="nonce-failed-note">
          {pool.failedSlots.length} slot(s) failed to provision. Re-running provisioning retries
          exactly those slots; it does not recreate the ones that already work.
        </Note>
      ) : null}
      {pool.disabledSlots.length > 0 ? (
        <Note testId="nonce-disabled-note">
          {pool.disabledSlots.length} slot(s) are disabled and are not counted as active.
        </Note>
      ) : null}
      {onProvision === undefined ? null : (
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="nonce-preflight-button"
            disabled={pending}
            className="rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink-0)' }}
            onClick={() => onProvision({ dryRun: true })}
          >
            Check cost
          </button>
          <button
            type="button"
            data-testid="nonce-provision-button"
            disabled={pending}
            className="rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink-0)' }}
            onClick={() => onProvision({ dryRun: false })}
          >
            Provision nonce accounts
          </button>
        </div>
      )}
      {pending ? (
        <Note testId="nonce-pending">
          Provisioning — the server is signing and submitting one transaction per slot. This
          usually takes 5–15 seconds. You can leave this page; the work is server-side.
        </Note>
      ) : null}
      {result === undefined || result === null ? null : <NonceOutcome result={result} />}
    </Card>
  );
}
