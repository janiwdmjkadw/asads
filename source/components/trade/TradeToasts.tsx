import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { playTradeSuccessSound } from './tradeSound';
import { humanTradeErrorCopy } from './tradeErrorCopy';
import { useTradeToastV2Enabled } from '@/lib/notifications/useTradeToastV2';

// `confirmed` is the terminal success phase — the tx landed on a slot.
// There is intentionally no post-confirm `success`/fill phase: the fill
// sync is internal DB bookkeeping the user doesn't need to see.
export type TradeToastPhase = 'pending' | 'submitted' | 'confirmed' | 'error';
export type TradeToastSide = 'buy' | 'sell';

export interface TradeToastItem {
  readonly id: string;
  readonly side: TradeToastSide;
  readonly phase: TradeToastPhase;
  readonly solAmount: number | null;
  readonly estimated?: boolean;
  readonly signature?: string;
  readonly error?: string;
  readonly createdAt: number;
}

interface Props {
  readonly toasts: ReadonlyArray<TradeToastItem>;
  readonly onDismiss: (id: string) => void;
}

const DONE_DISMISS_MS = 5000;
const VISIBLE_TOASTS = 12;

export function TradeToasts({ toasts, onDismiss }: Props) {
  const playedSuccessToastIds = useRef(new Set<string>());

  useEffect(() => {
    for (const toast of toasts) {
      if (toast.phase !== 'confirmed') continue;
      if (playedSuccessToastIds.current.has(toast.id)) continue;
      playedSuccessToastIds.current.add(toast.id);
      playTradeSuccessSound();
    }
  }, [toasts]);

  // Terminal toasts must expire even when pushed past the visible window:
  // per-child timers only exist for rendered (newest N) toasts, so older
  // confirmed/error toasts lingered in state and resurfaced later. One
  // parent-level sweep schedules every terminal toast's dismissal from its
  // own creation clock.
  const onDismissAllRef = useRef(onDismiss);
  useEffect(() => {
    onDismissAllRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.phase === 'confirmed' || toast.phase === 'error')
      .map((toast) =>
        window.setTimeout(
          () => onDismissAllRef.current(toast.id),
          Math.max(0, toast.createdAt + DONE_DISMISS_MS - Date.now()),
        ),
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [toasts]);

  // Motion is a per-item concern, reduced-motion a per-user one: read once
  // here, passed down as a plain prop.
  const reduceMotion = useReducedMotion() === true;

  // Arrival must be INSTANT (operator rule: an order-status notification
  // appears the frame it exists — an entrance animation spends reaction
  // time). A new toast at the top also PUSHES the rows below down, and an
  // animated push overlaps the new row with the old ones mid-glide. So the
  // stack classifies each commit: one that ADDS a toast renders with layout
  // animation OFF (everything snaps in the same frame); one that only
  // removes renders with it ON (the leaver fades, survivors glide into the
  // gap). Latency on the way in, motion on the way out.
  const visible = toasts.slice(-VISIBLE_TOASTS);
  const prevToastIdsRef = useRef<ReadonlySet<string>>(new Set());
  const hasArrival = visible.some((toast) => !prevToastIdsRef.current.has(toast.id));
  useEffect(() => {
    prevToastIdsRef.current = new Set(toasts.slice(-VISIBLE_TOASTS).map((toast) => toast.id));
  }, [toasts]);

  // The redesign ships dark. This FAILS CLOSED (see the hook's doc comment):
  // with no flag, no LD, or no provider mounted at all, every user keeps the
  // legacy card below — byte-identical to what production renders today.
  const v2 = useTradeToastV2Enabled();

  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed flex flex-col gap-2"
      style={{
        // Top-center, above the tracked-wallet notification stack
        // (top-[72px], z-80): the user's OWN order status always wins the
        // overlap, spatially and in z-order.
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        alignItems: 'center',
      }}
    >
      {v2 ? (
        // AnimatePresence keeps a removed toast mounted for its exit, so the
        // parent goes on simply dropping it from the array. Terminal toasts
        // expire on their own 5s clocks, so the one that leaves is routinely
        // from the MIDDLE of the stack.
        <AnimatePresence initial={false}>
          {visible.map((toast) => (
            <TradeToastV2
              key={toast.id}
              toast={toast}
              onDismiss={onDismiss}
              reduceMotion={reduceMotion}
              instantLayout={hasArrival}
            />
          ))}
        </AnimatePresence>
      ) : (
        visible.map((toast) => (
          <TradeToastLegacy key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))
      )}
    </div>
  );
}

