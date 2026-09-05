'use client';

/**
 * Inline proposal / authorization card — the approval surface.
 *
 * PURELY PRESENTATIONAL and typed to `ProposalCardModel`, which is
 * built from `ProposalDetail` alone. There is no prop through which a
 * chat-embedded payload could reach this component (04-frontend.md
 * invariant 1); the container fetches by id and hands the server's
 * record down.
 *
 * Every value renders as TEXT. Tool payloads and server-rendered view
 * text are data, never markup.
 *
 * Deliberately ABSENT: any classifier / semantic / enrichment /
 * article / link / vision affordance (those kinds are unimplemented),
 * and any `/internal/**` operator route.
 *
 * ANATOMY (owner directive, Aug 7 2026 — "extremely simplify it",
 * then "simple done nicely formatted"): a quiet `trade proposal` line
 * with the countdown → the STANZA → one protective line → one amber
 * max-risk chip → `details` → the state line → one full-width Approve
 * with a tiny `dismiss` beneath it. Nothing else is on the surface: no
 * phase pill, no label rails, no uppercase, no whole addresses.
 *
 * THE STANZA replaced the server's summary sentence, which in
 * production reads as machine soup (a 44-char mint, `2026-08-07 08:25
 * UTC`, a parenthetical of every limit). It is the same facts as
 * language:
 *
 *     when  price drops 5% below the 1h VWAP · starts in 2m
 *     →  buy  0.25 ◎  ◍ FLAP
 *
 * The condition is ALWAYS visible and labeled; a proposal whose only
 * trigger is a time gate reads `starts in 2m` rather than a stuttering
 * `when in 2m`. Timestamps are humanized at render (`in 2m`, or the
 * viewer's local `Aug 9, 8:25 AM` further out) — `UTC` and ISO never
 * reach the surface, and the server's original travels in `title`.
 *
 * The no-fact-dropped invariant did not go away, it MOVED: every
 * server fact lives on the surface OR inside `details`, never neither.
 * Details holds the summary sentence verbatim as its fine print, plus
 * the predicates, the trade line, the qualifier, the agent wallet,
 * every limit fact, the protective list, the notices and the lineage.
 * If neither a condition nor an action is mappable, the summary comes
 * BACK to the surface — the stanza never renders empty.
 */

import type { ReactNode } from 'react';
import { formatSolCompact, truncateMint } from '@/lib/format';
import { Solana } from '@/components/listen/icons/Icons';
import { ingestionTokenImageUrl } from '@/lib/api/ingestion';
import { useResolvedTokenImage } from '@/lib/token-image';
import type { ProposalDecision } from '@/lib/conditionals';
import { isKnownNoticeKind } from '@/lib/conditionals';
import type { DecisionPhase, ProposalLoadPhase } from './decision';
import { reauthReasonText } from './decision';
import { addressChunks, conditionStanza } from './stanza';
import type { ProposalCardModel, ProposalLeg, ProposalPhase } from './model';

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * The one ink that sits ON an accent fill (the approve gradient), where
 * neither `--ink-*` tier has contrast. Defined once; used only there.
 */
const ON_ACCENT = 'var(--accent-ink)';

/* The app's own face, not the mono. Every figure in the chat used
   to be set in the printout voice the rest of the terminal has
   dropped — the zero gives it away beside any other number on
   screen. `tabular-nums` rides along wherever a figure needs its
   columns to line up, which is what the mono was really for. */
const MONO = { fontFamily: 'var(--sans)', fontVariantNumeric: 'tabular-nums' } as const;

/*
 * Chat vocabulary (`--surface-*` / `--ink-*` / `--hairline*`), the same
 * tokens every other agent component uses.
 *
 * The OUTER BORDER is the one deliberate exception to the popup's
 * uniform `--hairline`: it stays on the emphasized `--hairline-2` tier,
 * because this is the only object in the window where a click spends
 * money (90-synthesis reconciliation 19).
 */
const FRAME = 'agent-proposal-card overflow-hidden rounded-[12px] border bg-[var(--surface-2)]';
const SHELL = `${FRAME} border-[var(--hairline-2)]`;
/** Skeleton / status carry their own padding; the card's rows carry theirs. */
const PANEL = `${SHELL} px-3 py-2.5 text-[12.5px]`;

/** The card's one quiet register: lowercase, `--ink-3`, no tracking. */
const QUIET = 'text-[11px] text-[var(--ink-3)]';
const PAD = 'px-3';

// ───────────────────────── the summary sentence ─────────────────────────

/**
 * Numeric runs inside the server's sentence, so `0.25 SOL` and `6` set
 * in mono among the prose.
 *
 * The capture group makes `String.split` alternate prose / value, so the
 * segments always re-concatenate to the ORIGINAL string — this restyles
 * the sentence, it never edits it. Everything still renders as text.
 */
