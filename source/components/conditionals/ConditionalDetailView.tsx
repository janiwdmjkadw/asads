'use client';

/**
 * THE DETAIL (design-29, round-17 P5-A2 "Full Robinhood") — a tabbed,
 * activity-first page.
 *
 * WHAT THIS REPLACES, AND WHY. The shipped detail was one 458px ribbon:
 * identity strip · journey rail · card · what-has-fired · versions ·
 * controls, each in its own titled box. Six boxes, six hairlines and a
 * five-slot ruler stacked above the one object the page is actually
 * about. P5-A2 takes the boxes off and lets TYPE and SPACE do the
 * separating:
 *
 *  - the plan's OWN SENTENCE is the title (serif 26px, two lines);
 *  - ONE status line under it, and the state is a WORD, not a chip —
 *    mint watching, amber paused, grey ended, at the token's own size;
 *  - three underline tabs over one body: Activity · Transactions ·
 *    Workflow, Activity first, because "what has it done" is the
 *    question the page is opened to answer;
 *  - every wallet-moving figure leaves its sentence and stands in one
 *    right-aligned 15.5px mono column, inked `--up`/`--down`;
 *  - EXACTLY ONE HAIRLINE in the body — under the tab bar, where the
 *    header genuinely ends. The card keeps its own, because the card is
 *    its own object and the one place a state CHIP still belongs.
 *
 * THE CARD IS NOT RE-IMPLEMENTED HERE, and is untouched at 458px in the
 * Workflow tab. `ProposalCardV2` draws the plan from the server's own
 * canonical envelope, exactly as the chat does, so the thing a user
 * approved and the thing they come back to read are the same drawing. Two
 * joins make that work and both are stated where they happen: the envelope
 * comes from the PROPOSAL route (the conditional detail serves the
 * rendered `view` but not `canonical_payload`), and the footer's "Open live
 * page" link is suppressed — this IS the live page.
 *
 * THE MEASURE IS THE CONTAINER. Every step inside is a `@container`
 * min-width off the page's own column, not off the viewport, so the detail
 * holds from 360 to 1440 by measuring what it is actually in.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ProposalCardV2 } from '@/components/agent/proposal/v2/ProposalCardV2';
import { buildCardModel } from '@/components/agent/proposal/v2/card-model';
import { TOK_PLATE } from '@/components/agent/proposal/v2/card-classes';
import { TokenDisc } from '@/components/agent/proposal/v2/marks';
import { tradeHref } from '@/lib/agent/mint-links';
import { shortAddress } from '@/components/agent/proposal/v2/row-model';
import { livePhase } from '@/components/agent/proposal/v2/phase';
import type {
  ConditionalDetail,
  ConditionalStateResponse,
  ConditionalSummary,
  ProposalDetail,
} from '@/lib/conditionals';
import { ActivityFeed } from './ActivityFeed';
import { ClassifierCandidatesPanel } from './ClassifierCandidatesPanel';
import { judgeStat } from './classifier-model';
import { syncHold, syncHoldAtMs } from './sync-model';
import { EDIT_ENTRY, EDIT_LINE, CANCEL_DONE, detailControls, type MutationFeedback } from './controls';
import { identityStrip, lineageNodes } from './detail-model';
import { activityFeed, transactionGroups } from './event-feed';
import { conditionalPnl, firingEconomics, formatBpsPct, formatSol } from './pnl';
import { GuidanceNotice } from './GuidanceNotice';
import type { Guidance, GuidanceActionKind } from './guidance';
import { lifeFraction, zoneLabel, type ClockContext } from './ledger-model';
import { conditionalLineage } from './lineage';
import { playLine, qualifierPhrase } from './play-line';
import { NotificationBellToggle } from './NotificationBellToggle';
import { PlanActions } from './PlanActions';
import { PositionsList } from './PositionsList';
import { positionRows, positionsPnl } from './positions-model';
import { proofLines } from './proofs-model';
import type { ProofLine } from './proofs-model';
import { TransactionsTab } from './TransactionsTab';
import { hasEnded, stateTone, stateWord } from './views';
import { SolMark } from '@/components/agent/proposal/v2/marks';
import { CONDITIONALS_PALETTE } from './palette';

// ───────────────────────── the tabs ─────────────────────────

type TabKey = 'activity' | 'transactions' | 'workflow' | 'judge';

interface Tab {
  readonly key: TabKey;
  readonly label: string;
}

const TABS: readonly Tab[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'workflow', label: 'Workflow' },
];

/** The fourth tab exists only for a plan with a semantic judge behind it. */
const JUDGE_TAB: Tab = { key: 'judge', label: 'Judge' };

