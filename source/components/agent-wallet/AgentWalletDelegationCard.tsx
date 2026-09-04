'use client';

/**
 * Durable authorization: what it is doing, how to start it, how to stop it.
 *
 * GRANT AND REVOKE ARE DELIBERATELY ASYMMETRIC.
 *
 * Revoke is one click, with no confirmation ceremony. Grant takes two:
 * a first click that only reveals what is being authorized, and a second
 * that performs it. Granting means the agent executes approved
 * conditionals while the owner is signed out — a real escalation — and
 * making the SAFE direction harder to reach than the unsafe one is how
 * wallets stay authorized by accident. The api enforces the same shape
 * (a single-use step-up challenge on grant, a bare POST on revoke); this
 * card is the human half of it, not the whole gate.
 *
 * THE CONFIRMATION STAGE IS A PROP, NOT LOCAL STATE. `AgentWalletPanel`
 * owns `grantConfirming`, so this component stays a pure function of
 * server state plus that flag — which is what lets a test assert that no
 * grant control exists at all until the user has asked for one.
 *
 * `paused` is split into "never granted" and "granted, not in force"
 * because `granted_at` distinguishes them and the user's next step is
 * different: authorize, versus clear the readiness blockers.
 */

import { Badge, Card, Note, Row, type Tone } from './Card';
import {
  DELEGATION_DETAIL,
  DELEGATION_HEADLINE,
  delegationPresentation,
  timestampText,
  type DelegationPresentation,
} from './format';
import type {
  AgentWalletDelegation,
  AgentWalletGrantPayload,
  AgentWalletResult,
  AgentWalletRevokePayload,
} from './types';

const TONE: Readonly<Record<DelegationPresentation, Tone>> = {
  active: 'good',
  never_granted: 'neutral',
  granted_not_in_force: 'warn',
  revoked: 'neutral',
  authorization_revoked: 'warn',
  unrecognised: 'warn',
};

/** States where a live durable delegation exists for revoke to end. */
const REVOCABLE: ReadonlySet<DelegationPresentation> = new Set<DelegationPresentation>([
  'active',
  'granted_not_in_force',
  // Unknown state, revoked_at unset: offer the safe direction anyway.
  'unrecognised',
]);

/**
 * States where granting is possible AND would change something.
 *
 * Excluded on purpose:
 *  - `active` / `granted_not_in_force` — already granted; a grant here is
 *    a no-op the server reports as `granted:false`.
 *  - `authorization_revoked` — there is no active trading authorization
 *    to attach a delegation to, so the server would answer 409. Offering
 *    a button that cannot succeed is worse than offering none.
 *  - `unrecognised` — the terminal does not understand the server's
 *    state. Degrading means declining to offer the ESCALATION, never
 *    declining to offer the revoke next door.
 */
const GRANTABLE: ReadonlySet<DelegationPresentation> = new Set<DelegationPresentation>([
  'never_granted',
  'revoked',
]);

function RevokeOutcome({ result }: { result: AgentWalletResult<AgentWalletRevokePayload> }) {
  if (result.kind === 'reauth') {
    return (
      <Note testId="revoke-reauth">
        Your session needs to be re-established before revoking. Sign in again and retry —
        nothing was changed.
      </Note>
    );
  }
  if (result.kind === 'error') {
    return (
      <Note testId="revoke-error">
        {result.errorCode === 'agent_wallet_not_found'
          ? 'The server has no agent wallet for this account, so there is nothing to revoke.'
          : `Revoke failed (${result.errorCode}): ${result.message}`}
      </Note>
    );
  }
  return (
    <Note testId="revoke-ok">
      {result.value.revoked
        ? 'Revoked. The agent can no longer trade this wallet; new claims are refused immediately.'
        : 'Nothing to revoke — no live durable delegation was in force, so this changed nothing and the original revocation time is unchanged.'}
    </Note>
  );
}

/**
 * `reauth` and `step_up_required` are both "prove it is you and try
 * again", not faults — the api returns the first as an HTTP 200 and the
 * second when a two-minute challenge lapses mid-ceremony. Neither may
 * read as a failure, and neither changed anything on the server.
 */
function GrantOutcome({ result }: { result: AgentWalletResult<AgentWalletGrantPayload> }) {
  if (result.kind === 'reauth') {
    return (
      <Note testId="grant-reauth">
        Your session needs to be re-established before authorizing. Sign in again and retry —
        nothing was changed, and the agent is still not authorized to trade while you are
        signed out.
      </Note>
    );
  }
  if (result.kind === 'error') {
    if (result.errorCode === 'step_up_required') {
      return (
        <Note testId="grant-step-up">
          For your security this confirmation expired before it was used. Nothing was changed —
          start over and confirm again.
        </Note>
      );
    }
    return (
      <Note testId="grant-error">
        {result.errorCode === 'agent_wallet_not_found'
          ? 'The server has no agent wallet for this account, so there is nothing to authorize.'
          : result.errorCode === 'no_active_authorization'
            ? 'This wallet has no active trading authorization for a durable delegation to attach to. Nothing was changed — contact support.'
            : `Authorization failed (${result.errorCode}): ${result.message}`}
      </Note>
    );
  }
  return (
    <Note testId="grant-ok">
      {result.value.granted
        ? 'Authorized. The agent can now execute your approved conditionals while you are signed out, until you revoke.'
        : 'Already authorized — this changed nothing, and the original authorization date is unchanged.'}
    </Note>
  );
}

