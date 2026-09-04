'use client';

/**
 * BEFORE THE THREE STEPS: there is no wallet yet.
 *
 * It was a bordered card with a `not created` badge in the corner, in a
 * tone so quiet you could not read it, over a `Account provisioning:
 * ready` row that means nothing to anybody. A state you cannot see is
 * not a state, and the raw provisioning enum was never for a user.
 *
 * This arm says what an agent wallet IS in one paragraph, offers the one
 * button that makes it, and keeps every documented failure as its own
 * sentence — including the two that pressing the button again will not
 * fix, which say what to do instead.
 *
 * It wears the same materials as the steps it precedes (`aw-` in
 * `AgentWalletSurface`), so creating one and setting it up are visibly
 * the same surface.
 */

import type { AgentWalletCreated, AgentWalletResult } from './types';

const CREATE_ERROR_COPY: Readonly<Record<string, string>> = {
  wallet_not_owned_by_user: 'That wallet does not belong to this account.',
  no_active_authorization:
    'This account has no active trading authorization, which an agent wallet is created from. Authorize trading first, then try again.',
  wallet_not_ready_for_agent_wallet:
    'This account is not far enough through provisioning to have an agent wallet yet. Finish account setup and try again.',
  signer_material_missing:
    'The signing material needed to create an agent wallet is not available for this account. This one needs support, and pressing the button again will not fix it.',
  provisioning_integrity_error:
    'The server found its own records inconsistent and refused to guess. Nothing was created. Please contact support.',
  agent_wallet_provisioning_failed:
    'The provisioning service did not complete. Nothing was created, so try again shortly.',
};

function CreateOutcome({ result }: { result: AgentWalletResult<AgentWalletCreated> }) {
  if (result.kind === 'reauth') {
    return (
      <p className="aw-note" data-testid="create-reauth">
        Your session needs to be re-established. Sign in again and retry. Nothing was created.
      </p>
    );
  }
  if (result.kind === 'error') {
    return (
      <p className="aw-note" data-testid="create-error">
        {CREATE_ERROR_COPY[result.errorCode] ??
          `Could not create the agent wallet (${result.errorCode}): ${result.message}`}
      </p>
    );
  }
  return (
    <div data-testid="create-ok">
      <p className="aw-note" data-testid="create-created-flag">
        {result.value.created
          ? 'Created. Its funding address is below.'
          : 'One already existed for this account, so this changed nothing. There is only ever one.'}
      </p>
      <div className="aw-addr">
        <code>{result.value.fundingAddress}</code>
      </div>
    </div>
  );
}

export function AgentWalletCreateCard({
  provisioningState,
  onCreate,
  pending = false,
  result,
}: {
  provisioningState: string;
  onCreate?: (() => void) | undefined;
  pending?: boolean;
  result?: AgentWalletResult<AgentWalletCreated> | null;
}) {
  /* The provisioning enum only earns a line when it is NOT the state
     that lets you proceed. Printing `ready` at a user is noise. */
  const blocked = provisioningState !== 'ready' && provisioningState !== '';

  return (
    <div data-testid="agent-wallet-create">
      <p className="aw-lead">You do not have an agent wallet yet.</p>
      <p className="aw-say" data-testid="create-intro" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', margin: 0 }}>
        It is a separate, single wallet the agent trades from, and it never appears in the ordinary
        wallet pickers. Creating it moves no funds.
      </p>
      {blocked ? (
        <p className="aw-note" data-testid="provisioning-state">
          This account is still provisioning, and the server reports it as {provisioningState}.
        </p>
      ) : null}
      {onCreate === undefined ? null : (
        <div className="aw-act">
          <button
            type="button"
            className="aw-go"
            data-testid="create-agent-wallet-button"
            disabled={pending}
            onClick={onCreate}
          >
            {pending ? 'Creating…' : 'Create agent wallet'}
          </button>
        </div>
      )}
      {pending ? (
        <p className="aw-note" data-testid="create-pending">
          This runs on the server and takes a few seconds. Pressing it twice cannot make a second
          wallet.
        </p>
      ) : null}
      {result === undefined || result === null ? null : <CreateOutcome result={result} />}
    </div>
  );
}