/* The same tab as the ledger's: 13px, negative tracking, a 1px rule. */
const TAB_BTN =
  'relative flex-none whitespace-nowrap border-0 bg-transparent px-[1px] pb-[13px] pt-[13px] ' +
  'text-[13px] font-medium leading-none tracking-[-.006em] transition-colors duration-[.14s] ' +
  'ease-[var(--ease)] cursor-pointer';

/**
 * The selected tab is ink-0 over a 2px ink-0 rule, and the rule SLIDES —
 * one element translated on a 180ms transform, never a fade and never a
 * per-tab underline that pops. No colour is spent: on this page colour
 * means STATE, and navigation never takes accent.
 */
function TabBar({
  tabs,
  tab,
  onSelect,
  zone,
}: {
  readonly tabs: readonly Tab[];
  readonly tab: TabKey;
  readonly onSelect: (key: TabKey) => void;
  readonly zone: string;
}): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState<{ readonly x: number; readonly w: number } | null>(null);

  // `useEffect`, not `useLayoutEffect`: this page is client-only (the gate
  // loads it with `ssr: false`), and the layout hook warns on any server
  // render. The rule below carries no transition until it has been
  // measured once, so there is no slide in from zero to pay for it.
  useEffect(() => {
    const node = list.current;
    if (node === null) return undefined;
    const measure = () => {
      const selected = node.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (selected === null) return;
      setRail({ x: selected.offsetLeft, w: selected.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [tab]);

  return (
    <div className="mt-[26px] border-b border-[rgba(11,14,20,.08)]" data-testid="cd-tabwrap">
      <div
        ref={list}
        className="relative flex items-center gap-[18px] @[430.02px]:gap-[30px]"
        role="tablist"
        aria-label="This conditional"
        data-testid="cd-tabs"
      >
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            id={`cd-tab-${entry.key}`}
            aria-selected={tab === entry.key}
            aria-controls={`cd-panel-${entry.key}`}
            className={`${TAB_BTN} ${
              tab === entry.key
                ? 'text-[var(--ink-0)]'
                : 'text-[var(--ink-2)] hover:text-[var(--ink-1)]'
            }`}
            data-tab={entry.key}
            data-testid={`cd-tab-${entry.key}`}
            onClick={() => onSelect(entry.key)}
          >
            {entry.label}
          </button>
        ))}
        {/* The zone is stated once per page, and it is the FIRST thing to
            go when the bar runs out of room: three tab words are the bar's
            job, and the record's own stamps carry the zone inline. */}
        {zone === '' ? null : (
          <span className="ml-auto hidden flex-none whitespace-nowrap text-[11.5px] text-[var(--ink-3)] @[430.02px]:inline">
            times in {zone}
          </span>
        )}
        <span
          aria-hidden
          className={`pointer-events-none absolute bottom-[-1px] left-0 h-px bg-[var(--ink-0)] motion-reduce:transition-none ${
            rail === null ? '' : 'transition-[transform,width] ease-[var(--ease)]'
          }`}
          data-testid="cd-tab-rail"
          // The 180ms is inline because Tailwind's `transition-[…]` ships
          // its own 150ms and a `duration-` utility does not reliably
          // outrank it in the emitted sheet — measured, not assumed
          // (`conditionals-page-sweep` asserts the computed duration).
          // Reduced motion still wins: `transition-none` zeroes the
          // PROPERTY, which no duration can bring back.
          style={
            rail === null
              ? { width: 0 }
              : {
                  width: `${rail.w}px`,
                  transform: `translateX(${rail.x}px)`,
                  transitionDuration: '180ms',
                }
          }
        />
      </div>
    </div>
  );
}