// Motion vocabulary, matched to the repo's tokens (`--ease-out`, `--ease`).
// There is NO entrance: a mounting toast renders at full opacity in its
// final place. Motion is spent on the way out — 180ms for the leaver, 280ms
// for the survivors closing the gap — and on the one thing the row exists
// to show, the spinner→check morph.
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE = [0.32, 0.72, 0, 1] as const;
const REFLOW_MS = 0.28;
const EXIT_MS = 0.18;
const MORPH_MS = 0.24;
const WORD_FADE_MS = 0.18;

// ONE width for every phase — the row must not resize as a toast morphs.
// 260 rather than the narrower 210 for exactly one reason: the error reason
// is the only variable-length field, and `confirm.reverted` (the code the
// operator's own bug report carried, and the one that must not be confused
// with a capacity reject) needs ~105px of 11px mono to render whole. At 210
// it clipped mid-word.
const ROW_W = 244;
const ROW_H = 40;
// Sized to the widest word ("Submitted"/"Confirmed") so the cell never
// resizes and nothing to its right shifts across the lifecycle.
const WORD_W = 84;

function TradeToastV2({
  toast,
  onDismiss,
  reduceMotion,
  instantLayout,
}: {
  toast: TradeToastItem;
  onDismiss: (id: string) => void;
  reduceMotion: boolean;
  /** True when this commit ADDED a toast: every position snaps. */
  instantLayout: boolean;
}) {
  // ONE LINE, the lifecycle and nothing else — operator spec, final:
  // "no amount or additional details, literally loading state /
  // Submitted / Confirmed / Reverted — super simple but elegant premium."
  // A 20px glyph runs the ceremony (spin → ring + drawn mark + one-shot
  // bloom) and the line reads "Transaction <state>". Amount, side,
  // signature AND the failure reason live only in the title/aria
  // sentence. 40px tall, so a six-wallet fan-out costs ~280px, not 660.
  const isTerminal = toast.phase === 'confirmed' || toast.phase === 'error';
  const failed = toast.phase === 'error';
  const reason = failed ? humanTradeErrorCopy(toast.error ?? 'Order failed') : null;
  const sentence = rowSentence(toast, reason);

  const leave = reduceMotion
    ? { opacity: 0, transition: { duration: EXIT_MS } }
    : {
        opacity: 0,
        y: -6,
        scale: 0.98,
        transition: { duration: EXIT_MS, ease: EASE },
      };

  return (
    <motion.div
      // `layout` re-closes the gap with a transform (FLIP) when a toast
      // leaves — including one from the middle. On a commit that ADDS a
      // toast it is OFF entirely, not duration 0: duration 0 still rides
      // FLIP's measure cycle and lands the push-down a frame after the new
      // row paints.
      layout={reduceMotion || instantLayout ? false : 'position'}
      initial={false}
      exit={leave}
      transition={{ layout: { duration: REFLOW_MS, ease: EASE_OUT } }}
      className={[
        'group pointer-events-auto relative box-border flex items-center',
        'gap-x-[12px] px-[16px]',
        'overflow-hidden rounded-[13px] border border-[var(--hairline)]',
        'bg-[var(--surface-1)] shadow-[0_3px_12px_rgba(0,0,0,0.28)]',
        'whitespace-nowrap text-left',
      ].join(' ')}
      style={{ width: ROW_W, height: ROW_H }}
      title={sentence}
      aria-label={sentence}
    >
      <span className="relative flex h-[20px] w-[20px] flex-none items-center justify-center">
        {/* K3's landing bloom: a one-shot ring bursting from the glyph the
            frame the order lands. Keyed on the terminal phase so it fires
            exactly once; never mounted while working or under reduced
            motion. */}
        {isTerminal && !reduceMotion ? (
          <motion.span
            key={`bloom-${toast.phase}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border"
            style={{ borderColor: failed ? 'var(--down)' : 'var(--up)' }}
            initial={{ scale: 0.5, opacity: 0.7 }}
            animate={{ scale: 2.3, opacity: 0 }}
            transition={{ duration: 0.48, ease: EASE_OUT }}
          />
        ) : null}
        <LifecycleGlyph toast={toast} reduceMotion={reduceMotion} />
      </span>

      {/* One line, two tones: a quiet constant word and the state, which
          crossfades in a fixed slot so nothing ever shifts. */}
      <span className="flex items-baseline gap-x-[7px]">
        <span className="font-[family-name:var(--sans)] text-[13px] font-medium text-[var(--ink-3)]">
          Transaction
        </span>
        <span className="relative block h-[20px]" style={{ width: WORD_W }}>
          <AnimatePresence initial={false}>
            <motion.span
              key={toast.phase}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: WORD_FADE_MS, ease: EASE_OUT }}
              className="absolute inset-0 flex items-center font-[family-name:var(--sans)] text-[13.5px] font-semibold tracking-[-0.01em]"
              style={{ color: failed ? 'var(--down)' : toast.phase === 'confirmed' ? 'var(--ink-0)' : 'var(--ink-1)' }}
            >
              {terminalWord(toast)}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>

      {/* Dismiss without waiting out the drain (and the only way to clear a
          toast stuck in flight). Painted on the row's own ground and
          absolutely positioned, so it occupies no column and cannot shift
          one. */}
      <button
        type="button"
        aria-label="Dismiss trade notification"
        onClick={() => onDismiss(toast.id)}
        className="absolute inset-y-0 right-0 inline-flex w-[28px] cursor-pointer items-center justify-center bg-[var(--surface-1)] font-[family-name:var(--mono)] text-[13px] leading-none text-[var(--ink-2)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
      >
        ×
      </button>

      {/* The 5s auto-dismiss, made visible. The parent owns the actual
          timer; this is only its face, so there is no JS clock here. */}
      {isTerminal ? (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 right-0 h-[2px] origin-left"
          style={{
            background: failed ? 'var(--down)' : 'var(--up)',
            opacity: 0.55,
            animation: `trade-toast-dismiss ${DONE_DISMISS_MS}ms linear forwards`,
          }}
        />
      ) : null}
    </motion.div>
  );
}

const PHASE_WORD: Record<TradeToastPhase, string> = {
  pending: 'Sending',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  error: 'Failed',
};

/** "Reverted" is chain truth for confirm.reverted; anything else (queue
 *  full, in-flight cap, engine unreachable) genuinely FAILED to execute
 *  and saying "reverted" would misdescribe it. */
function terminalWord(toast: TradeToastItem): string {
  if (toast.phase !== 'error') return PHASE_WORD[toast.phase];
  return (toast.error ?? '').includes('revert') ? 'Reverted' : 'Failed';
}

/**
 * The whole show: an arc rotating while the order is in flight, which on
 * landing STOPS, closes into a full ring in the result colour, and draws a
 * check (or a cross) inside it. The rotation is a CSS keyframe on transform
 * only — no JS frame loop behind a stack of these — and the draw is a
 * `pathLength` tween, both of which reduced motion removes outright.
 */
function LifecycleGlyph({
  toast,
  reduceMotion,
}: {
  toast: TradeToastItem;
  reduceMotion: boolean;
}) {
  const confirmed = toast.phase === 'confirmed';
  const failed = toast.phase === 'error';
  const inFlight = !confirmed && !failed;
  const ring = confirmed
    ? 'var(--up)'
    : failed
      ? 'var(--down)'
      : toast.side === 'buy'
        ? 'var(--up-2)'
        : 'var(--down)';
  const draw = reduceMotion
    ? {}
    : {
        initial: { pathLength: 0 },
        animate: { pathLength: 1 },
        transition: { duration: MORPH_MS, ease: EASE_OUT },
      };

  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={20}
      height={20}
      fill="none"
      className={inFlight && !reduceMotion ? 'block animate-spin' : 'block'}
      style={inFlight && !reduceMotion ? { animationDuration: '0.9s' } : undefined}
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke={ring}
        strokeWidth="1.6"
        strokeLinecap="round"
        // In flight the ring is an arc (a quarter of the circumference);
        // landing removes the dash, so it snaps closed in the same frame
        // the check starts drawing.
        strokeDasharray={inFlight ? '9.4 28.3' : undefined}
      />
      {confirmed ? (
        <motion.path
          d="M4.9 8.2 L7 10.3 L11.1 6.1"
          stroke="var(--up)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          {...draw}
        />
      ) : null}
      {failed ? (
        <motion.path
          d="M5.7 5.7 L10.3 10.3 M10.3 5.7 L5.7 10.3"
          stroke="var(--down)"
          strokeWidth="1.7"
          strokeLinecap="round"
          {...draw}
        />
      ) : null}
    </svg>
  );
}

/** Everything the row stopped drawing, as a sentence — for hover and for a
 *  screen reader. */
function rowSentence(toast: TradeToastItem, reason: string | null): string {
  const side = toast.side === 'buy' ? 'Buy' : 'Sell';
  const size =
    toast.solAmount === null
      ? ''
      : ` ${toast.estimated ? '~' : ''}${formatSol(toast.solAmount)} SOL`;
  const word = PHASE_WORD[toast.phase].toLowerCase();
  return `${side}${size} — ${word}${reason ? `: ${reason}` : ''}`;
}

// ---------------------------------------------------------------------------
// Legacy renderer — the flag-off path.
//
// Copied VERBATIM from the shipped design (origin/master) apart from the
// rename. It is not maintained, restyled or improved: when the flag is off —
// no LD, no provider, flag missing — production must look exactly as it does
// today, and the only way to guarantee that is for this to be the same code.
// ---------------------------------------------------------------------------

function TradeToastLegacy({
  toast,
  onDismiss,
}: {
  toast: TradeToastItem;
  onDismiss: (id: string) => void;
}) {
  const isTerminal = toast.phase === 'confirmed' || toast.phase === 'error';
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isTerminal) return;
    const timeout = setTimeout(() => onDismissRef.current(toast.id), DONE_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [toast.id, toast.phase, isTerminal]);

  const tone = toneFor(toast);
  return (
    <div
      className="pointer-events-auto"
      style={{
        width: 300,
        padding: '10px 12px',
        borderRadius: 'var(--r-xl)',
        // Opaque surface, NO backdrop blur: --surface-1 is a solid color,
        // so the blur painted nothing visible while forcing a per-toast
        // backdrop re-blur every frame the content behind moved (live
        // chart/tape) — the whole page dragged under a spam-click stack.
        background: 'var(--surface-1, var(--surface))',
        border: isTerminal
          ? '1px solid var(--hairline-2)'
          : `1px solid color-mix(in srgb, ${tone.color} 45%, var(--hairline-2))`,
        boxShadow: isTerminal
          ? 'var(--shadow-toast)'
          : `var(--shadow-toast), 0 0 14px -2px ${tone.color}`,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--r-chip)',
            background: tone.color,
            boxShadow: `0 0 10px ${tone.color}`,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'var(--ink-0)', fontSize: 13, fontWeight: 650 }}>
            {titleFor(toast)}
          </div>
          <div
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              marginTop: 3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitleFor(toast)}
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss trade notification"
          onClick={() => onDismiss(toast.id)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 'var(--r-chip)',
            border: '1px solid var(--hairline)',
            color: 'var(--ink-3)',
            background: 'rgba(255,255,255,0.03)',
            fontSize: 12,
            lineHeight: '20px',
            flexShrink: 0,
          }}
        >
          x
        </button>
      </div>
      {isTerminal && (
        <div
          aria-hidden
          style={{
            height: 2,
            marginTop: 9,
            borderRadius: 'var(--r-chip)',
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 'var(--r-chip)',
              background: tone.color,
              // scaleX keyframes (globals.css) — anchor the shrink to the
              // left edge so it drains rightward like the old width anim.
              transformOrigin: 'left',
              animation: `trade-toast-dismiss ${DONE_DISMISS_MS}ms linear forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function titleFor(toast: TradeToastItem) {
  const amount = toast.solAmount === null ? '?' : formatSol(toast.solAmount);
  const prefix = toast.estimated ? '~' : '';
  if (toast.phase === 'confirmed') {
    return `${toast.side === 'buy' ? 'Buy' : 'Sell'} confirmed`;
  }
  if (toast.phase === 'error') {
    return `${toast.side === 'buy' ? 'Buy' : 'Sell'} failed`;
  }
  return `${toast.side === 'buy' ? 'Buying' : 'Selling'} ${prefix}${amount} SOL`;
}

function subtitleFor(toast: TradeToastItem) {
  if (toast.phase === 'confirmed') return 'Confirmed on-chain';
  if (toast.phase === 'error') return humanTradeErrorCopy(toast.error ?? 'Order failed');
  if (toast.signature) return `Submitted ${shortSig(toast.signature)}`;
  return 'Sending transaction';
}

function toneFor(toast: TradeToastItem) {
  if (toast.phase === 'error') return { color: 'var(--down)' };
  if (toast.phase === 'confirmed') return { color: 'var(--up)' };
  return { color: toast.side === 'buy' ? 'var(--up-2)' : 'var(--down)' };
}

function shortSig(sig: string) {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
}

function formatSol(value: number) {
  if (!Number.isFinite(value)) return '?';
  const fixed = value >= 1 ? value.toFixed(3) : value < 0.001 ? value.toFixed(6) : value.toFixed(4);
  return fixed.replace(/\.?0+$/, '');
}