const VALUE_RUN = /(\d[\d,.]*(?:\s?(?:%|SOL|×))?)(?!\w)/g;

export interface SummarySegment {
  readonly text: string;
  readonly mono: boolean;
}

export function summarySegments(summary: string): readonly SummarySegment[] {
  return summary
    .split(VALUE_RUN)
    .map((text, index) => ({ text, mono: index % 2 === 1 }))
    .filter((segment) => segment.text !== '');
}

/**
 * ANY server text, with base58 runs taken out of the reading line.
 *
 * A 44-char mint is not information anyone verifies by eye, it wraps
 * the card into a block nobody reads, and on the SURFACE the owner
 * wants none of it (Aug 7 2026) — so surface prose elides the run to
 * `…` and `details` keeps a truncated display form. Either way the full
 * value is in `title`, and the record is never abridged. Every string
 * this card renders from the server goes through here, so an address
 * cannot leak out of a predicate, a notice or the summary.
 */
function AddressSafe({ text, elide }: { text: string; elide: boolean }) {
  return (
    <>
      {addressChunks(text).map((chunk, index) =>
        chunk.address ? (
          <span key={index} title={chunk.text} data-testid="agent-proposal-address">
            {elide ? '…' : truncateMint(chunk.text)}
          </span>
        ) : (
          <span key={index}>{chunk.text}</span>
        ),
      )}
    </>
  );
}

/** Server text on the SURFACE: addresses elided entirely. */
function SurfaceText({ text }: { text: string }) {
  return <AddressSafe text={text} elide />;
}

/** Server text inside `details`: addresses truncated, full value in `title`. */
function SafeText({ text }: { text: string }) {
  return <AddressSafe text={text} elide={false} />;
}

/** The summary sentence: values in mono, addresses handled, prose untouched. */
function SummaryText({ text, elide = false }: { text: string; elide?: boolean }) {
  return (
    <>
      {addressChunks(text).map((chunk, index) =>
        chunk.address ? (
          <span key={index} title={chunk.text} data-testid="agent-proposal-address">
            {elide ? '…' : truncateMint(chunk.text)}
          </span>
        ) : (
          summarySegments(chunk.text).map((segment, segmentIndex) =>
            segment.mono ? (
              <span key={`${index}-${segmentIndex}`} className="tabular-nums" style={MONO}>
                {segment.text}
              </span>
            ) : (
              <span key={`${index}-${segmentIndex}`}>{segment.text}</span>
            ),
          )
        ),
      )}
    </>
  );
}

/**
 * A SOL amount as a BRAND MARK, never the word: the mono figure plus
 * the official Solana glyph (owner directive, Aug 7 2026). The glyph is
 * `aria-hidden`, so the `aria-label` carries the unit for a screen
 * reader — the amount is never heard as a bare number.
 *
 * Only amounts THIS card formats from a numeric model field go through
 * here. Server-rendered prose keeps its own words verbatim; rewriting
 * it would be editing a server fact.
 */
function SolAmount({ lamports, size, label }: { lamports: number; size: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-[3px] tabular-nums" style={MONO} aria-label={label}>
      {formatSolCompact(lamports / LAMPORTS_PER_SOL, '0')}
      <Solana style={{ width: size, height: size }} />
    </span>
  );
}

/** Spoken form of a SOL amount — the unit a screen reader still needs. */
function solLabel(lamports: number): string {
  return `${formatSolCompact(lamports / LAMPORTS_PER_SOL, '0')} SOL`;
}

// ───────────────────────── the stanza ─────────────────────────

/**
 * 14px token art beside the name. The image proxy needs nothing but the
 * mint, so it is the one source this card can reach without new server
 * payload; `useResolvedTokenImage` owns the failure ladder and the
 * letter square stands in the moment it bottoms out — same machinery
 * and same fallback as the agent's token card.
 */
function TokenArt({ mint, letter }: { mint: string; letter: string }) {
  const proxySrc = ingestionTokenImageUrl(mint);
  const image = useResolvedTokenImage(proxySrc, null, mint);
  const box = 'h-[14px] w-[14px] shrink-0 rounded-[4px] border border-[var(--hairline-2)]';
  if (proxySrc === null || image.isPlaceholder) {
    return (
      <span
        aria-hidden
        data-testid="agent-proposal-token-art-fallback"
        className={`${box} inline-flex items-center justify-center bg-[var(--flame-wash)] text-[9px] font-medium leading-none text-[var(--flame)]`}
        style={MONO}
      >
        {letter}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.src}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      onError={image.onError}
      onLoad={image.onLoad}
      data-testid="agent-proposal-token-art"
      className={`${box} block bg-[var(--surface-3)] object-cover`}
    />
  );
}