// ───────────────────────── small pieces ─────────────────────────

const META = 'flex-none whitespace-nowrap text-[13px] leading-[1.3] text-[var(--ink-2)]';
/* Tabular figures in the page's own family. The mono face made every
   number on the status line a second typeface arguing with the words
   around it, and this page is the only one on the site that did that. */
const META_FIG = 'text-[1em] font-semibold tabular-nums tracking-[-.014em] text-[var(--ink-0)]';
const NOTE = 'mt-[11px] max-w-[68ch] text-[12.5px] leading-[1.55] text-[var(--ink-2)]';

/** Every digit in a served phrase reads as a figure, so every one is mono. */
function Figures({ text }: { readonly text: string }): ReactElement {
  return (
    <>
      {text.split(/(\d+)/).map((part, index) =>
        /^\d+$/.test(part) ? (
          <b key={`${index}-${part}`} className={META_FIG}>
            {part}
          </b>
        ) : (
          <span key={`${index}-${part}`}>{part}</span>
        ),
      )}
    </>
  );
}

const DOT = (
  <span className="flex-none text-[13px] leading-none text-[var(--ink-2)]" aria-hidden>
    ·
  </span>
);

/*
 * ON THIS PAGE COLOUR IS MONEY, and nothing else. State used to take the
 * flame for watching and the hold amber for paused, which put two more
 * hues on a page whose green and red are supposed to be the only signal
 * in the room. It is a word, in ink, exactly as it is on the ledger.
 */
const STATE_INK: Readonly<Record<string, string>> = {
  watch: 'text-[var(--ink-0)]',
  hold: 'text-[var(--ink-0)]',
  past: 'text-[var(--ink-2)]',
};

// ───────────────────────── the page ─────────────────────────

export interface ConditionalDetailViewProps {
  readonly detail: ConditionalDetail;
  /** The lifecycle read. `null`/`undefined` while it loads or degrades. */
  readonly live?: ConditionalStateResponse | null | undefined;
  /**
   * The proposal that authorizes the current revision. `undefined` while it
   * loads, `null` when it could not be read — the page renders either way,
   * because everything but the card is on the conditional's own routes.
   */
  readonly proposal?: ProposalDetail | null | undefined;
  /** The ledger row, for the two facts only the list serves. */
  readonly summary?: ConditionalSummary | null | undefined;
  readonly ctx: ClockContext;
  readonly notices?: readonly Guidance[];
  readonly busy?: boolean;
  readonly feedback?: MutationFeedback | null | undefined;
  readonly onCancel: () => void;
  readonly onResume: () => void;
  readonly onRequestModification?: (() => void) | undefined;
  /**
   * Fires after the header bell settles a write. Absent in the static render
   * tests, which is also what keeps the bell out of their markup — the
   * control is an ACTION, and this view renders actions only when the
   * container supplies a handler.
   */
  readonly onNotificationModeChanged?: (() => void) | undefined;
  readonly onGuidanceAction?: ((action: GuidanceActionKind) => void) | undefined;
}

