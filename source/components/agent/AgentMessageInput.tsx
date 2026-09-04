'use client';

/**
 * Message input — OWNED implementation, deliberately not the AI
 * Elements `PromptInput`: that component is a form/attachment/model-menu
 * system built around AI SDK `ChatStatus` semantics and its own
 * context-held textarea controller, which fights this store's
 * send/stop contract (one queued run per conversation, `connection`
 * phases, POST-failure retry with the SAME idempotency key) and the
 * frozen `forwardRef<HTMLTextAreaElement>` surface. The owned field is
 * ~sixty lines and matches the approved v3 mock: boxed field on the
 * window's base surface, accent-gradient send square, no hint row (the
 * shortcut legend was cut — it taught nothing after the first message).
 *
 * Enter submits, Shift+Enter breaks the line; the send button flips to
 * Stop while a run streams (cancelActiveRun); a POST-level failure
 * renders the inline retry row reusing the same idempotency key.
 *
 * `@`/`$` open the mention popover. While it is open the arrow keys, Enter
 * and Tab belong to it — Enter picks rather than sends, so a mention is never
 * one keystroke away from an accidental submit. Picking records a BINDING
 * (label → concrete id); on send, the bindings still present in the text ride
 * along in `client_context` so the agent starts the turn already knowing who
 * "@cupsey" is instead of spending a tool call resolving it.
 */

import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { ArrowUp } from '@/components/listen/icons/Icons';
import { useAgentChatStore } from '@/lib/agent/chat-store';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import { usePublishComposerFocus } from './soren/composerFocus';
import {
  applyMentionPick,
  bindingsPresentIn,
  detectMentionQuery,
  rankMentionCandidates,
  type MentionCandidate,
  type MentionQuery,
} from '@/lib/agent/mentions';
import { useMentionCandidates } from '@/lib/agent/useMentionCandidates';
import { MentionPopover } from './MentionPopover';

const MAX_FIELD_HEIGHT_PX = 120;
const MENTION_RESULT_LIMIT = 6;

/**
 * The glyph laid ON the accent gradient. Tracks the theme's derived
 * `--accent-ink` rather than a fixed near-black: the accent is NOT always
 * a light tint (midnight and blood are dark enough that near-black glyphs
 * disappear into them), so the ink is chosen per theme in `themes.ts`.
 */
const ON_ACCENT = 'var(--accent-ink)';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const AgentMessageInput = forwardRef<
  HTMLTextAreaElement,
  {
    clientContext?: unknown;
    placeholder?: string;
    /** The field gained or lost focus — Soren leans toward it (§3.2). */
    onFocusChange?: (focused: boolean) => void;
  }