/**
 * The token as a MARK, never an address: the logo plus the symbol.
 *
 * NO CONTRACT ADDRESS REACHES THE SURFACE (owner directive, Aug 7
 * 2026) — not even truncated. When no source knows the symbol the mark
 * says the quiet word `token` and identity is left to `details`, which
 * is where the address lives.
 */
function TokenMark({ mint, name }: { mint: string | null; name: string | null }) {
  const label = name ?? 'token';
  return (
    <span
      className="inline-flex min-w-0 items-center gap-[4px]"
      {...(mint === null ? {} : { title: mint })}
      data-testid="agent-proposal-token"
      data-resolved={name === null ? 'false' : 'true'}
    >
      {/* No symbol means no initial — a `T` for the word `token` would
          read as a ticker the card does not actually know. */}
      {mint === null ? null : <TokenArt mint={mint} letter={name === null ? '' : name.slice(0, 1).toUpperCase()} />}
      <span
        className={`truncate text-[13px] ${name === null ? 'text-[var(--ink-3)]' : 'font-medium text-[var(--ink-0)]'}`}
      >
        {label}
      </span>
    </span>
  );
}

/** One `label: value` row — a leg is a two-row definition list. */
function StanzaRow({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <>
      <span className="shrink-0 pt-[1px] text-[10.5px] lowercase leading-snug text-[var(--ink-3)]">{label}</span>
      <div className="min-w-0 text-[12.5px] leading-snug text-[var(--ink-1)]" data-testid={testId}>
        {children}
      </div>
    </>
  );
}

/** Quiet rule between legs — the only thing that names a leg number. */
function LegDivider({ legNo }: { legNo: number }) {
  return (
    <div className="my-[7px] flex items-center gap-2" data-testid="agent-proposal-leg-divider">
      <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
      <span className="shrink-0 text-[10px] lowercase text-[var(--ink-3)]">leg {legNo}</span>
      <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
    </div>
  );
}

/**
 * ONE LEG: what it waits for, and what it does — two aligned rows.
 *
 * N-ARY IN BOTH DIRECTIONS (owner directive, Aug 7 2026): any number
 * of legs, any number of conditions each, and the leg's index changes
 * nothing about how it renders. Up to two conditions read as one line
 * joined with ` AND `; three or more stack under the label, because a
 * five-way conjunction on one line is a paragraph, not a condition.
 *
 * Renders nothing but text the SERVER produced; the transforms are
 * display-only (`./stanza`), and every value carries the original in
 * `title`. The leg's ARM text is not here on purpose: "arms on leg-1
 * settlement" is plumbing, and the divider already says the leg comes
 * after the one above it.
 */
/** Where a conjunction stops reading as a sentence and becomes a list. */
const CONDITIONS_STACK_AT = 3;

function Leg({ leg, nowMs, tokenSymbol }: { leg: ProposalLeg; nowMs: number; tokenSymbol: string | null }) {
  const stanza = conditionStanza(leg.conditions, nowMs);
  /*
   * Every condition of this leg as one list, so the row does not care
   * whether a given entry came from a predicate or from a time gate.
   */
  const conditions: readonly { key: string; title: string | null; node: ReactNode }[] = [
    ...stanza.when.map((line, index) => ({
      key: `when-${index}`,
      title: line.title,
      node: <SurfaceText text={line.text} />,
    })),
    ...(stanza.startText === null
      ? []
      : [
          {
            key: 'starts',
            title: stanza.startTitle,
            // A time gate qualifies the trigger; it is not a trigger.
            node: <span data-testid="agent-proposal-starts">starts {stanza.startText}</span>,
          },
        ]),
  ];
  const stacked = conditions.length >= CONDITIONS_STACK_AT;
  /** The action is worth setting as a trade only when it parses as one. */
  const rich = leg.side !== null && (leg.amountLamports !== null || leg.amount !== null);

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-[7px] gap-y-[3px]" data-testid="agent-proposal-leg">
      {conditions.length === 0 ? null : (
        <StanzaRow label="conditions:" testId="agent-proposal-conditions-row">
          <div className={stacked ? 'space-y-[2px]' : undefined} data-stacked={stacked ? 'true' : 'false'}>
            {conditions.map((condition, index) =>
              stacked ? (
                <div key={condition.key} {...(condition.title === null ? {} : { title: condition.title })}>
                  {condition.node}
                </div>
              ) : (
                <span key={condition.key} {...(condition.title === null ? {} : { title: condition.title })}>
                  {index === 0 ? null : ' AND '}
                  {condition.node}
                </span>
              ),
            )}
          </div>
        </StanzaRow>
      )}

      {!rich && leg.actionText === null ? null : (
        <StanzaRow label="then:" testId="agent-proposal-action">
          {rich ? (
            <span className="inline-flex min-w-0 flex-wrap items-baseline gap-[5px]">
              <span className="shrink-0 text-[13px] font-medium text-[var(--ink-0)]">{leg.side}</span>
              {leg.amountLamports !== null ? (
                <span className="shrink-0 text-[13px] text-[var(--ink-0)]">
                  <SolAmount lamports={leg.amountLamports} size={13} label={solLabel(leg.amountLamports)} />
                </span>
              ) : leg.amount === null ? null : (
                <span className="shrink-0 text-[13px] tabular-nums text-[var(--ink-0)]" style={MONO}>
                  <SurfaceText text={leg.amount} />
                </span>
              )}
              <TokenMark mint={leg.mint} name={tokenSymbol} />
            </span>
          ) : (
            <SurfaceText text={leg.actionText ?? ''} />
          )}
        </StanzaRow>
      )}
    </div>
  );
}