export function ConditionalDetailView({
  detail,
  live,
  proposal,
  summary,
  ctx,
  notices = [],
  busy = false,
  feedback,
  onCancel,
  onResume,
  onRequestModification,
  onNotificationModeChanged,
  onGuidanceAction,
}: ConditionalDetailViewProps): ReactElement {
  const [tab, setTab] = useState<TabKey>('activity');

  // The judge's block rides the polling `/state` read; the list row's
  // tally stands in for the spend figure until that lands.
  const classifier = live?.classifier;
  const judged = classifier !== undefined && classifier.available;
  const judge = judgeStat(judged ? classifier.summary : summary?.classifier);
  const tabs = judged ? [...TABS, JUDGE_TAB] : TABS;
  const shownTab: TabKey = tab === 'judge' && !judged ? 'activity' : tab;

  // The FRESHEST reading wins: `/state` polls at 5s and the detail at 10s,
  // so a plan that just paused says so here first.
  const state = live?.effective_state ?? live?.state ?? detail.effective_state ?? detail.state;
  // WORDS follow the server's DISPLAY state (a spent-but-armed plan reads
  // "Done"); AFFORDANCES follow the stored one, because the state machine
  // is what decides whether a cancel will be accepted.
  const storedState = live?.state ?? detail.state;
  const legs = live?.legs ?? detail.legs;
  const firings = live?.firings ?? detail.firings;
  const events = live?.events ?? [];

  // ABSENT IS NOT ZERO on the list's count — but the detail serves the
  // firings themselves, so a distinct-occurrence count off THOSE is a fact
  // and not a guess, and it is the better number when both exist.
  const occurrences = new Set(firings.map((firing) => firing.occurrence_seq)).size;
  const firedCount = occurrences > 0 ? occurrences : summary?.fired_count;
  const createdAt = summary?.created_at ?? null;

  const identity = identityStrip(detail, firedCount, ctx);
  const lineage = conditionalLineage(detail, events, firings);
  const versions = lineageNodes(
    detail.version,
    createdAt,
    lineage.edits.map((edit) => edit.at),
    ctx,
  );
  // The polling state response carries `pause` too; the detail query does not
  // refetch, so a pause landing while the page is open must come from `live`.
  const pause = live?.pause ?? detail.pause;
  const controls = detailControls({ state: storedState, pause, lineage });
  // The evaluator's version vs the one you edited (CONTRACT-3 §B.2): the
  // polling read serves it; absent or unreachable says nothing.
  const hold = syncHold(live?.sync);
  const holdAtMs = syncHoldAtMs(events) ?? ctx.nowMs;

  const feedInput = {
    state,
    createdAt,
    events,
    firings,
    legs,
    qualifier: detail.qualifier,
    firedCount,
    pause,
    ...(live?.fill_times === undefined ? {} : { fillTimes: live.fill_times }),
    ...(live?.execution_events === undefined ? {} : { executionEvents: live.execution_events }),
    ...(hold === null ? {} : { syncHold: { lead: hold.lead, atMs: holdAtMs } }),
  };
  const activity = activityFeed(feedInput, ctx);
  const transactions = transactionGroups(feedInput, ctx);
  // Realized economics off the engine's fills — entry/exit per firing and
  // the conditional's net, on the SAME swap-notional basis the stop-loss
  // math uses, so the page and the evaluator can never disagree.
  const economics = firingEconomics(firings, live?.fill_times);
  // The positions read model (api `buildPositions`) is the authority when
  // the server serves it: one entry per position, exits joined server-side
  // by the exec plane's own keys, and external sells counted. An older api
  // omits it, and the strip falls back to the firing-based rollup.
  const positions = live?.positions ?? [];
  const positionList = positionRows(positions, ctx);
  const pnl = positionsPnl(positions) ?? conditionalPnl(economics);
  // Proofs (api `buildProofs`): firing id → lines. Positions key theirs by
  // the ENTRY firing; transaction rows by the firing's operation id.
  const proofsByFiring = new Map<string, readonly ProofLine[]>();
  for (const [firingId, proofs] of Object.entries(live?.proofs ?? {})) {
    proofsByFiring.set(firingId, proofLines(firingId, proofs));
  }
  const entryFiringByPosition = new Map(positions.map((position) => [position.position_id, position.entry.firing_id]));
  const proofsForPosition = (key: string): readonly ProofLine[] =>
    proofsByFiring.get(entryFiringByPosition.get(key) ?? '') ?? [];
  const proofsByOperation = new Map<string, readonly ProofLine[]>();
  for (const firing of firings) {
    const lines = proofsByFiring.get(firing.id);
    if (lines !== undefined && lines.length > 0) proofsByOperation.set(firing.operation_id, lines);
  }

  /**
   * THE TICKER IS THE SERVER'S. The read routes resolve the one mint a plan
   * provably names and pair it with `tokens.tokens`' own symbol, so the
   * page neither re-derives identity nor reaches into a token store — which
   * it must not do anyway (04-frontend.md invariant 4: this surface
   * subscribes to no feed). Handing the same resolver to the card makes the
   * header above and every row inside it name the token identically.
   */
  const wireToken = detail.token ?? summary?.token ?? null;
  const symbol = wireToken?.symbol ?? null;
  const symbolOf =
    wireToken === null || symbol === null
      ? undefined
      : (mintOf: string) => (mintOf === wireToken.mint ? symbol : undefined);

  const cardModel =
    proposal === undefined || proposal === null
      ? null
      : buildCardModel(proposal, {
          viewerTz: ctx.timeZone,
          nowMs: ctx.nowMs,
          ...(symbolOf === undefined ? {} : { symbolOf }),
          ...(wireToken === null ? {} : { fallbackMint: wireToken.mint }),
        });
  const cardToken = cardModel?.legs.find((leg) => leg.action?.token != null)?.action?.token ?? null;
  const mint = wireToken?.mint ?? cardToken?.mint ?? null;
  // Rule 6: identity at symbol length. The ticker when one is known, the
  // mint as 4…4 when the catalog has none, "any token" when the server's
  // own sentence names that universe, and NOTHING when neither.
  const scope =
    symbol !== null
      ? symbol
      : wireToken !== null
        ? shortAddress(wireToken.mint)
        : cardToken !== null
          ? cardToken.symbol
          : summary != null && playLine(summary).plate?.variant === 'any_token'
            ? 'any token'
            : null;

  const { phase } = livePhase(state);
  /*
   * THE TITLE IS THE PLAY, NOT THE TYPING.
   *
   * It led with `source_text`, which is the raw thing you said to the
   * chat — lowercase, unpunctuated, "every time bonk dumps 15% in an
   * hour put 2 sol in, stop friday" — set at 26px as the page's heading.
   * The rendered summary is the same plan written properly and is what
   * the ledger row you clicked was showing. What you typed is kept, one
   * step down, under `said`.
   */
  const rendered = (detail.view?.summary ?? '').trim();
  const wireSummary = typeof (detail as { summary?: unknown }).summary === 'string'
    ? ((detail as { summary?: string }).summary ?? '').trim()
    : '';
  const typed = (detail.source_text ?? '').trim();
  const title =
    rendered !== '' ? rendered : wireSummary !== '' ? wireSummary : typed !== '' ? typed : qualifierPhrase(detail.qualifier);
  const said = typed !== '' && typed !== title ? typed : null;

  const expiresMs = Date.parse(detail.expires_at ?? '');
  const expiryVerb = Number.isFinite(expiresMs) && ctx.nowMs >= expiresMs ? 'expired' : 'expires';
  const ended = hasEnded(state);
  /* The same lifetime the ledger row draws, from the same helper, so the
     two screens can never disagree about how far along a plan is. */
  const life = lifeFraction(detail as unknown as Parameters<typeof lifeFraction>[0], ctx);
  const settled = feedback?.kind === 'done' && feedback.action === 'cancel';
  const zone = zoneLabel(ctx);

  const openWallet = useCallback(() => onGuidanceAction?.('open_wallet_setup'), [onGuidanceAction]);

  /**
   * THE ONE QUIET LINE under the status line, and at most one of it: what a
   * landed cancel means, or the server's own refusal to edit in words, or —
   * when nothing on this page can open the chat — the sentence that says
   * where to go instead of a button that goes nowhere.
   */
  const note: ReactElement | null = settled ? (
    <p className={`${NOTE} text-[var(--ink-1)]`} data-testid="cd-cancel-done">
      {CANCEL_DONE}
    </p>
  ) : !ended && !controls.canEdit && controls.editReason !== '' ? (
    <p className={NOTE} data-testid="cd-edit-off">
      Editing is off, {controls.editReason}.
    </p>
  ) : !ended && controls.canEdit && onRequestModification === undefined ? (
    // NO HANDLER, SO NO BUTTON. Nothing on this page opens the chat yet,
    // and a control that cannot run is worse than a sentence that tells you
    // where to go — the surface's own rule for unwired guidance actions.
    <p className={NOTE} data-testid="cd-edit-line">
      <b className="font-medium text-[var(--ink-1)]">{EDIT_ENTRY}</b>
      {'. '}
      {EDIT_LINE}
    </p>
  ) : null;

  return (
    <article className="@container flex min-w-0 flex-col" data-testid="conditional-detail">
      {/* The page's palette. It lives in `palette.ts` because this
          surface renders in three places and only one of them mounts
          the ledger's sheet — the detail page is its own route, and
          without this it read the terminal's black tokens. */}
      <style>{CONDITIONALS_PALETTE}</style>
      <header className="flex min-w-0 flex-col" data-testid="cd-header">
        {/* Narrow first: the actions sit UNDER the title on a phone. Beside
            it they took a fixed 200px out of a 375px screen and the play
            came down the page one or two words at a time. */}
        <div className="flex flex-col items-start gap-[16px] @[430.02px]:flex-row @[430.02px]:gap-[26px]">
          <h2
            className="m-0 min-w-0 text-[26px] font-semibold leading-[1.24] tracking-[-.024em] text-[var(--ink-0)] [overflow-wrap:anywhere]"
            data-testid="cd-title"
            title={title}
          >
            {title}
          </h2>
          <div className="flex flex-none items-start gap-[8px] @[430.02px]:ml-auto">
            {/* The plan's OWN bell, on by default (no row = follow your
                settings). Sits with the other things you can do about this
                plan, because that is what it is. */}
            {onNotificationModeChanged === undefined ? null : (
              <div className="pt-[6px]">
                <NotificationBellToggle
                  conditionalId={detail.conditional_id}
                  mode={detail.notification_mode}
                  onChanged={onNotificationModeChanged}
                />
              </div>
            )}
            <PlanActions
              controls={controls}
              busy={busy}
              settled={settled}
              onCancel={onCancel}
              onResume={onResume}
              {...(onRequestModification === undefined ? {} : { onRequestModification })}
              {...(onGuidanceAction === undefined ? {} : { onFund: openWallet })}
            />
          </div>
        </div>

        {/* ONE STATUS LINE, four facts, and the state is a WORD. The r6
            chip was a bounded object standing where a word would do. */}
        <div
          className="mt-[15px] flex flex-wrap items-center gap-x-[9px] gap-y-[7px]"
          data-testid="cd-status"
        >
          {scope === null ? null : mint === null ? (
            <span
              className="inline-flex flex-none items-center whitespace-nowrap text-[14.5px] font-semibold tracking-[-.008em] text-[var(--ink-0)]"
              data-testid="cd-token"
            >
              <TokenDisc mint={mint} className={`${TOK_PLATE} mr-[7px] h-[17px] w-[17px]`} />
              {scope}
            </span>
          ) : (
            // The token IS a destination: the header identity links to its
            // trade page, same as every per-firing chip below.
            <Link
              href={tradeHref(mint)}
              className="inline-flex flex-none items-center whitespace-nowrap text-[14.5px] font-semibold tracking-[-.008em] text-[var(--ink-0)] transition-colors hover:text-[var(--acc-0,#2a5fd0)]"
              data-testid="cd-token"
              title={mint}
              prefetch={false}
            >
              <TokenDisc mint={mint} className={`${TOK_PLATE} mr-[7px] h-[17px] w-[17px]`} />
              {scope}
            </Link>
          )}
          {scope === null ? null : DOT}
          <span
            className={`flex-none whitespace-nowrap text-[14.5px] font-semibold tracking-[-.004em] ${
              STATE_INK[stateTone(state)] ?? 'text-[var(--ink-2)]'
            }`}
            data-testid="cd-state"
            data-tone={stateTone(state)}
          >
            {stateWord(state)}
          </span>
          {hold === null ? null : (
            // The edit the evaluator has not taken yet: a WORD in the
            // asking tone, and the versions on hover — same register as
            // the state beside it, never a chip.
            <>
              {DOT}
              <span
                className="flex-none whitespace-nowrap text-[14.5px] font-semibold tracking-[-.004em] text-[var(--ink-0)]"
                data-testid="cd-sync"
                data-tone="hold"
                title={hold.title}
              >
                {hold.word}
              </span>
            </>
          )}
          {identity.expiry === '' ? null : (
            <>
              {DOT}
              <span className={META} data-testid="cd-expiry">
                {expiryVerb} <b className={META_FIG}>{identity.expiry}</b>
              </span>
            </>
          )}
          {identity.runs === '' ? null : (
            <>
              {DOT}
              <span className={META} data-testid="cd-runs">
                <Figures text={identity.runs} />
              </span>
            </>
          )}
          {judge === null ? null : (
            // The judge's running spend, as a fifth fact on the one line:
            // a money figure, so mono and tabular like every other.
            <>
              {DOT}
              <span className={META} data-testid="cd-judge-spend" title={judge.phrase}>
                judge <b className={META_FIG}>{judge.figure}</b>
              </span>
            </>
          )}
        </div>

        {said === null ? null : (
          // What you actually typed, kept and demoted.
          <p className="mt-[11px] max-w-[68ch] text-[12.5px] leading-[1.55] text-[var(--ink-3)]" data-testid="cd-said">
            You said: {said}
          </p>
        )}

        {note}

        {notices.length === 0 && feedback?.kind !== 'failed' ? null : (
          <div className="mt-[14px] flex flex-col gap-[10px]">
            {notices.map((guidance) => (
              <GuidanceNotice
                key={guidance.kind}
                guidance={guidance}
                {...(onGuidanceAction === undefined ? {} : { onAction: onGuidanceAction })}
              />
            ))}
            {feedback?.kind === 'failed' ? (
              <GuidanceNotice
                guidance={feedback.guidance}
                {...(onGuidanceAction === undefined ? {} : { onAction: onGuidanceAction })}
              />
            ) : null}
          </div>
        )}
      </header>

      {/*
       * THE TRACK, the same one the ledger row draws: solid to now,
       * hollow for the time this plan has left. It is the one drawing
       * both screens share, so the row you clicked and the page you land
       * on read as the same object rather than two designs of it.
       */}
      {life === null ? null : (
        <div className="mt-[20px]" data-testid="cd-track">
          <div className="relative h-[3px] rounded-[2px] bg-[rgba(11,14,20,.08)]">
            <span
              className={`absolute inset-y-0 left-0 rounded-[2px] ${ended ? 'bg-[var(--ink-3)]' : 'bg-[var(--ink-2)]'}`}
              style={{ width: `${(life * 100).toFixed(2)}%` }}
            />
            {ended ? null : (
              <span
                className="absolute -top-[2.5px] -ml-[4px] h-[8px] w-[8px] rounded-full bg-[var(--ink-0)] outline outline-[3px] outline-black"
                style={{ left: `${(life * 100).toFixed(2)}%` }}
              />
            )}
          </div>
        </div>
      )}

      {pnl === null ? null : (
        <div
          className="mt-[18px] flex flex-wrap items-baseline gap-x-[22px] gap-y-[6px] text-[12.5px] leading-[1.4] text-[var(--ink-3)]"
          data-testid="cd-pnl"
        >
          {/* The net leads and it is the only colour: spent and received
              are the working, and the working does not shout. */}
          <span className="flex items-baseline gap-[7px]">
            Net
            <b
              className={`inline-flex items-baseline text-[16px] font-semibold tabular-nums tracking-[-.018em] ${
                pnl.netLamports >= 0n ? 'text-[var(--up)]' : 'text-[var(--down)]'
              }`}
              data-testid="cd-pnl-net"
            >
              {formatSol(pnl.netLamports, { sign: true })}
              <SolMark className="pcv2-sol mx-[3px] inline-block h-[.6em] w-[.6em] flex-none self-center" />
              {pnl.netBps === null ? '' : <em className="not-italic font-medium opacity-70">{formatBpsPct(pnl.netBps)}</em>}
            </b>
          </span>
          <span>
            Spent <b className="font-semibold tabular-nums text-[var(--ink-1)]">{formatSol(pnl.spentLamports)}</b>
            <SolMark className="pcv2-sol mx-[3px] inline-block h-[.72em] w-[.72em]" />
          </span>
          <span>
            Received <b className="font-semibold tabular-nums text-[var(--ink-1)]">{formatSol(pnl.receivedLamports)}</b>
            <SolMark className="pcv2-sol mx-[3px] inline-block h-[.72em] w-[.72em]" />
          </span>
          {pnl.roundTrip ? null : (
            <span>
              {pnl.openCount !== undefined && pnl.positionCount !== undefined && pnl.positionCount > 1
                ? `${pnl.openCount} of ${pnl.positionCount} positions open`
                : 'Position open'}
            </span>
          )}
        </div>
      )}

      <PositionsList rows={positionList} proofsFor={proofsForPosition} />

      <TabBar tabs={tabs} tab={shownTab} onSelect={setTab} zone={zone} />

      <div
        role="tabpanel"
        id={`cd-panel-${shownTab}`}
        aria-labelledby={`cd-tab-${shownTab}`}
        className="flex min-w-0 flex-col"
      >
        {shownTab === 'activity' ? <ActivityFeed groups={activity} /> : null}
        {shownTab === 'judge' ? (
          <section className="mt-[22px] flex min-w-0 flex-col" data-testid="cd-judge-tab">
            <ClassifierCandidatesPanel block={classifier} summary={summary?.classifier} ctx={ctx} />
          </section>
        ) : null}
        {shownTab === 'transactions' ? (
          <TransactionsTab groups={transactions} mint={mint} zone={zone} economics={economics} proofs={proofsByOperation} />
        ) : null}
        {shownTab === 'workflow' ? (
          <section className="mt-[28px] flex flex-col items-center" data-testid="cd-workflow">
            {proposal === undefined ? (
              <p className="text-[12.5px] text-[var(--ink-2)]" data-testid="cd-card-pending">
                Loading the plan…
              </p>
            ) : proposal === null ? (
              <p
                className="max-w-[458px] text-[12.5px] leading-[1.55] text-[var(--ink-2)]"
                data-testid="cd-card-missing"
              >
                The plan this authorizes could not be read just now. Everything in Activity is the
                conditional&rsquo;s own record and still the authority for what runs.
              </p>
            ) : (
              <ProposalCardV2
                detail={proposal}
                nowMs={ctx.nowMs}
                viewerTz={ctx.timeZone}
                phase={phase}
                suppressPlanLink
                {...(symbolOf === undefined ? {} : { symbolOf })}
                {...(mint === null ? {} : { mint })}
                // Always the page's OWN word, never the server's: it is what
                // the `unknown` phase prints in the chip and what a settled
                // card titles itself with, and design-29 does not let a raw
                // state reach the DOM on either.
                stateLabel={stateWord(state)}
                // NOT `pauseReason`, deliberately: the Activity feed says why
                // in the page's own typography, on the row where it happened.
                conditionalSummary={{
                  legStates: [...legs].sort((a, b) => a.leg_no - b.leg_no).map((leg) => leg.state),
                  expiresAtMs: expiresMs,
                  conditionalId: detail.conditional_id,
                }}
              />
            )}

            {/* The whole of what the Versions box was: one quiet line. */}
            <p
              className="mt-[15px] w-full max-w-[458px] text-[12px] leading-[1.55] text-[var(--ink-2)]"
              data-testid="cd-versions"
            >
              Version <b className={META_FIG}>{versions.length}</b>
              {versions[versions.length - 1]?.at === '' ? null : (
                <>
                  {', approved '}
                  <b className={META_FIG}>{versions[versions.length - 1]?.at}</b>
                </>
              )}
              {versions.length === 1 ? (
                ', the original authorization.'
              ) : (
                <>
                  {', it replaced '}
                  <b className={META_FIG}>{versions.length - 1}</b>
                  {versions.length === 2 ? ' earlier version' : ' earlier versions'}
                  {'.'}
                </>
              )}
            </p>
          </section>
        ) : null}
      </div>
    </article>
  );
}