/**
 * What the user is about to authorize, in plain language, shown BEFORE
 * the button that does it. Deliberately says both what it enables and
 * what it does not, and that it is reversible at any moment.
 */
function GrantConfirmation({
  onConfirm,
  onCancel,
  pending,
}: {
  onConfirm: () => void;
  onCancel?: (() => void) | undefined;
  pending: boolean;
}) {
  return (
    <div data-testid="grant-confirm" className="flex flex-col gap-2">
      <Note testId="grant-confirm-what">
        You are about to let your agent wallet execute conditionals you have already approved
        while you are signed out. No browser tab has to stay open, and you will not be asked to
        re-authorize on a schedule.
      </Note>
      <Note testId="grant-confirm-limits">
        This does not let the agent move your funds, place trades you have not approved, or use
        any other wallet. It stays in effect until you revoke it, which you can do here at any
        time.
      </Note>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="grant-delegation-confirm"
          disabled={pending}
          className="self-start rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
          style={{ borderColor: 'var(--warn, #e0b341)', color: 'var(--warn, #e0b341)' }}
          onClick={onConfirm}
        >
          {pending ? 'Authorizing…' : 'Yes, authorize hands-off trading'}
        </button>
        {onCancel === undefined ? null : (
          <button
            type="button"
            data-testid="grant-delegation-cancel"
            disabled={pending}
            className="self-start rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--hairline)', color: 'var(--ink-2)' }}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function AgentWalletDelegationCard({
  delegation,
  onRevoke,
  pending = false,
  result,
  onGrantIntent,
  onGrantConfirm,
  onGrantCancel,
  grantConfirming = false,
  grantPending = false,
  grantResult,
}: {
  delegation: AgentWalletDelegation;
  onRevoke?: (() => void) | undefined;
  pending?: boolean;
  result?: AgentWalletResult<AgentWalletRevokePayload> | null;
  /** First click: ask to authorize. Reveals the confirmation, calls nothing. */
  onGrantIntent?: (() => void) | undefined;
  /** Second click: actually authorize. The ONLY control that grants. */
  onGrantConfirm?: (() => void) | undefined;
  onGrantCancel?: (() => void) | undefined;
  grantConfirming?: boolean;
  grantPending?: boolean;
  grantResult?: AgentWalletResult<AgentWalletGrantPayload> | null;
}) {
  const presentation = delegationPresentation(delegation);
  const tone = TONE[presentation];
  const canRevoke =
    onRevoke !== undefined && delegation.revokedAt === null && REVOCABLE.has(presentation);
  const canGrant = onGrantConfirm !== undefined && GRANTABLE.has(presentation);

  return (
    <Card
      title="Durable authorization"
      testId="agent-wallet-delegation"
      tone={tone}
      badge={
        <Badge tone={tone} testId="delegation-badge">
          {delegation.state.known ?? `unrecognised: ${delegation.state.raw || 'missing'}`}
        </Badge>
      }
    >
      <Row
        label="Status"
        value={DELEGATION_HEADLINE[presentation]}
        testId="delegation-headline"
      />
      <Row
        label="Mode"
        value={delegation.mode.known ?? `unrecognised: ${delegation.mode.raw || 'missing'}`}
        testId="delegation-mode"
      />
      <Row label="Granted" value={timestampText(delegation.grantedAt)} testId="delegation-granted" />
      <Row label="Revoked" value={timestampText(delegation.revokedAt)} testId="delegation-revoked" />
      <Row
        label="Authorization expires"
        value={timestampText(delegation.authorizationExpiresAt)}
        testId="delegation-expires"
      />
      <Note testId="delegation-detail">{DELEGATION_DETAIL[presentation]}</Note>
      {presentation === 'active' ? (
        <Note testId="delegation-no-tab-note">
          No browser tab needs to stay open and no periodic sign-in is required while this is
          active.
        </Note>
      ) : null}
      {canGrant ? (
        grantConfirming ? (
          <GrantConfirmation
            onConfirm={onGrantConfirm}
            onCancel={onGrantCancel}
            pending={grantPending}
          />
        ) : (
          <button
            type="button"
            data-testid="grant-delegation-button"
            disabled={grantPending}
            className="self-start rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
            style={{ borderColor: 'var(--warn, #e0b341)', color: 'var(--warn, #e0b341)' }}
            onClick={onGrantIntent}
          >
            {presentation === 'revoked'
              ? 'Re-authorize hands-off trading'
              : 'Authorize hands-off trading'}
          </button>
        )
      ) : null}
      {canRevoke ? (
        <button
          type="button"
          data-testid="revoke-delegation-button"
          disabled={pending}
          className="self-start rounded-[3px] border px-2 py-1 text-[11px] disabled:opacity-50"
          style={{ borderColor: 'var(--neg, #ff5c5c)', color: 'var(--neg, #ff5c5c)' }}
          onClick={onRevoke}
        >
          {pending ? 'Revoking…' : 'Revoke authorization'}
        </button>
      ) : (
        <Note testId="delegation-no-revoke">
          There is no live durable authorization to revoke.
        </Note>
      )}
      {result === undefined || result === null ? null : <RevokeOutcome result={result} />}
      {grantResult === undefined || grantResult === null ? null : (
        <GrantOutcome result={grantResult} />
      )}
    </Card>
  );
}
