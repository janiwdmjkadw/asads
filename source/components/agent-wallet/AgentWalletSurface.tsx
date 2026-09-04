'use client';

/**
 * THE AGENT WALLET, IN THE FLASH DIALOG'S LOOK.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────
 *
 * Five stacked cards on a dark plate, each a table of server fields:
 * `Account provisioning: ready_to_trade`, `Wallet status: active`,
 * `Enabled: yes`, `Archived: no`, then readiness, funding, nonce pool
 * and delegation, every one in its own bordered box with an amber chip.
 * A debug dump with a dialog round it.
 *
 * ── THE LOOK ─────────────────────────────────────────────────────────
 *
 * The Flash dialog's palette, verbatim: #0B0E14 ink on #FFFFFF, #E8ECEA
 * for the one recessed panel, #134E4A for a figure that is settled,
 * #B4482E for one that is short. The product already ships this, and it
 * is the only surface in it that is not black, which is right for a
 * dialog you meet three times and then never again.
 *
 * NO MONOSPACE ON FIGURES. The mono face draws a slashed zero, and
 * `0 OF 5` in it reads as a diagnostic. Every number here is the sans at
 * `tabular-nums`, which lines up just as well and looks like money. The
 * title keeps the mono because it carries no digits and that face is
 * half of what makes this dialog recognisable.
 *
 * ── AND IT IS STILL THREE STEPS ──────────────────────────────────────
 *
 * Fund it, provision its lanes, authorize it. The panel states all three
 * at once and the footer carries the action for whichever is next, so it
 * never asks you to choose which thing to do.
 */

import type { NonceSetupResult } from '@/lib/api/wallet-nonce-setup';
import { AgentWalletCreateCard } from './AgentWalletCreateCard';
import type {
  AgentWalletCreated,
  AgentWalletGrantPayload,
  AgentWalletResult,
  AgentWalletRevokePayload,
  AgentWalletStatus,
  AgentWalletStatusPayload,
} from './types';

const REAUTH_COPY: Readonly<Record<string, string>> = {
  no_session: 'You are signed out.',
  session_expired: 'Your session expired.',
  session_invalid: 'Your session is no longer valid.',
};

export interface AgentWalletSurfaceProps {
  /** `null` while the first status read is in flight. */
  status: AgentWalletResult<AgentWalletStatusPayload> | null;
  onRetry?: (() => void) | undefined;
  onCreate?: (() => void) | undefined;
  createPending?: boolean;
  createResult?: AgentWalletResult<AgentWalletCreated> | null;
  onCopyAddress?: ((address: string) => void) | undefined;
  addressCopied?: boolean;
  onProvisionNonces?: ((options: { dryRun: boolean }) => void) | undefined;
  /** Opens Flash for the agent wallet: the same one-time lane upgrade. */
  onFlash?: (() => void) | undefined;
  noncePending?: boolean;
  nonceResult?: NonceSetupResult | null;
  onRevokeDelegation?: (() => void) | undefined;
  revokePending?: boolean;
  revokeResult?: AgentWalletResult<AgentWalletRevokePayload> | null;
  /**
   * Granting is a TWO-STEP action, so it takes three callbacks and a
   * flag rather than one handler. `onGrantIntent` only reveals what is
   * about to be authorized; `onGrantDelegation` performs it.
   */
  onGrantIntent?: (() => void) | undefined;
  onGrantDelegation?: (() => void) | undefined;
  onGrantCancel?: (() => void) | undefined;
  grantConfirming?: boolean;
  grantPending?: boolean;
  grantResult?: AgentWalletResult<AgentWalletGrantPayload> | null;
}