/** The card body: one section per leg, in the order the server gave them. */
function Stanza({ model, tokenSymbol }: { model: ProposalCardModel; tokenSymbol: string | null }) {
  return (
    <div className={`${PAD} pt-1`} data-testid="agent-proposal-stanza">
      {model.legs.map((leg, index) => (
        <div key={`${leg.legNo}-${index}`}>
          {index === 0 ? null : <LegDivider legNo={leg.legNo} />}
          <Leg leg={leg} nowMs={model.nowMs} tokenSymbol={tokenSymbol} />
        </div>
      ))}
    </div>
  );
}

/**
 * `3333…3333` for display. A `wallet_account_id` is an OPAQUE server id
 * with no display name on the model, and rendering it whole wraps the
 * subtext into a block nobody reads. This is truncation for display
 * only — the full value stays in `title`/`aria-label`, and the day the
 * model grows a human name for the wallet, that name wins over this.
 */
export function middleTruncate(value: string, head = 4, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

// ───────────────────────── state line ─────────────────────────

/**
 * The single line that carries state — settled, step-up, reauth,
 * refusal, or a phase the record reached without the user. One line,
 * never a stack, and it says what happened in plain words.
 */
function StateLine({
  tone,
  text,
  sub,
  action,
  testId,
  attrs,
}: {
  tone: 'up' | 'hold' | 'down' | 'off';
  text: string;
  sub?: ReactNode;
  action?: ReactNode;
  testId: string;
  attrs?: Record<string, string>;
}) {
  const color =
    tone === 'up' ? 'var(--up)' : tone === 'hold' ? 'var(--hold)' : tone === 'down' ? 'var(--down)' : 'var(--ink-3)';
  return (
    <div
      className={`border-t border-[var(--hairline)] ${PAD} py-1.5 text-[11.5px] leading-snug`}
      data-testid={testId}
      role="status"
      {...attrs}
    >
      <div style={tone === 'off' ? { color: 'var(--ink-2)' } : { color }}>{text}</div>
      {sub === undefined ? null : <div className="mt-[2px] text-[10.5px] text-[var(--ink-3)]">{sub}</div>}
      {action}
    </div>
  );
}

function LineAction({
  onClick,
  children,
  testId,
  attrs,
}: {
  onClick: () => void;
  children: ReactNode;
  testId: string;
  attrs?: Record<string, string>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1.5 rounded-[10px] border border-[var(--hairline-2)] px-2.5 py-1 text-[11px] text-[var(--ink-1)] hover:border-[var(--ink-3)]"
      data-testid={testId}
      {...attrs}
    >
      {children}
    </button>
  );
}

// ───────────────────────── loading / degraded ─────────────────────────

/**
 * Skeleton for the window between the `proposal_ref` part appearing and
 * the canonical record arriving — including while the act tool is still
 * streaming. Skeleton-first, never a blank gap.
 */
export function ProposalCardSkeleton({ minHeightPx }: { readonly minHeightPx?: number }) {
  return (
    <div
      className={PANEL}
      data-testid="agent-proposal-skeleton"
      aria-busy
      /* The caller may reserve the height of the card it is standing in
         for, so the swap at the end of the turn does not move the thread
         under the reader. */
      {...(minHeightPx === undefined ? {} : { style: { minHeight: minHeightPx } })}
    >
      <div className="h-3 w-28 animate-pulse rounded bg-[var(--surface-3)]" />
      <div className="mt-3 space-y-2">
        <div className="h-2.5 w-full animate-pulse rounded bg-[var(--surface-3)]" />
        <div className="h-2.5 w-4/5 animate-pulse rounded bg-[var(--surface-3)]" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-[var(--surface-3)]" />
      </div>
      <div className="mt-3 text-[11px] text-[var(--ink-3)]">loading the proposal…</div>
    </div>
  );
}

/**
 * Explicit terminal renderings for the non-`ready` load phases.
 * Invariant 5: a degraded state says what happened; it never hangs.
 */
export function ProposalCardStatus({
  phase,
  onRetry,
}: {
  phase: Exclude<ProposalLoadPhase, { kind: 'ready' } | { kind: 'loading' }>;
  onRetry?: () => void;
}) {
  const text =
    phase.kind === 'not_found'
      ? 'This proposal no longer exists.'
      : phase.kind === 'unavailable'
        ? 'Agent trade control is not enabled on this deployment.'
        : phase.message;
  return (
    <div className={PANEL} data-testid="agent-proposal-status" data-phase={phase.kind} role="status">
      <div className={QUIET}>proposal unavailable</div>
      <div className="mt-1 text-[12px] text-[var(--ink-1)]">{text}</div>
      {phase.kind === 'error' && phase.retryable && onRetry !== undefined ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[10px] border border-[var(--hairline-2)] px-2 py-1 text-[11px] text-[var(--ink-1)]"
        >
          retry
        </button>
      ) : null}
    </div>
  );
}

