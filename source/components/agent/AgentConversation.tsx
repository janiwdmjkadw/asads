'use client';

/**
 * Conversation thread on the AI Elements `Conversation` scroll stack
 * (use-stick-to-bottom): pinned-to-bottom while the viewer is there,
 * released on scroll-away, with a floating jump-to-latest affordance.
 *
 * Assistant turns render through the pure lib/agent/view.ts join —
 * tool results paired to their calls (running rows, soft-fail notes,
 * TokenStateCard, holders one-liner, generic tool chrome) interleaved
 * with Streamdown text and reasoning disclosures. Completed assistant
 * turns get a quiet PERSISTENT icon actions row (copy / retry) — hover
 * to reveal was rejected in the v3 pass: it hid the only recovery from
 * a bad turn. The streaming region stays `aria-live="polite"`.
 *
 * Timestamps are deliberately absent: `ChatTurnView` (frozen store)
 * carries no `created_at` — listMessages' MessageTurn doesn't either.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Copy, Retry } from '@/components/listen/icons/Icons';
import { ListenCreature, type ListenCreatureHandle } from '@/components/creature/ListenCreature';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import { streamParts } from '@/lib/agent/chat-core';
import { useTrackedWalletSync } from '@/lib/agent/useTrackedWalletSync';
import { useAgentChatStore, type HistoryFailure } from '@/lib/agent/chat-store';
import type { ParsedPart } from '@/lib/agent/contracts';
import {
  buildActivityGroup,
  buildTurnItems,
  turnPlainText,
  type TurnViewItem,
} from '@/lib/agent/view';
import { ConversationScrollContext, type ConversationScroll } from './conversationScroll';
import { AgentPartView } from './AgentParts';
import { collectLinkEntities, type LinkEntities } from '@/lib/agent/mint-links';
import { AgentActivityGroup } from './parts/AgentActivityGroup';
import { AgentSnake } from './parts/AgentSnake';
import { AgentToolView, hasExternalView, hasSorenResultView } from './parts/AgentToolView';
import { SorenGapRow, useGapPresence } from './soren/SorenGapRow';
import { SorenTokenHoverLayer } from './soren/TokenHoverCard';
import { subscribeComposerFocus } from './soren/composerFocus';
import { useReducedMotion } from './soren/reducedMotion';

function UserTurn({ parts }: { parts: ParsedPart[] }) {
  const soren = useSorenChat();
  return (
    <div className="flex justify-end pl-8">
      <div className={soren ? 'ag-soren-pill' : 'ag-bubble max-w-full px-3.5 py-2.5'}>
        {parts.map((p, i) =>
          p.known && p.part.type === 'text' ? (
            <div
              key={i}
              className={
                soren
                  ? 'whitespace-pre-wrap'
                  : 'whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--ink-0)]'
              }
            >
              {p.part.text}
            </div>
          ) : (
            <AgentPartView key={i} parsed={p} />
          ),
        )}
      </div>
    </div>
  );
}

/** Icon-only turn action — 20px hit target, 13px glyph (mock 20/A). */
const actionButton =
  'ag-action inline-flex h-[22px] w-[22px] items-center justify-center text-[var(--ink-3)] hover:text-[var(--ink-1)]';

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(getText()).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy this reply'}
      className={copied ? `${actionButton} text-[var(--up)] hover:text-[var(--up)]` : actionButton}
    >
      <Copy style={{ width: 13, height: 13 }} />
    </button>
  );
}

/**
 * §1.4.5: a result object sits UNDER Soren's sentence — the sentence is
 * its title. The stream delivers the tool result BEFORE the prose that
 * reads it, so under the skin each pane-eligible tool item is moved to
 * just after the first text part that follows it. Order between panes is
 * kept; a turn whose prose never arrives leaves the pane where it landed.
 */
function panesUnderSentences(rest: readonly TurnViewItem[]): TurnViewItem[] {
  const out: TurnViewItem[] = [];
  const pending: TurnViewItem[] = [];
  for (const item of rest) {
    if (item.kind === 'tool' && hasSorenResultView(item)) {
      pending.push(item);
      continue;
    }
    out.push(item);
    if (
      pending.length > 0 &&
      item.kind === 'part' &&
      item.parsed.known &&
      item.parsed.part.type === 'text'
    ) {
      out.push(...pending);
      pending.length = 0;
    }
  }
  // Prose never arrived (still streaming, or a text-less turn): the panes
  // keep their stream position at the tail rather than vanishing.
  out.push(...pending);
  return out;
}