/** Lamport string to SOL, trimmed. Strings in, because they are BigInt sized. */
function sol(lamports: string | null | undefined): string {
  if (typeof lamports !== 'string' || !/^\d+$/.test(lamports)) return '0';
  const n = Number(lamports) / 1_000_000_000;
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(n > 0 && n < 0.001 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function Row({
  label,
  children,
  tone,
  testId,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly tone?: 'good' | 'warn';
  readonly testId?: string;
}) {
  return (
    <div className="aw-row" data-testid={testId}>
      <span className="aw-k">{label}</span>
      <b className={tone === undefined ? 'aw-val' : `aw-val is-${tone}`}>{children}</b>
    </div>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div data-testid="agent-wallet-surface" className="aw">
      <style>{SHEET}</style>
      {children}
    </div>
  );
}

export function AgentWalletSurface(props: AgentWalletSurfaceProps) {
  const { status } = props;

  if (status === null) {
    return (
      <Shell>
        <h2 className="aw-title">Agent wallet</h2>
        <p className="aw-body" data-testid="agent-wallet-loading">
          Reading its state…
        </p>
      </Shell>
    );
  }

  if (status.kind === 'reauth') {
    return (
      <Shell>
        <h2 className="aw-title">Signed out</h2>
        <p className="aw-body" data-testid="agent-wallet-reauth">
          {REAUTH_COPY[status.reason.known ?? ''] ?? 'Your session could not be verified.'} This
          affects only what you can see. An agent wallet with a durable authorization keeps trading
          while you are signed out.
        </p>
        <div className="aw-foot">
          <span />
          {props.onRetry === undefined ? null : (
            <button
              type="button"
              className="aw-cta"
              onClick={props.onRetry}
              data-testid="agent-wallet-retry"
            >
              Retry
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (status.kind === 'error') {
    return (
      <Shell>
        <h2 className="aw-title">Unreachable</h2>
        <p className="aw-body" data-testid="error-note">
          {status.message} ({status.errorCode})
        </p>
        <p className="aw-body aw-small" data-testid="error-guidance">
          Nothing has changed on the server. Retry, and if it keeps failing contact support rather
          than creating anything new.
        </p>
        <div className="aw-foot">
          <span />
          {props.onRetry === undefined ? null : (
            <button
              type="button"
              className="aw-cta"
              onClick={props.onRetry}
              data-testid="agent-wallet-retry"
            >
              Retry
            </button>
          )}
        </div>
      </Shell>
    );
  }

  const { provisioningState, agentWallet } = status.value;

  if (agentWallet === null) {
    return (
      <Shell>
        <AgentWalletCreateCard
          provisioningState={provisioningState}
          onCreate={props.onCreate}
          pending={props.createPending ?? false}
          result={props.createResult ?? null}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Ready wallet={agentWallet} {...props} />
    </Shell>
  );
}

function Ready(props: AgentWalletSurfaceProps & { readonly wallet: AgentWalletStatus }) {
  const w = props.wallet;
  const funded = w.funding.sufficient;
  const lanes = w.noncePool;
  const granted = w.delegation.state.known === 'active';
  const ready = w.readiness.readyToTrade;

  const headline = ready
    ? 'It can trade'
    : granted
      ? 'Almost there'
      : lanes.complete
        ? 'One step left'
        : funded
          ? 'Give it lanes'
          : 'Fund it';

  const body = ready
    ? 'Funded, provisioned and authorized. The agent trades from this wallet on its own.'
    : granted
      ? 'Authorized. The server is finishing its last checks.'
      : lanes.complete
        ? 'Funded and provisioned. Authorize it and it can trade while you are signed out.'
        : funded
          ? 'Each lane lets an order go out on its own relay, which is what makes the agent fast rather than merely automatic.'
          : 'Send SOL to the address below from any wallet. Nothing else here can move funds in or out.';

  return (
    <>
      <h2 className="aw-title">{headline}</h2>
      <p className="aw-body" data-testid="agent-wallet-headline">
        {body}
      </p>

      {funded ? null : (
        <div className="aw-addr">
          <code data-testid="agent-wallet-funding-address">{w.fundingAddress}</code>
          <button
            type="button"
            data-testid="agent-wallet-copy"
            onClick={() => props.onCopyAddress?.(w.fundingAddress)}
            disabled={props.onCopyAddress === undefined}
          >
            {props.addressCopied === true ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      <div className="aw-panel">
        <Row label="Funded" tone={funded ? 'good' : 'warn'} testId="aw-row-funded">
          {sol(w.balance.lamports)} SOL
          {funded ? null : <em> · {sol(w.funding.requiredLamports)} short</em>}
        </Row>

        <Row label="Lanes" tone={lanes.complete ? 'good' : undefined} testId="aw-row-lanes">
          {lanes.activeCount} of {lanes.targetCount}
        </Row>
        <div className="aw-bars" aria-hidden>
          {Array.from({ length: lanes.targetCount }, (_, i) => (
            <span key={i} className={i < lanes.activeCount ? 'is-on' : undefined} />
          ))}
        </div>
        {lanes.failedSlots.length === 0 ? null : (
          <p className="aw-panel-note" data-testid="aw-lane-failed">
            {lanes.failedSlots.length === 1 ? 'One lane' : `${lanes.failedSlots.length} lanes`} did
            not come up. Provisioning again finishes the rest.
          </p>
        )}

        <Row label="Authorization" tone={granted ? 'good' : undefined} testId="aw-row-auth">
          {granted ? 'Granted' : 'Not granted'}
        </Row>
      </div>

      {props.grantConfirming === true ? (
        <p className="aw-body aw-small" data-testid="aw-grant-confirm-copy">
          The agent will place and cancel orders from this wallet on its own, without you present.
          It cannot withdraw to an address that is not yours, and you can revoke it here at any
          time.
        </p>
      ) : null}

      {w.delegation.state.known === null ? (
        <p className="aw-body aw-small" data-testid="aw-delegation-raw">
          The server reports this authorization as {w.delegation.state.raw}, which this build does
          not recognise.
        </p>
      ) : null}

      {ready || w.readiness.blockers.length === 0 ? null : (
        <p className="aw-body aw-small" data-testid="agent-wallet-blockers">
          Still holding it back: {w.readiness.blockers.map(blockerWord).join(', ')}.
        </p>
      )}

      <Footer {...props} funded={funded} lanesComplete={lanes.complete} granted={granted} />
    </>
  );
}

/** One action, for whichever step is next. Never two decisions at once. */
function Footer(
  props: AgentWalletSurfaceProps & {
    readonly funded: boolean;
    readonly lanesComplete: boolean;
    readonly granted: boolean;
  },
) {
  if (props.granted) {
    return (
      <div className="aw-foot">
        <span />
        <button
          type="button"
          className="aw-ghost"
          onClick={props.onRevokeDelegation}
          disabled={props.revokePending === true || props.onRevokeDelegation === undefined}
          data-testid="agent-wallet-revoke"
        >
          {props.revokePending === true ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
    );
  }

  if (props.lanesComplete) {
    if (props.grantConfirming === true) {
      return (
        <div className="aw-foot">
          <button
            type="button"
            className="aw-link"
            onClick={props.onGrantCancel}
            data-testid="agent-wallet-grant-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="aw-cta"
            onClick={props.onGrantDelegation}
            disabled={props.grantPending === true || props.onGrantDelegation === undefined}
            data-testid="agent-wallet-grant-confirm"
          >
            {props.grantPending === true ? 'Authorizing…' : 'Yes, authorize'}
          </button>
        </div>
      );
    }
    return (
      <div className="aw-foot">
        <span />
        <button
          type="button"
          className="aw-cta"
          onClick={props.onGrantIntent}
          disabled={props.onGrantIntent === undefined}
          data-testid="agent-wallet-grant"
        >
          Authorize
        </button>
      </div>
    );
  }

  /* Not yet provisioned. Flash is the productized path; the raw
     provisioning stays as the quiet one beside it. */
  return (
    <div className="aw-foot">
      <button
        type="button"
        className="aw-link"
        onClick={
          props.onProvisionNonces === undefined
            ? undefined
            : () => props.onProvisionNonces?.({ dryRun: false })
        }
        disabled={
          !props.funded || props.noncePending === true || props.onProvisionNonces === undefined
        }
        data-testid="agent-wallet-provision"
      >
        {props.noncePending === true ? 'Provisioning…' : 'Provision manually'}
      </button>
      <button
        type="button"
        className="aw-cta"
        onClick={props.onFlash}
        disabled={!props.funded || props.onFlash === undefined}
        data-testid="agent-wallet-flash"
      >
        Turn on Flash
      </button>
    </div>
  );
}

/** The server's blockers, in words. An unknown one prints verbatim. */
function blockerWord(b: { readonly known: string | null; readonly raw: string }): string {
  switch (b.known) {
    case 'wallet_disabled':
      return 'the wallet is disabled';
    case 'wallet_archived':
      return 'the wallet is archived';
    case 'no_active_authorization':
      return 'it has no live authorization';
    case 'policy_version_disabled':
      return 'its policy version is off';
    case 'authorization_revoked':
      return 'the authorization was revoked';
    case 'authorization_expired':
      return 'the authorization expired';
    case 'nonce_pool_incomplete':
      return 'its lanes are not all up';
    default:
      return b.raw;
  }
}

/* The Flash dialog's palette, verbatim. */
const SHEET = `
.aw{ position: relative; color: #0B0E14; font-family: var(--sans); }

.aw-title{
  position: relative; margin: 0; max-width: 11ch;
  font-family: var(--mono); font-size: 30px; font-weight: 500;
  letter-spacing: -0.02em; line-height: 1.05; color: #0B0E14;
}
.aw-body{ position: relative; margin: 14px 0 0; max-width: 44ch; font-size: 14px; line-height: 1.55; color: #3E4A47; }
.aw-small{ font-size: 12.5px; color: #8A9591; max-width: 52ch; }

/* THE ONE PANEL. Every figure in the sans at tabular-nums: the mono's
   slashed zero made a balance read like a stack trace. */
.aw-panel{ position: relative; margin-top: 22px; background: #E8ECEA; border-radius: 6px; padding: 16px 18px; }
.aw-row{ display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.aw-row + .aw-row{ margin-top: 11px; }
.aw-k{ font-size: 12.5px; color: #8A9591; }
.aw-val{ font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.012em; color: #0B0E14; }
.aw-val.is-good{ color: #134E4A; }
.aw-val.is-warn{ color: #B4482E; }
.aw-val em{ font-style: normal; font-weight: 500; color: #8A9591; }
.aw-bars{ display: flex; gap: 6px; margin: 10px 0 12px; }
.aw-bars span{ flex: 1; height: 6px; border-radius: 2px; background: #CBD3D0; }
.aw-bars .is-on{ background: #134E4A; }
.aw-panel-note{ margin: 0 0 12px; font-size: 12px; line-height: 1.5; color: #8A9591; }

/* The address is the mechanism, so it is the one monospaced thing. */
.aw-addr{
  position: relative; display: flex; align-items: center; gap: 10px; margin-top: 18px;
  padding: 8px 8px 8px 12px; border-radius: 6px; background: #E8ECEA;
}
.aw-addr code{
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mono); font-size: 12px; color: #0B0E14;
}
.aw-addr button{
  flex: none; border: 0; border-radius: 5px; padding: 6px 11px; cursor: pointer;
  background: #0B0E14; color: #FFFFFF; font-family: var(--sans); font-size: 11.5px; font-weight: 500;
}
.aw-addr button:disabled{ opacity: .45; cursor: default; }

.aw-foot{ position: relative; display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 24px; }
.aw-cta{
  border: 0; border-radius: 6px; padding: 9px 18px; cursor: pointer;
  background: #0B0E14; color: #FFFFFF; font-family: var(--sans); font-size: 13px; font-weight: 500; line-height: 1.2;
}
.aw-cta:disabled{ background: #CBD3D0; color: #8A9591; cursor: not-allowed; }
.aw-ghost{
  border: 1px solid #CBD3D0; border-radius: 6px; padding: 8px 14px; cursor: pointer;
  background: transparent; color: #3E4A47; font-family: var(--sans); font-size: 13px; font-weight: 500;
}
.aw-link{
  border: 0; background: none; padding: 0; cursor: pointer;
  font-family: var(--sans); font-size: 12.5px; color: #3E4A47; text-decoration: underline;
}
.aw-link:disabled{ color: #8A9591; cursor: not-allowed; text-decoration: none; }

/* The create arm reuses these, so its own classes ride the same look. */
.aw-lead{ position: relative; margin: 0; font-family: var(--mono); font-size: 30px; font-weight: 500; letter-spacing: -0.02em; line-height: 1.05; color: #0B0E14; max-width: 12ch; }
.aw-note{ position: relative; margin: 12px 0 0; font-size: 12.5px; line-height: 1.55; color: #8A9591; max-width: 52ch; }
.aw-say{ position: relative; }
.aw-act{ position: relative; display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
.aw-go{
  border: 0; border-radius: 6px; padding: 9px 18px; cursor: pointer;
  background: #0B0E14; color: #FFFFFF; font-family: var(--sans); font-size: 13px; font-weight: 500;
}
.aw-go:disabled{ background: #CBD3D0; color: #8A9591; cursor: not-allowed; }

@media (max-width: 560px){
  .aw-title, .aw-lead{ font-size: 24px; max-width: none; }
  .aw-foot{ flex-direction: column-reverse; align-items: stretch; gap: 12px; }
  .aw-foot .aw-cta, .aw-foot .aw-ghost{ width: 100%; }
  .aw-foot .aw-link{ text-align: center; }
}
`;