// ───────────────────────── the state line ─────────────────────────

function DecisionNotice({
  decision,
  approvedText,
  onRetryDecision,
  onRefreshAuthorization,
  onStepUp,
}: {
  decision: DecisionPhase;
  /** What "approved" means for THIS record — armed says more than done. */
  approvedText: string;
  onRetryDecision?: (value: ProposalDecision) => void;
  onRefreshAuthorization?: () => void;
  onStepUp?: () => void;
}) {
  if (decision.kind === 'idle' || decision.kind === 'submitting') return null;

  if (decision.kind === 'settled') {
    // `repeat: true` is the IDEMPOTENT REPLAY of an already-committed
    // decision (a double-click). It is a 200 and a success.
    const approved = decision.decision === 'approve';
    return (
      <StateLine
        tone={approved ? 'up' : 'off'}
        text={approved ? approvedText : 'Dismissed.'}
        {...(decision.repeat ? { sub: 'Already recorded — no second action was taken.' } : {})}
        testId="agent-proposal-settled"
        attrs={{ 'data-repeat': decision.repeat ? 'true' : 'false' }}
      />
    );
  }

  if (decision.kind === 'step_up') {
    return (
      <StateLine
        tone="hold"
        text="Verify your identity to approve this size."
        sub={
          decision.exposureLamports === null ? (
            decision.message
          ) : (
            <>
              Worst-case exposure{' '}
              <SolAmount
                lamports={decision.exposureLamports}
                size={11}
                label={solLabel(decision.exposureLamports)}
              />{' '}
              is above the step-up threshold. The proposal is still pending.
            </>
          )
        }
        {...(onStepUp === undefined
          ? {}
          : {
              action: (
                <LineAction onClick={onStepUp} testId="agent-proposal-stepup-action">
                  verify identity
                </LineAction>
              ),
            })}
        testId="agent-proposal-stepup"
      />
    );
  }

  if (decision.kind === 'reauth') {
    const { affordance } = decision;
    return (
      <StateLine
        tone="hold"
        text="Session expired — refresh, then approve again."
        sub={reauthReasonText(affordance.reason)}
        {...(onRefreshAuthorization === undefined
          ? {}
          : {
              action: (
                <LineAction
                  onClick={onRefreshAuthorization}
                  testId="agent-proposal-reauth-action"
                  attrs={{
                    'data-refresh-path': affordance.path,
                    'data-refresh-method': affordance.method,
                    'data-wallet-account-id': affordance.walletAccountId,
                  }}
                >
                  refresh session
                </LineAction>
              ),
            })}
        testId="agent-proposal-reauth"
        attrs={{ 'data-reason': affordance.reason }}
      />
    );
  }

  return (
    <StateLine
      tone="down"
      text={decision.message}
      {...(decision.retryable && onRetryDecision !== undefined
        ? {
            action: (
              <LineAction onClick={() => onRetryDecision(decision.decision)} testId="agent-proposal-retry-decision">
                try again
              </LineAction>
            ),
          }
        : {})}
      testId="agent-proposal-refused"
      attrs={{ 'data-code': decision.code }}
    />
  );
}

/** Plain sentence for a phase the record reached without the user. */
const PHASE_SENTENCE: Partial<Record<ProposalPhase, { tone: 'up' | 'off'; text: string }>> = {
  armed: { tone: 'up', text: 'Active — watching the price.' },
  authorized: { tone: 'up', text: 'Active — watching the price.' },
  declined: { tone: 'off', text: 'Dismissed.' },
  expired: { tone: 'off', text: 'Expired — the offer lapsed.' },
  superseded: { tone: 'off', text: 'Replaced by a newer proposal.' },
};