function AssistantTurn({
  parts,
  streaming = false,
  onRetry,
  showActions = false,
  showRetry = false,
  movedOn = false,
  gapWhisper,
  linkEntities,
}: {
  parts: ParsedPart[];
  streaming?: boolean;
  onRetry: () => void;
  /** Quiet persistent actions row (completed turns only). */
  showActions?: boolean;
  /** Retry re-sends the LAST user turn — only offered on the final turn. */
  showRetry?: boolean;
  /** A later assistant turn exists — the L06 lists start folded (§1.4.5). */
  movedOn?: boolean;
  /**
   * Soren skin only: a connection state that owns the gap whisper outright
   * (`sending…`, `reconnecting…`), ahead of any tool verb or whimsy.
   */
  gapWhisper?: string;
  /** CONVERSATION-scoped link identity — see the parent's harvest. */
  linkEntities: LinkEntities;
}) {
  const soren = useSorenChat();
  // Reduced motion falls back to the classic path IN FULL — the shimmer
  // activity group is the spec's still alternative to the wait cycle, so
  // dropping the group here would leave that viewer with no signal at all.
  const reduced = useReducedMotion();
  const sorenTurn = soren && !reduced;
  const items = useMemo(() => buildTurnItems(parts), [parts]);
  // The turn's work is ONE object at the top of the turn — reasoning
  // first, then every tool (mock E). What is left renders below it in
  // order: the cards that own their payload, the answer prose, errors.
  const { group, rest } = useMemo(
    () => buildActivityGroup(items, { streaming, hasExternalView }),
    [items, streaming],
  );
  // Link context arrives CONVERSATION-scoped from the parent: the tool
  // that typed an address as a wallet usually ran turns before the prose
  // that names it again, and a turn-scoped harvest sent every cross-turn
  // mention to the /trade default (owner, 2026-08-24: the dev wallet's
  // dossier never opened on click).
  // The part still growing is the LAST part — a card may sit after it.
  const lastPartIndex = rest.reduce((last, item, i) => (item.kind === 'part' ? i : last), -1);
  // The gap row is up until the reply's first TEXT lands. Tools and
  // reasoning run BEHIND it — which is exactly why the whisper carries the
  // running tool's verb rather than a spinner (D7 · "03 THE VERB").
  const hasText = items.some(
    (item) => item.kind === 'part' && item.parsed.known && item.parsed.part.type === 'text',
  );
  const gap = useGapPresence(sorenTurn && streaming && !hasText);
  // Precedence: the connection state, then the running tool's truthful verb,
  // then a status part's own words (the §5.7 seam-4 producer), then null —
  // which hands the whisper to the whimsy cycle. The composed group.label is
  // deliberately NOT used here: its thinking…/writing…/working… tail would
  // starve the whimsy words.
  const gapVerb =
    gapWhisper ??
    (group === null
      ? null
      : group.runningToolName !== null
        ? group.label
        : group.statusLabel);
  if (items.length === 0 && !gap.mounted) return null;
  return (
    // Entrance motion is for ARRIVALS, not for history: animating every
    // turn on open would throw a wall of motion at someone who just
    // wanted to read, and would animate N elements to say nothing. Only
    // the in-flight turn rises in.
    // Soren's side is BARE — no bubble, no container, no rim: the reply is
    // simply the window's content at the full column width (§3.3).
    <div
      className={`flex flex-col gap-2 ${soren ? 'ag-soren-reply' : 'pr-4'} ${
        streaming ? 'ag-turn' : ''
      }`}
    >
      {/* Under Soren the activity group is GONE — while the turn runs the
          gap row is the only signal, and once the text lands nothing of the
          activity remains anywhere (§3.2, "no settled trace"). Flag-off and
          reduced motion keep the group exactly as it is. */}
      {group !== null && !sorenTurn ? (
        <AgentActivityGroup group={group} onRetry={showRetry ? onRetry : undefined} />
      ) : null}
      {(sorenTurn ? panesUnderSentences(rest) : rest).map((item, i) =>
        item.kind === 'tool' ? (
          hasExternalView(item) || (sorenTurn && hasSorenResultView(item)) ? (
            <AgentToolView
              key={`tool-${item.toolCallId}`}
              item={item}
              streaming={streaming}
              movedOn={movedOn}
            />
          ) : null
        ) : (
          <AgentPartView
            key={`part-${i}`}
            parsed={item.parsed}
            streaming={streaming && i === lastPartIndex}
            onRetry={onRetry}
            linkEntities={linkEntities}
          />
        ),
      )}
      {/* Last child, because that is where the first prose line lands: the
          row IS that line box, so the handoff costs zero shift. */}
      {gap.mounted ? <SorenGapRow verb={gapVerb} leaving={gap.leaving} /> : null}
      {showActions ? (
        <div className="mt-0.5 flex items-center gap-2.5">
          <CopyButton getText={() => turnPlainText(parts)} />
          {showRetry ? (
            <button
              type="button"
              onClick={onRetry}
              title="Retry"
              aria-label="Retry this turn"
              className={actionButton}
            >
              <Retry style={{ width: 13, height: 13 }} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The "agent is working" indicator — the one thing on screen while the
 * user waits, so it carries the signature: a breathing accent orb, the
 * label, and the snake running its wave alongside.
 *
 * It exists only while a run is in flight; nothing here animates once
 * the turn settles.
 */
function ActivityRow({ label }: { label: string }) {
  return (
    <div className="ag-turn flex items-center gap-2.5 text-[11px] text-[var(--ink-2)]">
      <span aria-hidden className="ag-orb" />
      <span>{label}</span>
      <AgentSnake />
    </div>
  );
}

/**
 * Openers, as CARDS rather than bare pills. Each one names a capability
 * and says what it will actually do, because the hardest moment in a
 * chat product is the empty one: a first-time viewer has no idea what
 * this agent can reach. The subtitle is the teaching, not decoration.
 */
interface Opener {
  prompt: string;
  title: string;
  sub: string;
  glyph: 'pulse' | 'ledger' | 'token';
}

const OPENERS: readonly Opener[] = [
  {
    prompt: "What's moving right now?",
    title: 'Market pulse',
    sub: 'live movers, volume, momentum',
    glyph: 'pulse',
  },
  {
    prompt: 'My PnL today',
    title: 'My PnL today',
    sub: 'realized and open, per position',
    glyph: 'ledger',
  },
];

const TRADE_OPENER: Opener = {
  prompt: 'Check this token',
  title: 'Check this token',
  sub: 'holders, flow, and the risks',
  glyph: 'token',
};

/** 12px line glyphs — one stroke weight, no fills, so the row of cards
 *  reads as one family rather than three borrowed icons. */
function OpenerGlyph({ glyph }: { glyph: Opener['glyph'] }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[13px] w-[13px]"
      aria-hidden
    >
      {glyph === 'pulse' ? <path d="M1 9h3l2.2-5.4L9 12.4l1.9-4.2L12.2 9H15" /> : null}
      {glyph === 'ledger' ? <path d="M2.5 13V7m5 6V3m5 10V9.5" /> : null}
      {glyph === 'token' ? (
        <>
          <circle cx="8" cy="8" r="5.6" />
          <path d="M8 5.2v5.6M6.2 6.6h3.6M6.2 9.4h3.6" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The greeter, Soren skin: he IS the empty window (§3.2.1) — centred at
 * `size={70}`, idle, wearing `curious` once on mount. No opener cards: the
 * redesigned empty state is the creature and the field, nothing else.
 *
 * He leans toward the field while you type (§3.2 step 2): the composer
 * publishes its focus over `soren/composerFocus.ts` — the two are siblings
 * under the window, with no prop path between them — and `listening` is
 * the state whose brain owns the lean. D7: no new CreatureState.
 */
function SorenGreeter() {
  const creature = useRef<ListenCreatureHandle | null>(null);
  const [listening, setListening] = useState(false);
  useEffect(() => subscribeComposerFocus(setListening), []);
  // The ⌘K arrival is the locked `assemble` (M8a): eight particles
  // converge into the owl in ≤360ms. Once, on mount; the engine makes it
  // a no-op under reduced motion, so no gate is needed here.
  useEffect(() => {
    creature.current?.playForm('assemble');
  }, []);
  useEffect(() => {
    if (listening) creature.current?.lookAt('input');
    else creature.current?.express('curious');
  }, [listening]);
  return (
    <div data-testid="agent-empty-state" className="flex flex-1 items-center justify-center">
      <ListenCreature
        ref={creature}
        size={70}
        state={listening ? 'listening' : 'idle'}
        /* #C2BCD2, not #DCD7E6. The pale lilac was a light FORM on a
           near black pane; over paper it is a grey smudge that reads as
           a spinner rather than as him. One step deeper is the same
           creature with an edge against white. */
        bodyColor="#C2BCD2"
        eyeColor="#0B0B0D"
        aria-label="Soren"
      />
    </div>
  );
}

function EmptyState() {
  const soren = useSorenChat();
  const send = useAgentChatStore((s) => s.send);
  const pathname = usePathname();
  const openers =
    pathname !== null && pathname.startsWith('/trade/')
      ? [TRADE_OPENER, ...OPENERS]
      : OPENERS;
  if (soren) return <SorenGreeter />;
  // Bottom-anchored just above the composer (20-conversation/mock-e):
  // the greeting meets the eye where the cursor already is.
  return (
    <div
      data-testid="agent-empty-state"
      className="flex flex-1 flex-col justify-end gap-3 px-1 py-2"
    >
      <div className="ag-hello flex items-start gap-2.5">
        <span aria-hidden className="ag-hello-mark mt-[4px]" />
        <p className="text-[13px] leading-[1.55] text-[var(--ink-1)]">
          Ask about this token, your positions, or the market.
          <span className="mt-0.5 block text-[12px] text-[var(--ink-3)]">
            The agent sees the page you are on.
          </span>
        </p>
      </div>
      <div className="ag-openers">
        {openers.map((opener) => (
          <button
            key={opener.prompt}
            type="button"
            onClick={() => void send(opener.prompt)}
            className="ag-opener"
          >
            <span className="ag-opener-glyph">
              <OpenerGlyph glyph={opener.glyph} />
            </span>
            <span className="min-w-0">
              <span className="ag-opener-title">{opener.title}</span>
              <span className="ag-opener-sub">{opener.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Names WHICH failure the history load hit — "(401 unauthorized)" — so a
 * report carries something actionable instead of one undifferentiated
 * string. Empty when the store has no typed detail; a 404 never reaches
 * here (the store self-heals it back to the empty state).
 */
function historyFailureSuffix(failure: HistoryFailure | null): string {
  if (failure === null) return '';
  return failure.status === null
    ? ` (${failure.code})`
    : ` (${failure.status} ${failure.code})`;
}

export function AgentConversation() {
  const soren = useSorenChat();
  const reduced = useReducedMotion();
  const sorenTurn = soren && !reduced;
  const history = useAgentChatStore((s) => s.history);
  const historyStatus = useAgentChatStore((s) => s.historyStatus);
  const historyError = useAgentChatStore((s) => s.historyError);
  const stream = useAgentChatStore((s) => s.stream);
  const connection = useAgentChatStore((s) => s.connection);
  const retryLastTurn = useAgentChatStore((s) => s.retryLastTurn);

  const streamingParts = useMemo(() => (stream === null ? [] : streamParts(stream)), [stream]);
  // Link identity is CONVERSATION knowledge, not turn knowledge: the tool
  // result that types an address (mint vs wallet, symbol → mint) usually
  // lands turns before the prose that mentions it again. Harvested over
  // every settled turn plus the in-flight one; ambiguity rules unchanged
  // (a symbol two mints claim is dropped — now judged across the whole
  // conversation, which is what the harvest's contract always said).
  const linkEntities = useMemo(() => {
    const all: ParsedPart[] = [];
    for (const turn of history) all.push(...turn.parts);
    all.push(...streamingParts);
    return collectLinkEntities(all);
  }, [history, streamingParts]);
  const retry = (): void => void retryLastTurn();
  const isEmpty =
    historyStatus !== 'loading' && history.length === 0 && streamingParts.length === 0;

  // An agent tracker write must show up in the tracker pane immediately —
  // the store otherwise re-reads the DB only on an account switch.
  useTrackedWalletSync(streamingParts);

  const lastAssistantKey = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === 'assistant') return history[i].key;
    }
    return null;
  }, [history]);

  /*
   * The scroll box, republished for the parts inside it (a proposal card
   * anchors its own top on a live reveal). The capabilities are functions
   * over a ref, so this object is stable for the life of the conversation
   * and still answers with the library's live state — and the library's
   * own context is never reached for directly, because its hook throws
   * outside a `<StickToBottom>` and these parts also render on pages that
   * have no conversation at all.
   */
  const stick = useRef<StickToBottomContext | null>(null);
  const scroll = useMemo<ConversationScroll>(
    () => ({
      scrollElement: () => stick.current?.scrollRef.current ?? null,
      isAtBottom: () => stick.current?.state.isAtBottom ?? false,
      release: () => stick.current?.stopScroll(),
    }),
    [],
  );

  return (
    <ConversationScrollContext.Provider value={scroll}>
      {/* The glimpse's single mount — the token tags publish hovers over
          the module bus and this layer draws the one card (§1.4.2). */}
      {soren ? <SorenTokenHoverLayer /> : null}
      <Conversation
        data-testid="agent-conversation"
        className="min-h-0 flex-1"
        initial="instant"
        resize="smooth"
        contextRef={stick}
      >
        <ConversationContent
          data-soren={soren ? 'true' : undefined}
          className={
            soren
              ? // 22px between turns, measured from the pill's bottom edge —
                // one gap, no separators (§3.2).
                `ag-soren-thread flex flex-col ${isEmpty ? 'min-h-full' : ''}`
              : `flex flex-col gap-4 px-3.5 py-4 ${isEmpty ? 'min-h-full' : ''}`
          }
        >
          {historyStatus === 'loading' ? (
            <div className="text-[12px] text-[var(--ink-3)]">Loading conversation…</div>
          ) : null}
          {historyStatus === 'error' ? (
            <div className="text-[12px] text-[var(--down)]">
              Could not load this conversation.{historyFailureSuffix(historyError)}
            </div>
          ) : null}
          {isEmpty ? <EmptyState /> : null}
          {history.map((turn) =>
            turn.role === 'user' ? (
              <UserTurn key={turn.key} parts={turn.parts} />
            ) : (
              <AssistantTurn
                key={turn.key}
                parts={turn.parts}
                onRetry={retry}
                showActions
                showRetry={turn.key === lastAssistantKey && stream === null}
                movedOn={turn.key !== lastAssistantKey || stream !== null}
                linkEntities={linkEntities}
              />
            ),
          )}
          {/* Streaming region: the in-flight assistant turn (aria-live polite). */}
          <div aria-live="polite" data-testid="agent-streaming-region">
            {stream !== null ? (
              <div className="flex flex-col gap-3">
                <AssistantTurn
                  parts={streamingParts}
                  streaming
                  onRetry={retry}
                  gapWhisper={connection === 'reconnecting' ? 'reconnecting…' : undefined}
                  linkEntities={linkEntities}
                />
                {streamingParts.length === 0 ? (
                  // Under Soren the turn's own gap row already carries this.
                  sorenTurn ? null : (
                    <ActivityRow
                      label={connection === 'reconnecting' ? 'reconnecting…' : 'agent is working…'}
                    />
                  )
                ) : connection === 'reconnecting' ? (
                  <div className="text-[11px] text-[var(--ink-3)]">reconnecting…</div>
                ) : null}
              </div>
            ) : connection === 'posting' ? (
              // Before the stream opens the reply has no parts at all, so the
              // gap row rides an empty turn — the same box, at the same y.
              sorenTurn ? (
                <AssistantTurn
                  parts={[]}
                  streaming
                  onRetry={retry}
                  gapWhisper="sending…"
                  linkEntities={linkEntities}
                />
              ) : (
                <ActivityRow label="sending…" />
              )
            ) : null}
          </div>
        </ConversationContent>
        <ConversationScrollButton
          aria-label="Jump to latest"
          className="ag-jump bottom-3 left-auto right-3 h-7 w-7 translate-x-0 rounded-full border-0 bg-transparent text-[var(--ink-1)] hover:bg-transparent hover:text-[var(--accent-primary)] dark:bg-transparent dark:hover:bg-transparent [&_svg]:size-3.5"
        />
      </Conversation>
    </ConversationScrollContext.Provider>
  );
}