>(function AgentMessageInput({ clientContext, placeholder, onFocusChange }, ref) {
  const soren = useSorenChat();
  const setComposerFocus = usePublishComposerFocus(onFocusChange);
  const [text, setText] = useState('');
  const connection = useAgentChatStore((s) => s.connection);
  const sendFailure = useAgentChatStore((s) => s.sendFailure);
  const send = useAgentChatStore((s) => s.send);
  const retrySend = useAgentChatStore((s) => s.retrySend);
  const cancelActiveRun = useAgentChatStore((s) => s.cancelActiveRun);

  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref !== null) ref.current = el;
    },
    [ref],
  );

  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Every binding picked this message. Filtered against the final text on
  // send, so a mention that was typed and then deleted never travels.
  const [picked, setPicked] = useState<MentionCandidate[]>([]);

  const allCandidates = useMentionCandidates(mentionQuery);
  const suggestions = useMemo(
    () =>
      mentionQuery === null
        ? []
        : rankMentionCandidates(allCandidates, mentionQuery, MENTION_RESULT_LIMIT),
    [allCandidates, mentionQuery],
  );
  const popoverOpen = suggestions.length > 0;

  const busy = connection !== 'idle';
  const streaming =
    connection === 'streaming' || connection === 'reconnecting' || connection === 'connecting';

  const autogrow = (): void => {
    const el = innerRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT_PX)}px`;
  };

  const syncMentionQuery = (value: string, caret: number): void => {
    const next = detectMentionQuery(value, caret);
    setMentionQuery(next);
    setActiveIndex(0);
  };

  const pick = (candidate: MentionCandidate): void => {
    if (mentionQuery === null) return;
    const next = applyMentionPick(text, mentionQuery, candidate);
    setText(next.text);
    setPicked((current) => [...current, candidate]);
    setMentionQuery(null);
    setActiveIndex(0);
    const el = innerRef.current;
    if (el !== null) {
      el.focus();
      // Caret placement must wait for the controlled value to land.
      window.requestAnimationFrame(() => {
        el.setSelectionRange(next.caret, next.caret);
        autogrow();
      });
    }
  };

  const submit = (): void => {
    if (busy) return;
    const value = text.trim();
    if (value.length === 0) return;
    const mentions = bindingsPresentIn(value, picked);
    const base = isRecord(clientContext) ? clientContext : {};
    // Under the soren skin the terminal draws list results as objects, and
    // the agent is told so per message — the prompt then asks for a reading
    // instead of a prose table (the duplicate-chart fix). Flag-off clients
    // never send it, so their model keeps writing the tables they rely on.
    const withUi = soren ? { ...base, ui_result_objects: true } : base;
    const context =
      mentions.length === 0
        ? soren
          ? withUi
          : clientContext
        : { ...withUi, mentions };
    setText('');
    setPicked([]);
    setMentionQuery(null);
    const el = innerRef.current;
    if (el !== null) el.style.height = 'auto';
    void send(value, context);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (popoverOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const candidate = suggestions[activeIndex];
        if (candidate !== undefined) {
          e.preventDefault();
          pick(candidate);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // No rule above the composer: the field's own frame is the separation
  // (v3). A border here reads as a doubled edge against the boxed field.
  return (
    <div
      data-testid="agent-composer"
      data-soren={soren ? 'true' : undefined}
      className={soren ? 'ag-soren-composer-wrap shrink-0' : 'shrink-0 px-3 pb-3 pt-2.5'}
    >
      {sendFailure !== null ? (
        <div
          data-testid="agent-send-failure"
          className="ag-turn mb-2 flex items-center justify-between gap-2 rounded-[11px] border border-[rgba(224,106,106,0.32)] bg-[linear-gradient(160deg,rgba(224,106,106,0.14),rgba(224,106,106,0.05))] px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          <span className="text-[11px] text-[var(--down)]">
            Message not delivered ({sendFailure.code}).
          </span>
          <button
            type="button"
            onClick={() => void retrySend()}
            className="rounded border border-[var(--hairline-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[var(--ink-1)] transition-colors hover:border-[var(--flame)] hover:text-[var(--flame)]"
          >
            retry
          </button>
        </div>
      ) : null}
      <div
        className={
          soren
            ? 'ag-soren-composer relative flex items-center gap-2.5'
            : 'ag-composer relative flex items-end gap-2 rounded-[14px] px-3 py-2.5'
        }
        data-streaming={streaming ? 'true' : 'false'}
      >
        <MentionPopover
          candidates={suggestions}
          activeIndex={activeIndex}
          onPick={pick}
          onHover={setActiveIndex}
        />
        <textarea
          ref={setRefs}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            syncMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
            autogrow();
          }}
          onKeyUp={(e) => {
            // Caret moves without an edit (arrows, click) also open/close it.
            if (!popoverOpen && !e.key.startsWith('Arrow')) return;
            const el = e.currentTarget;
            syncMentionQuery(el.value, el.selectionStart ?? el.value.length);
          }}
          onFocus={() => setComposerFocus(true)}
          onBlur={() => {
            setMentionQuery(null);
            setComposerFocus(false);
          }}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder ?? (soren ? 'Ask Soren' : 'Ask your agent…')}
          aria-label="Message the agent"
          data-testid="agent-input"
          className={
            soren
              ? 'ag-soren-field max-h-[120px] min-h-[20px] flex-1 resize-none bg-transparent outline-none'
              : 'max-h-[120px] min-h-[20px] flex-1 resize-none bg-transparent text-[12.5px] leading-snug text-[var(--ink-0)] outline-none placeholder:text-[var(--ink-3)]'
          }
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => void cancelActiveRun()}
            title="Stop the run"
            aria-label="Stop the run"
            data-testid="agent-stop"
            className={
              soren
                ? 'ag-soren-act flex shrink-0 items-center justify-center'
                : 'ag-stop flex h-6 w-6 shrink-0 items-center justify-center rounded-[9px] text-[var(--ink-1)] hover:text-[var(--down)]'
            }
          >
            <span
              aria-hidden
              className={
                soren
                  ? 'block h-3 w-3 rounded-[3px] bg-current'
                  : 'block h-2 w-2 rounded-[2px] bg-current'
              }
            />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || text.trim().length === 0}
            title="Send"
            aria-label="Send"
            data-testid="agent-send"
            style={soren ? undefined : ({ '--on-accent': ON_ACCENT } as CSSProperties)}
            className={
              soren
                ? 'ag-soren-act flex shrink-0 items-center justify-center disabled:cursor-not-allowed'
                : 'ag-send flex h-6 w-6 shrink-0 items-center justify-center rounded-[9px] text-[var(--on-accent)] disabled:cursor-not-allowed disabled:text-[var(--ink-3)]'
            }
          >
            <ArrowUp style={soren ? { width: 16, height: 16 } : { width: 14, height: 14 }} />
          </button>
        )}
      </div>
    </div>
  );
});