// ───────────────────── above the fold: terms + attention ─────────────────────

/**
 * The three facts a reader approved WITHOUT seeing while they lived in
 * `details` (F4, 2026-08-21 audit): how often it fires — "every time X"
 * silently compiling to once was the audit's first finding — for how
 * long, and at what slippage (a 25% platform default on a small buy is
 * not a footnote). One quiet line; the server's own wording.
 */
function Terms({ model }: { model: ProposalCardModel }) {
  const parts = [
    model.qualifier === null ? null : { key: 'fires', value: model.qualifier },
    model.lifetime === null ? null : { key: 'for', value: model.lifetime },
    model.slippage === null ? null : { key: 'slippage', value: model.slippage },
  ].filter((part): part is { key: string; value: string } => part !== null);
  if (parts.length === 0) return null;
  return (
    <p className={`${PAD} pt-1.5 text-[10.5px] leading-snug text-[var(--ink-2)]`} data-testid="agent-proposal-terms">
      {parts.map((part, index) => (
        <span key={part.key}>
          {index === 0 ? null : <span className="text-[var(--ink-3)]"> · </span>}
          {part.key} <Value>{part.value}</Value>
        </span>
      ))}
    </p>
  );
}

/**
 * What the compiler had to SAY about this plan, where the eye lands before
 * the button: the stored compile warnings (a stop the curve floor makes
 * unreachable, a cooldown raised to the floor) and the §7.3 clamp notices
 * (the number the user asked for was lowered). Both used to sit inside
 * `details`, which is exactly where a reader who is about to approve does
 * not look. Text only — the server composed every sentence.
 */
