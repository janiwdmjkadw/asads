'use client';

/**
 * The agent-wallet setup nudge: ONE dismissible screen, "gate".
 *
 * Deliberately not the onboarding modal's sibling in behaviour. The
 * first-run wallet modal is a forced dialog because nothing works until
 * it is done; this one opens only from the navbar chip and closes on the
 * X, Esc, an outside click or its footer button. Everything it asks for
 * can be finished later, so nothing here traps the user.
 *
 * ── WHAT THIS REPLACED, AND WHY ──────────────────────────────────────
 *
 * An 896px dialog with a 64px glyph in a breathing radial glow, a
 * headline, a paragraph, and three bordered cards, each with a numbered
 * circle, a status chip and its own paragraph of explanation. Two of the
 * three could not be acted on at any given moment, and the screen spent
 * six hundred pixels of height saying so.
 *
 * That is a SaaS onboarding wizard. This product does not speak that
 * way: the board sets labels at 9.5px and 0.13em tracking over a
 * hairline, keeps figures tabular, and never explains what market cap
 * is either. The gate is a figure, three rows, and one button.
 *
 * ── THE DATA IS UNTOUCHED ────────────────────────────────────────────
 *
 * Every state still reads from ONE status query — the same key the
 * Portfolio panel and the navbar chip use — so the surfaces can never
 * disagree. Actions re-read that status from the server rather than
 * patching it locally, and `readiness.readyToTrade` is never recomputed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUsd, useSolPriceUsd } from '@/components/onboarding/DepositCard';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import './agent-setup-gate.css';
import {
  agentWalletSetupPreview,
  type AgentWalletSetupPreview,
} from '@/lib/auth/onboarding-status';
import { useAgentWalletSetup } from '@/lib/agent-wallet-setup-context';
import type { NonceSetupResult } from '@/lib/api/wallet-nonce-setup';
import { AGENT_WALLET_QUERY_KEY } from './AgentWalletPanel';
import {
  createAgentWallet,
  fetchAgentWalletStatus,
  grantAgentWalletDelegation,
  setupAgentWalletNonces,
} from './client';
import {
  agentWalletSetupPreviewStatus,
  deriveSetupView,
  type SetupCards,
  type SetupViewState,
} from './setup-state';
import type {
  AgentWalletGrantPayload,
  AgentWalletResult,
  AgentWalletStatusPayload,
} from './types';

/** Fast enough to watch a deposit land while the modal is on screen. */
const SETUP_REFETCH_MS = 5_000;
const COPIED_RESET_MS = 2_000;

/**
 * Mounted once in the shell. Nothing renders — and no status query runs —
 * until the chip opens it, so the closed case costs a context read.
 */
export function AgentWalletSetupModal(): React.ReactElement | null {
  const { open, closeAgentWalletSetup } = useAgentWalletSetup();
  if (!open) return null;
  return <AgentWalletSetupDialog onClose={closeAgentWalletSetup} />;
}

function AgentWalletSetupDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  // Dev-only: renders the whole surface from fixtures, with no network.
  const preview = agentWalletSetupPreview();
  /*
   * ── WALKING THE FLOW IN PREVIEW ──────────────────────────────────
   *
   * The env flag pins ONE fixture, which is enough to look at a state
   * and useless for judging the screen, because the thing being judged
   * is what happens when you press the button. So in preview the stage
   * is local state: the real actions advance it instead of calling a
   * server that is not there, and the strip at the foot jumps straight
   * to any of the three.
   *
   * Gated on `preview !== null`, which `agentWalletSetupPreview()`
   * already hard gates to non production — so none of this can reach a
   * real user, and the live path below is untouched.
   */
  const [previewStage, setPreviewStage] = useState<AgentWalletSetupPreview | null>(preview);
  const stage = previewStage ?? preview;
  const query = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: ({ signal }) => fetchAgentWalletStatus({ signal }),
    enabled: preview === null,
    // Polling stops the moment the server says the wallet is ready —
    // there is nothing left for this screen to watch for.
    refetchInterval: (q) => {
      const view = deriveSetupView(q.state.data ?? null);
      return view.kind === 'cards' && view.cards.ready ? false : SETUP_REFETCH_MS;
    },
    staleTime: 2_000,
  });

  const refetch = query.refetch;
  const status: AgentWalletResult<AgentWalletStatusPayload> | null =
    stage === null ? (query.data ?? null) : agentWalletSetupPreviewStatus(stage);

  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [noncePending, setNoncePending] = useState(false);
  const [nonceResult, setNonceResult] = useState<NonceSetupResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [grantPending, setGrantPending] = useState(false);
  const [grantResult, setGrantResult] =
    useState<AgentWalletResult<AgentWalletGrantPayload> | null>(null);
  // Creation is idempotent server-side, but firing it on every poll
  // while the wallet is still `null` would be a request storm.
  const createFired = useRef(false);

  const runCreate = useCallback(() => {
    createFired.current = true;
    setCreatePending(true);
    setCreateError(null);
    void createAgentWallet()
      .then((result) => {
        if (result.kind === 'reauth') {
          setCreateError('Sign in again to set up your agent wallet.');
        } else if (result.kind === 'error') {
          setCreateError(`Could not create the agent wallet (${result.errorCode}).`);
        }
        return refetch();
      })
      .finally(() => setCreatePending(false));
  }, [refetch]);

  const needsCreate =
    status !== null && status.kind === 'ok' && status.value.agentWallet === null;

  useEffect(() => {
    if (preview !== null || !needsCreate || createFired.current) return;
    runCreate();
  }, [preview, needsCreate, runCreate]);

  const onSetupTrading = useCallback(() => {
    if (stage !== null) {
      setPreviewStage('final');
      return;
    }
    setNoncePending(true);
    setNonceResult(null);
    void setupAgentWalletNonces()
      .then((result) => {
        setNonceResult(result);
        return refetch();
      })
      .finally(() => setNoncePending(false));
  }, [refetch, stage]);

  const onAuthorize = useCallback(() => {
    if (stage !== null) {
      setPreviewStage('ready');
      return;
    }
    setGrantPending(true);
    setGrantResult(null);
    void grantAgentWalletDelegation()
      .then((result) => {
        setGrantResult(result);
        return refetch();
      })
      .finally(() => setGrantPending(false));
  }, [refetch, stage]);

  const onRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const view = deriveSetupView(status);
  const solPriceUsd = useSolPriceUsd();
  const costSol = view.kind === 'cards' ? view.cards.setupCostSol : null;
  const costUsdText =
    costSol !== null && solPriceUsd !== null && Number.isFinite(Number(costSol))
      ? formatUsd(Number(costSol) * solPriceUsd)
      : null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-agent-gate=""
        /* `DialogContent` merges the shadcn defaults through `cn`, and
           tailwind-merge only drops them if their counterparts are
           passed here. The stylesheet repeats the same values with
           `!important` because the shipped shadow is an inline style,
           and inline beats any selector. */
        className="w-[380px] max-w-[calc(100vw-2rem)] gap-0 rounded-2xl border-0 p-0"
      >
        <DialogTitle className="sr-only">Set up your agent wallet</DialogTitle>
        <AgentWalletSetupBody
          view={view}
          costUsdText={costUsdText}
          createPending={createPending}
          createError={createError}
          onRetryCreate={runCreate}
          onRetry={onRetry}
          noncePending={noncePending}
          nonceResult={nonceResult}
          onSetupTrading={onSetupTrading}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          grantPending={grantPending}
          grantResult={grantResult}
          onAuthorize={onAuthorize}
          onFinish={onClose}
        />
        {stage === null ? null : (
          <PreviewStrip
            stage={stage}
            onPick={(next) => {
              setPreviewStage(next);
              // The acknowledgement is per visit, not per wallet, so
              // jumping states must not carry a tick backwards.
              setAcknowledged(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────── body (pure: props in, markup out) ─────────

export interface AgentWalletSetupBodyProps {
  readonly view: SetupViewState;
  /** Formatted USD for the setup cost, or `null` when no rate is known. */
  readonly costUsdText: string | null;
  readonly createPending: boolean;
  readonly createError: string | null;
  readonly onRetryCreate: () => void;
  readonly onRetry: () => void;
  readonly noncePending: boolean;
  readonly nonceResult: NonceSetupResult | null;
  readonly onSetupTrading: () => void;
  readonly acknowledged: boolean;
  readonly onAcknowledgedChange: (value: boolean) => void;
  readonly grantPending: boolean;
  readonly grantResult: AgentWalletResult<AgentWalletGrantPayload> | null;
  readonly onAuthorize: () => void;
  readonly onFinish: () => void;
}


/**
 * THE GATE.
 *
 * This screen answers two questions and only two: am I done, and what
 * does it cost. So the panel is a figure, a three segment rule and one
 * button, and everything that was ceremony is gone.
 *
 * ── THE HERO SLOT ────────────────────────────────────────────────────
 *
 * It shows the REMAINING COST while there is one, because that is the
 * thing a person hesitates over. When nothing is left to pay it switches
 * to a word, since a hero reading "0 SOL" answers a question nobody has.
 *
 * ── ONE ACTION AT A TIME ─────────────────────────────────────────────
 *
 * The old screen showed three cards at once, two of which you could not
 * act on. Here the button IS the next thing to do, and the segments say
 * how many are behind it. Nothing is hidden: the state of all three sits
 * on the rule, which is the same information the three cards were
 * spending six hundred pixels of height to carry.
 */
export function AgentWalletSetupBody(props: AgentWalletSetupBodyProps): React.ReactElement {
  const { view } = props;

  // Every arm that is not `cards` has nothing to gate on yet, so it gets
  // the same shape with the rule empty rather than a different screen.
  if (view.kind !== 'cards') {
    return (
      <GateShell
        label="Agent wallet"
        hero="Checking"
        heroIsWord
        met={[false, false, false]}
        note={nonCardNote(props)}
        action={nonCardAction(props)}
      />
    );
  }

  const { cards, wallet } = view;
  const funded = cards.deposit.kind === 'funded';
  const tradingDone = cards.trading.kind === 'done';
  const authorized = cards.authorize.kind === 'done';

  /*
   * NONCE ACCOUNTS ARE NOT ALWAYS A STEP. When the server does not list
   * the incomplete pool as a readiness blocker (`nonceOptional`), faster
   * lanes are an UPGRADE, and delegation unlocks without them — which is
   * exactly what `deriveSetupCards` already does by making `authorize`
   * active on `provisioned || nonceOptional`.
   *
   * So the progress rule counts the required steps and nothing else. A
   * segment for an optional upgrade would say you are two thirds done
   * when you are in fact finished, which is worse than saying nothing.
   */
  const required: readonly boolean[] = cards.nonceOptional
    ? [funded, authorized]
    : [funded, tradingDone, authorized];
  const metCount = required.filter(Boolean).length;

  /*
   * What is actually OWED to finish. An unfunded wallet owes its
   * shortfall; a funded one owes nonce rent only while the pool is a
   * requirement. `setupCostSol` reports the shortfall first and falls
   * back to the rent estimate, so the optional case has to stop reading
   * it or the panel bills you for an upgrade you never agreed to.
   */
  const costOwed = !funded
    ? cards.setupCostSol
    : !cards.nonceOptional && !tradingDone
      ? cards.setupCostSol
      : null;

  return (
    <GateShell
      label={cards.ready ? 'Setup complete' : 'To finish setup'}
      hero={costOwed === null ? (cards.ready ? 'Ready' : 'One step left') : `${costOwed} SOL`}
      heroIsWord={costOwed === null}
      met={required}
      sub={
        <>
          <span
            className="agx-cap is-lit"
            data-testid={metCount === required.length ? 'agent-setup-done-badge' : undefined}
          >
            {metCount} of {required.length} done
          </span>
          {costOwed !== null && props.costUsdText !== null ? (
            <span className="agx-cap" style={{ marginLeft: 'auto' }}>
              {props.costUsdText}
            </span>
          ) : null}
        </>
      }
      steps={
        <GateSteps
          cards={cards}
          noncePending={props.noncePending}
          onSetupTrading={props.onSetupTrading}
        />
      }
      note={cardsNote(props, funded)}
      action={<GateAction {...props} funded={funded} />}
      address={wallet.fundingAddress}
    />
  );
}

/**
 * The three steps, spelled out.
 *
 * The segment rule says how many are behind you; it cannot say WHICH,
 * and that is the first thing a person opening this screen wants. One
 * row each — mark, name, figure, state — which is the board's grammar
 * and costs 34px apiece, against the six hundred the three cards spent.
 */
function GateSteps({
  cards,
  noncePending,
  onSetupTrading,
}: {
  cards: SetupCards;
  noncePending: boolean;
  onSetupTrading: () => void;
}): React.ReactElement {
  const deposit = cards.deposit;
  const trading = cards.trading;
  const authorize = cards.authorize;
  const lanesOffer = cards.nonceOptional && trading.kind !== 'done';

  const rows: ReadonlyArray<{
    name: string;
    state: 'met' | 'open' | 'held';
    value: string;
    word: string;
    /** Optional rows carry their own action; the panel's one button is
        reserved for the thing that actually finishes setup. */
    run?: boolean;
  }> = [
    {
      name: 'Funding',
      state: deposit.kind === 'funded' ? 'met' : 'open',
      value:
        deposit.kind === 'funded' && deposit.balanceSol !== null
          ? `${deposit.balanceSol} SOL`
          : '—',
      word: deposit.kind === 'funded' ? 'Met' : 'Awaiting',
    },
    {
      name: 'Faster lanes',
      // An optional row is never `open`. Open means "this is what is
      // stopping you", and an upgrade never is.
      state: trading.kind === 'done' ? 'met' : lanesOffer ? 'held' : trading.kind === 'ready' ? 'open' : 'held',
      value:
        trading.kind === 'done'
          ? `${trading.activeCount} ready`
          : cards.setupCostSol === null
            ? '—'
            : `${cards.setupCostSol} SOL`,
      word: trading.kind === 'done'
        ? 'Met'
        : lanesOffer
          ? 'Optional'
          : trading.kind === 'ready'
            ? 'Ready'
            : 'Waiting',
      run: lanesOffer && trading.kind === 'ready',
    },
    {
      name: 'Delegation',
      state: authorize.kind === 'done' ? 'met' : authorize.kind === 'active' ? 'open' : 'held',
      // Born delegated but waiting on the steps above is not the same as
      // running, and the row says so rather than claiming it is on.
      value: authorize.kind === 'done' ? (authorize.inForce ? 'On' : 'Pending') : '—',
      word: authorize.kind === 'done' ? 'Granted' : authorize.kind === 'active' ? 'Ready' : 'Held',
    },
  ];

  return (
    <div className="agx-steps">
      {rows.map((r) => (
        <div key={r.name} className={`agx-step is-${r.state}`}>
          <span className={`agx-mark is-${r.state}`} aria-hidden />
          <span className="agx-step-name">{r.name}</span>
          {r.run === true ? (
            <button
              type="button"
              onClick={onSetupTrading}
              disabled={noncePending}
              className="agx-run"
            >
              {noncePending ? 'Setting up' : 'Set up'}
            </button>
          ) : null}
          <span className="agx-step-val agx-num">{r.value}</span>
          <span className="agx-step-state">{r.word}</span>
        </div>
      ))}
    </div>
  );
}

/* ── shell ───────────────────────────────────────────────────────────── */

function GateShell({
  label,
  hero,
  heroIsWord = false,
  met,
  sub,
  steps,
  note,
  action,
  address,
}: {
  label: string;
  hero: string;
  heroIsWord?: boolean;
  met: readonly boolean[];
  sub?: React.ReactNode;
  steps?: React.ReactNode;
  note?: React.ReactNode;
  action: React.ReactNode;
  address?: string;
}): React.ReactElement {
  return (
    <>
      <div className="agx-head">
        <span className="agx-cap">{label}</span>
        <div className={heroIsWord ? 'agx-fig is-word' : 'agx-fig'}>{hero}</div>
        <div className="agx-seg" aria-hidden>
          {met.map((m, i) => (
            <span key={i} className={m ? 'is-met' : undefined} />
          ))}
        </div>
        {sub === undefined ? null : <div className="agx-line">{sub}</div>}
      </div>
      {steps === undefined ? null : steps}
      {note === undefined || note === null ? null : <div className="agx-pending">{note}</div>}
      <div className="agx-foot">
        {action}
        {address === undefined ? null : <AddressLine address={address} />}
      </div>
    </>
  );
}

/**
 * Short address plus copy. The QR lived on a card this panel no longer
 * has; the address is the thing you paste, and it is one line.
 */
function AddressLine({ address }: { address: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_RESET_MS);
      })
      .catch(() => setCopied(false));
  }, [address]);

  return (
    <div className="agx-addr">
      <code className="agx-key" style={{ flex: '1 1 auto', minWidth: 0 }}>
        {shortAddress(address)}
      </code>
      <button type="button" onClick={onCopy} className="agx-quiet">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-6)}`;
}

/* ── the one action ──────────────────────────────────────────────────── */

function GateAction(
  props: AgentWalletSetupBodyProps & { funded: boolean },
): React.ReactElement {
  const { view } = props;
  if (view.kind !== 'cards') {
    return <FinishButton onFinish={props.onFinish} label="Finish later" />;
  }
  const { cards } = view;

  if (cards.ready) {
    return <FinishButton onFinish={props.onFinish} label="Finish" />;
  }

  // Not funded: the next move is yours, in a wallet, off screen. The
  // panel does not offer a button that pretends to advance the flow —
  // it hands you the address below and keeps watching.
  if (!props.funded) {
    return <FinishButton onFinish={props.onFinish} label="Finish later" />;
  }

  /*
   * DELEGATION IS CHECKED BEFORE THE POOL. `authorize` goes active on
   * `provisioned || nonceOptional`, so when the lanes are an upgrade the
   * next real step is the grant — not a nonce setup the server never
   * asked for. Reading them the other way round put an optional upgrade
   * in front of the only step left.
   */
  if (cards.authorize.kind !== 'active') {
    return (
      <button
        type="button"
        onClick={props.onSetupTrading}
        disabled={props.noncePending}
        className="agx-btn"
      >
        {props.noncePending ? 'Setting up…' : 'Set up trading'}
      </button>
    );
  }

  // Delegation. The acknowledgement is a gate, not decoration, so it is
  // the one sentence that survives on this panel.
  return (
    <>
      <label className="agx-check">
        <input
          type="checkbox"
          data-testid="agent-setup-acknowledge"
          checked={props.acknowledged}
          onChange={(event) => props.onAcknowledgedChange(event.target.checked)}
        />
        The agent can trade this wallet until I revoke it. Never the main balance.
      </label>
      <button
        type="button"
        data-testid="agent-setup-authorize"
        onClick={props.onAuthorize}
        disabled={!props.acknowledged || props.grantPending}
        className="agx-btn"
      >
        {props.grantPending ? 'Authorizing…' : 'Authorize'}
      </button>
    </>
  );
}

function FinishButton({
  onFinish,
  label,
}: {
  onFinish: () => void;
  label: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="agent-wallet-setup-finish"
      onClick={onFinish}
      className="agx-btn"
    >
      {label}
    </button>
  );
}

/* ── notes: the only place this panel is allowed a sentence ──────────── */

function nonCardNote(props: AgentWalletSetupBodyProps): React.ReactNode {
  const { view } = props;
  switch (view.kind) {
    case 'loading':
      return <Pending>Checking your agent wallet…</Pending>;
    case 'creating':
      return props.createError === null ? (
        <Pending testId="agent-setup-creating">Creating your agent wallet…</Pending>
      ) : (
        <p className="agx-note" data-testid="agent-setup-create-error">
          {props.createError}
        </p>
      );
    case 'reauth':
      return (
        <p className="agx-note" data-testid="agent-setup-reauth">
          Sign in again to set up your agent wallet. Nothing has been changed.
        </p>
      );
    case 'error':
      return (
        <p className="agx-note" data-testid="agent-setup-error">
          {view.message}
        </p>
      );
    default:
      return null;
  }
}

function nonCardAction(props: AgentWalletSetupBodyProps): React.ReactNode {
  const { view } = props;
  if (view.kind === 'creating' && props.createError !== null) {
    return (
      <button
        type="button"
        onClick={props.onRetryCreate}
        disabled={props.createPending}
        className="agx-btn"
      >
        Try again
      </button>
    );
  }
  if (view.kind === 'error') {
    return (
      <button type="button" onClick={props.onRetry} className="agx-btn">
        Try again
      </button>
    );
  }
  return <FinishButton onFinish={props.onFinish} label="Finish later" />;
}

function cardsNote(props: AgentWalletSetupBodyProps, funded: boolean): React.ReactNode {
  if (!funded) {
    return <Pending>Watching the address for your deposit.</Pending>;
  }
  const outcome = nonceOutcome(props.nonceResult);
  if (outcome !== null) {
    return (
      <p className="agx-note" data-testid="agent-setup-nonce-note">
        {outcome}
      </p>
    );
  }
  const grant = props.grantResult;
  if (grant !== null && grant.kind !== 'ok') {
    return (
      <p className="agx-note" data-testid="agent-setup-grant-note">
        {grant.kind === 'reauth'
          ? 'Sign in again to confirm it is you, then re-authorize.'
          : grant.message}
      </p>
    );
  }
  return null;
}

/** Only the arms that leave the user with something to do get a line. */
function nonceOutcome(result: NonceSetupResult | null): string | null {
  if (result === null) return null;
  switch (result.kind) {
    case 'ok':
    case 'preflight':
      return null;
    case 'reauth':
      return 'Sign in again and retry. Nothing was changed.';
    case 'insufficient_balance':
      return 'Not enough SOL landed yet. Top the wallet up and try again.';
    case 'partial_failure':
      return `${result.created_count} created, ${result.failures.length} did not. Running setup again finishes only what is still missing.`;
    case 'wrong_state':
      return `Setup is not available in the current account state (${result.state}).`;
    case 'error':
      return `Setup did not finish (${result.errorCode}). Nothing was charged that did not land.`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

function Pending({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}): React.ReactElement {
  return (
    <span
      className="agx-note"
      style={{ display: 'flex', alignItems: 'center', gap: 9 }}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <span className="agx-spin" aria-hidden />
      {children}
    </span>
  );
}


/*
 * ── PREVIEW STRIP · DEV ONLY ─────────────────────────────────────────
 *
 * Rendered only when `agentWalletSetupPreview()` returned a mode, which
 * is hard gated to non production. It jumps between the three fixtures
 * so the whole flow can be walked without a chain, a backend, or a
 * server restart per state.
 *
 * Deliberately ugly. It is scaffolding, and scaffolding that looks like
 * part of the design is scaffolding somebody ships.
 */
function PreviewStrip({
  stage,
  onPick,
}: {
  stage: AgentWalletSetupPreview;
  onPick: (next: AgentWalletSetupPreview) => void;
}): React.ReactElement {
  const modes: ReadonlyArray<{ id: AgentWalletSetupPreview; label: string }> = [
    { id: 'unfunded', label: '1 · empty' },
    { id: 'final', label: '2 · funded' },
    { id: 'ready', label: '3 · done' },
  ];
  return (
    <div className="agx-preview">
      <span className="agx-preview-tag">Preview</span>
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onPick(m.id)}
          className={m.id === stage ? 'agx-preview-btn is-on' : 'agx-preview-btn'}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