function Attention({ model }: { model: ProposalCardModel }) {
  const clamps = model.notices.filter((notice) => notice.kind === 'clamped_knob').map((notice) => notice.text);
  const lines = [...model.warnings, ...clamps];
  if (lines.length === 0) return null;
  return (
    <ul className={`${PAD} mt-1.5 space-y-[3px]`} data-testid="agent-proposal-attention" role="note">
      {lines.map((text, index) => (
        <li
          key={`${index}-${text}`}
          className="text-[10.5px] leading-snug"
          style={{ color: 'var(--hold)' }}
          data-source={index < model.warnings.length ? 'warning' : 'clamp'}
        >
          <SafeText text={text} />
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── the details drawer ─────────────────────────

function Fact({
  children,
  title,
  label,
  attrs,
}: {
  children: ReactNode;
  title?: string;
  label?: string;
  attrs?: Record<string, string>;
}) {
  return (
    <div className="text-[10.5px] leading-snug text-[var(--ink-2)]" title={title} aria-label={label} {...attrs}>
      {children}
    </div>
  );
}

function Value({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums text-[var(--ink-1)]" style={MONO}>
      {children}
    </span>
  );
}

/**
 * `details` — one lowercase word holding everything the surface does
 * not say. It is a plain `<details>`: no JS, and nothing is hidden from
 * a reader — or a screen reader — who walks the list.
 *
 * An unrecognised notice kind still carries `text` — render it, marked
 * `data-known="false"`.
 */
function Details({ model, summary }: { model: ProposalCardModel; summary: string | null }) {
  const tradeText = [model.action, model.amount, model.token === null ? null : `of ${model.token}`]
    .filter((part): part is string => part !== null)
    .join(' ');
  // slippage, lifetime and the qualifier moved to the surface (Terms).
  const limits = [model.maxExposure === null ? null : { key: 'max risk', value: model.maxExposure }].filter(
    (limit): limit is { key: string; value: string } => limit !== null,
  );
  // Clamp notices render above the fold (Attention); the rest stay here.
  const notices = model.notices.filter((notice) => notice.kind !== 'clamped_knob');

  const has =
    summary !== null ||
    model.predicates.length > 0 ||
    tradeText !== '' ||
    model.agentWallet !== null ||
    limits.length > 0 ||
    model.protective.length > 0 ||
    notices.length > 0 ||
    model.lineage !== null;
  if (!has) return null;

  return (
    <details className="border-t border-[var(--hairline)]" data-testid="agent-proposal-details">
      <summary
        className={`${PAD} cursor-pointer list-none py-1.5 ${QUIET} hover:text-[var(--ink-1)] [&::-webkit-details-marker]:hidden`}
      >
        details
      </summary>
      <div className={`${PAD} space-y-[3px] pb-2`}>
        {/*
         * The server's summary sentence, VERBATIM and first: the stanza
         * says the same facts as language, so the sentence stops
         * leading the card — but it is still the server's own rendering
         * and no reader loses it.
         */}
        {summary === null ? null : (
          <p className="text-[10.5px] leading-snug text-[var(--ink-2)]" data-testid="agent-proposal-summary">
            <SummaryText text={summary} />
          </p>
        )}
        {model.predicates.length === 0 ? null : (
          <ul className="space-y-[3px]" data-testid="agent-proposal-conditions">
            {model.predicates.map((text, index) => (
              <li key={`${index}-${text}`} className="text-[10.5px] leading-snug text-[var(--ink-1)]">
                <SafeText text={text} />
              </li>
            ))}
          </ul>
        )}
        {tradeText === '' ? null : (
          <Fact>
            <SafeText text={tradeText} />
          </Fact>
        )}
        {model.mint === null ? null : (
          <Fact title={model.mint} label={`token mint ${model.mint}`}>
            mint <Value>{truncateMint(model.mint)}</Value>
          </Fact>
        )}
        {model.agentWallet === null ? null : (
          <Fact title={model.agentWallet} label={`agent wallet ${model.agentWallet}`}>
            agent wallet <Value>{middleTruncate(model.agentWallet)}</Value>
          </Fact>
        )}
        {limits.map((limit) => (
          <Fact key={limit.key}>
            {limit.key} <Value>{limit.value}</Value>
          </Fact>
        ))}
        {model.protective.map((text, index) => (
          <Fact key={`protective-${index}-${text}`}>
            <SafeText text={text} />
          </Fact>
        ))}
        {notices.length === 0 ? null : (
          <ul className="space-y-[3px]" data-testid="agent-proposal-notices">
            {notices.map((notice, index) => (
              <li
                key={`${index}-${String(notice.kind)}`}
                className="text-[10.5px] leading-snug text-[var(--ink-2)]"
                data-known={isKnownNoticeKind(notice.kind) ? 'true' : 'false'}
              >
                <SafeText text={notice.text} />
              </li>
            ))}
          </ul>
        )}
        {model.lineage === null ? null : (
          <Fact attrs={{ 'data-testid': 'agent-proposal-lineage' }}>
            <SafeText text={model.lineage.text} />
          </Fact>
        )}
      </div>
    </details>
  );
}

// ───────────────────────── the card ─────────────────────────

export interface ProposalCardProps {
  /** Built from the SERVER's record. There is no payload prop. */
  readonly model: ProposalCardModel;
  readonly decision: DecisionPhase;
  readonly onDecide?: (value: ProposalDecision) => void;
  readonly onRefreshAuthorization?: () => void;
  readonly onStepUp?: () => void;
  /**
   * The token's ticker, when a source outside the record knows it (the
   * turn's own `get_token_state`, or the page context the window's
   * header chip uses). DISPLAY ONLY — it names the token, it can never
   * change what a click authorizes, and its absence just means the mark
   * says `token`. The proposal record itself carries no symbol yet.
   */
  readonly tokenSymbol?: string | null;
}

export function ProposalCard({
  model,
  decision,
  onDecide,
  onRefreshAuthorization,
  onStepUp,
  tokenSymbol = null,
}: ProposalCardProps) {
  const submitting = decision.kind === 'submitting';
  const controlsLive = model.canDecide && decision.kind !== 'settled';
  /** Terminal and unactionable — the card recedes rather than shouts. */
  const spent = model.phase === 'declined' || model.phase === 'expired' || model.phase === 'superseded';
  /** The decision is in the server's hands now; only one line may speak. */
  const decided = decision.kind !== 'idle' && decision.kind !== 'submitting';
  /** The server reported the authorization as live. */
  const live = model.phase === 'armed' || model.phase === 'authorized';

  /*
   * The countdown is the DECISION deadline, and it means nothing once
   * the decision is made — a ticking clock on an armed authorization
   * reads as "your order is about to lapse", which is not what
   * `expires_at` says. It shows while the offer stands, and while it
   * stands closed.
   */
  const countdown = model.phase === 'awaiting_approval' || model.phase === 'expired' ? model.countdown : null;
  /** The offer lapsed unacted — say so where the buttons would be. */
  const windowClosed =
    countdown?.expired === true && (model.phase === 'awaiting_approval' || model.phase === 'expired');

  const phaseSentence = decided || windowClosed ? undefined : PHASE_SENTENCE[model.phase];

  /*
   * Can the stanza speak? It needs a leg with a trigger or an action;
   * with neither (registry drift that left no view AND an unreadable
   * payload) the server's own sentence comes back to the surface
   * rather than a blank space. The two are exclusive — the summary
   * renders once, here or in `details`, never in both.
   */
  const stanzaSpeaks = model.legs.some(
    (leg) => leg.conditions.length > 0 || leg.actionText !== null || leg.side !== null,
  );
  const surfaceSummary = stanzaSpeaks ? null : model.summary;

  return (
    <section
      className={SHELL}
      style={{
        // Invariant 4: the card sits beside live charts and feeds; contain
        // its layout/paint so its own ticking cannot reach them.
        contain: 'layout paint',
      }}
      data-testid="agent-proposal-card"
      data-proposal-id={model.proposalId}
      data-kind={model.kind}
      data-phase={model.phase}
      data-state={model.state}
      aria-label="trade proposal"
    >
      <div className={`flex items-baseline gap-2 ${PAD} pt-2`}>
        <span className={QUIET}>trade proposal</span>
        {countdown === null ? null : (
          <time
            dateTime={countdown.expiresAt}
            className="ml-auto shrink-0 text-[11px] tabular-nums"
            style={{
              ...MONO,
              color: countdown.expired ? 'var(--ink-3)' : countdown.urgent ? 'var(--down)' : 'var(--hold)',
            }}
            data-testid="agent-proposal-countdown"
            data-expired={countdown.expired ? 'true' : 'false'}
            data-urgent={countdown.urgent ? 'true' : 'false'}
          >
            {countdown.expired ? '—' : countdown.text}
          </time>
        )}
      </div>

      {model.unknownState ? (
        <p className={`${PAD} pt-1 text-[11px] leading-snug text-[var(--ink-3)]`} data-testid="agent-proposal-unknown-state">
          This build does not recognise the state “<SurfaceText text={model.state} />”, so no actions are offered.
        </p>
      ) : null}

      {stanzaSpeaks ? <Stanza model={model} tokenSymbol={tokenSymbol} /> : null}

      {surfaceSummary === null ? null : (
        <p
          className={`${PAD} pt-1 text-[12.5px] leading-[1.45] ${spent ? 'text-[var(--ink-2)]' : 'text-[var(--ink-1)]'}`}
          data-testid="agent-proposal-summary"
        >
          <SummaryText text={surfaceSummary} elide />
        </p>
      )}

      {model.degradedView ? (
        <p className={`${PAD} pt-1 text-[11px] leading-snug text-[var(--ink-3)]`} data-testid="agent-proposal-degraded-view">
          The readable summary is missing; the facts are in details.
        </p>
      ) : null}

      {/*
       * NO STANDALONE PROTECTIVE LINE. Leg 2 IS the protection, and it
       * now renders as its own conditions/then pair above — a second
       * prose sentence saying the same thing read as a repeat. The
       * guardrail texts and the arming text stay in `details`.
       */}

      {/*
       * NO MAX-RISK CHIP, and no risk figure on the button (owner
       * directive, Aug 7 2026): with a high slippage cap the worst case
       * is an inflated number that does not inform the decision. The
       * server's own worst-case text stays verbatim inside `details`.
       */}

      <Terms model={model} />
      <Attention model={model} />

      <div className="mt-2">
        <Details model={model} summary={stanzaSpeaks ? model.summary : null} />
      </div>

      <DecisionNotice
        decision={decision}
        approvedText={live ? 'Approved — watching the price.' : 'Approved.'}
        onRetryDecision={onDecide}
        onRefreshAuthorization={onRefreshAuthorization}
        onStepUp={onStepUp}
      />

      {windowClosed ? (
        <StateLine tone="off" text="Expired — the offer lapsed." testId="agent-proposal-window-closed" />
      ) : null}

      {phaseSentence === undefined ? null : (
        <StateLine tone={phaseSentence.tone} text={phaseSentence.text} testId="agent-proposal-phase" />
      )}

      {controlsLive && onDecide !== undefined ? (
        <div className={`${PAD} border-t border-[var(--hairline)] pb-2 pt-2`}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onDecide('approve')}
            className="flex w-full items-center justify-center gap-1 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-medium disabled:opacity-50"
            style={{
              borderColor: 'var(--accent-primary)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
              color: ON_ACCENT,
            }}
            data-testid="agent-proposal-approve"
          >
            {submitting ? 'Submitting…' : 'Approve'}
          </button>
          <div className="mt-1 text-center">
            <button
              type="button"
              disabled={submitting}
              onClick={() => onDecide('decline')}
              /* Readable at REST, not only on hover — a dismissal the
                 user cannot find is not an offer (owner, Aug 7 2026). */
              className="px-2 py-[2px] text-[10px] text-[var(--ink-3)] hover:text-[var(--ink-1)] disabled:opacity-50"
              data-testid="agent-proposal-decline"
              aria-label="Decline this proposal"
            >
              dismiss
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
