'use client';

import { GrainGradient, type GrainGradientProps } from '@paper-design/shaders-react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/components/landing/primitives/usePrefersReducedMotion';
import { cn } from '@/lib/utils';
import { CertificateArcs } from './CertificateArcs';
import styles from './certificate-invite.module.css';
import { DECODE_FIRST_MS, useGhostDecode, useTextDecode } from './useDecodeScramble';

/**
 * Invite-code modal — THE CERTIFICATE.
 *
 * A share certificate hanging in space over the landing: a live
 * GrainGradient ground under a carved bank-note frame rendered in ice
 * ink, two radial veils sinking the field behind the type, engraved
 * orbit arcs, a serif headline printed three times (mint fringe up-left,
 * pink fringe down-right, lit white face between), and a 2-3-3-3 serial
 * row that IS the code input — an invisible full-row field, no caret,
 * the next slot marking itself with a brightened border.
 *
 * Geometry: every dimension is `N * var(--ci-u)`, one design pixel of the
 * approved 1080x700 artwork. The stylesheet resolves that unit against
 * both viewport axes, so the panel is pixel-exact when it fits and
 * shrinks whole when it doesn't; below 768px the tokens are redefined and
 * the same DOM reflows into the mobile composition. See the stylesheet
 * header for the model.
 *
 * Choreography, all one-shot and all stilled under reduced motion:
 *   - Validating: the four group boxes breathe their borders.
 *   - Success: the row blooms mint, and then the certificate is STAMPED —
 *     an `ADMITTED · Nº nnnn` stamp slams into the open zone upper-right of
 *     the serial, the panel flinches once under the impact, and the edge
 *     caption swaps to `CERTIFIED · SEAT nnnn OF 500`. The hand-off waits
 *     for the slam to settle so the stamping is actually seen.
 *   - Error: the MISPRINT — every typed glyph splits into red/cyan
 *     chromatic ghosts as the registration slips, holds misregistered, then
 *     converges, under a status line naming the failure. Then the row
 *     resets to enterable.
 *
 * On top of that sits the brand decode scramble (see `useDecodeScramble`):
 * every untyped serial slot cipher-flickers AT ONCE for a fast beat, all
 * relax back to their resting glyphs together, the row holds still, and it
 * breathes again — one collective rhythm rather than a sweep, while one box
 * stays calm and the leftmost empty cell — the socket — stays still and
 * pulses its glow instead. The two mono support lines decode once on mount and
 * then rest for good. The serif headline is deliberately excluded — a display
 * serif rattling through cipher glyphs cheapens the one element the whole
 * composition is built around.
 *
 * The state machine (phases, early network overlap, timers, hidden
 * input, aria) is the classic modal's, unchanged. Only the visual layer
 * is new; the two are interchangeable behind `inviteModalVariant`.
 */

type CertificatePhase = 'idle' | 'inputting' | 'validating' | 'success' | 'error';

/** Which misprint the status line names. Anything unrecognised is `invalid`. */
type FailureKind = 'invalid' | 'taken';

type ValidationOutcome =
  | { kind: 'accepted' }
  | { kind: 'rejected'; failure: FailureKind }
  | { kind: 'failed' };

/**
 * The richer validation answer. A bare boolean stays valid — the classic
 * modal's contract — but a caller that knows WHY a code bounced can say so,
 * and the misprint names it. `reason` is the api's own enum
 * (`not_found` | `already_redeemed` | `revoked`), passed through untouched.
 */
export type CodeVerdict = { accepted: boolean; reason?: string };

export type CertificateInviteModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codeLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  resetOnOpen?: boolean;
  /** Seat number printed on the ADMITTED stamp and the certified caption. */
  serialNumber?: number | null;
  onValidateCode?: (code: string) => boolean | CodeVerdict | Promise<boolean | CodeVerdict>;
  onSuccessAnimationComplete?: (code: string) => void;
};

/* Conservative read of the api's rejection reason: only an explicitly
   already-redeemed code gets the seat-taken misprint. Not-found, revoked,
   an unknown string, a bare `false`, and a failed round trip all read as
   the plain invalid-currency misprint. */
function failureKindFromReason(reason: string | undefined): FailureKind {
  return reason !== undefined && /already/i.test(reason) ? 'taken' : 'invalid';
}

const DEFAULT_CODE_LENGTH = 11;
const DEFAULT_PLACEHOLDER = 'LISXXXXXXXX';
const ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';
/** How many leading glyphs are the fixed brand prefix (mint ghosts). */
const PREFIX_LENGTH = 3;
/** Serial grouping — 2-3-3-3, the design's four boxes. */
const GROUP_SIZES = [2, 3, 3, 3] as const;
/* One box sits the scramble out entirely — its ghosts are permanently
   resting X's, so the row always has a still anchor to read the moving
   cells against. Zero-based: 2 is the third box, the middle-right
   [X X X]. Move it (0-3) if another box reads better; a per-cycle
   rotation is the other option if the stillness should travel. */
const CALM_GROUP_INDEX = 2;
/** Group the mobile row wraps after; dashes never cross the break. */
const MOBILE_BREAK_AFTER = 1;

/* The validating dwell. The network call is fired at pulse start, so the
   total wait is max(pulse, network) and never their sum. Shorter than the
   classic modal's 3200ms: that number bought time for the owl's scan
   choreography, and a border pulse has nothing to show for three seconds. */
const VALIDATION_ANIMATION_MS = 1400;
/* Error dwell before the row resets. The misprint runs 120ms of slipping
   registration, a 1100ms misregistered hold and a 180ms convergence, so the
   dwell is that 1400ms exactly — the row resets as the print comes back into
   register. It was 900ms when the error was a 300ms shudder. */
const ERROR_RESET_MS = 1400;
/* The stamping window. The slam lands at STAMP_DELAY_MS + its 220ms, the
   settle wobble and the ink-press glow clear shortly after, and only then
   do we hand off — so the user watches the certificate get stamped instead
   of catching the page already leaving. The caller adds its own ~1050ms
   before navigating, keeping the whole success dwell under 2s. */
const STAMP_DELAY_MS = 250;
const SUCCESS_HANDOFF_MS = 700;

/** The two mono support lines, hoisted so the decode hook owns one identity. */
const EYEBROW_TEXT = 'Limited Edition';
const CAPTION_TEXT = 'NON-TRANSFERABLE · MMXXVI';
/** Seats in the edition — the denominator of the certified caption. */
const EDITION_SIZE = 500;

/* Title case, not the caption's caps: these print in the headline's serif
   on the headline's three plates, and the affordance line under them
   already speaks in that voice. Same words the mono line said. */
const MISPRINT_TEXT: Record<FailureKind, string> = {
  invalid: 'Misprint · Invalid Currency',
  taken: 'Already Redeemed · Seat Taken',
};

/* The two fringe copies are lifted out of flow onto the lit face, which
   stays in flow so the block keeps its own height where the design does
   not give it one (mobile). Shared by every three-plate line: the
   headline, the affordance, the misprint. */
const headlineFringe = 'absolute inset-x-0 top-0 block';

/**
 * THE MISPRINT'S STATUS LINE — what the press got wrong, printed the way
 * the press prints everything else it means: the headline's serif on the
 * headline's three plates, inked in the danger red's own family. A deeper
 * crimson slips up-left, a hotter orange-red down-right, and the lit face
 * sits between them under a red glow. Sized under the affordance below it
 * (21u to its 26u) so the failure names itself without outranking the
 * label that says what to do next.
 *
 * Exported for the test: the terminal has no DOM infra, so the error
 * phase — which only a rejected round trip can reach — is covered by
 * rendering this line directly.
 */
export function MisprintStatusLine({ failureKind }: { failureKind: FailureKind }) {
  const text = MISPRINT_TEXT[failureKind];
  return (
    <span
      aria-hidden
      className={cn(
        styles.statusLine,
        'mt-[calc(14*var(--ci-u))] flex w-full items-center justify-center gap-[calc(14*var(--ci-u))]',
        'md:absolute md:left-0 md:top-[calc(446*var(--ci-u))] md:mt-0',
      )}
    >
      <span className={styles.statusRule} />
      <span
        className={cn(
          styles.statusText,
          'font-instrument-serif text-[length:var(--ci-fail)] leading-[var(--ci-fail-lh)] tracking-[-0.01em]',
        )}
      >
        <span
          className={cn(
            headlineFringe,
            'text-[color:var(--ci-fail-deep)] translate-x-[calc(-1*var(--ci-fail-dx))] translate-y-[calc(-1*var(--ci-fail-dy))]',
          )}
        >
          {text}
        </span>
        <span
          className={cn(
            headlineFringe,
            'text-[color:var(--ci-fail-hot)] translate-x-[var(--ci-fail-dx)] translate-y-[var(--ci-fail-dy)]',
          )}
        >
          {text}
        </span>
        <span className="relative block text-[color:var(--ci-fail-face)] [text-shadow:var(--ci-fail-glow)_0_0_var(--ci-fail-glow-r)]">
          {text}
        </span>
      </span>
      <span className={styles.statusRule} />
    </span>
  );
}

/** The stamp and the certified caption both print the seat this way. */
function formatSeat(serialNumber: number | null | undefined) {
  return String(serialNumber ?? 0).padStart(4, '0');
}

const SHADER_PARAMS = {
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0.05,
  softness: 0.5,
  intensity: 0.37,
  noise: 0.43,
  shape: 'corners',
  colors: ['#007475', '#43E2C2', '#00BFFF', '#3A907D'],
  /* The design board pairs a transparent back with a black plate under
     the canvas. Making the back opaque black is the same picture and it
     leaves the canvas fully opaque, so the no-WebGL gradient underneath
     stays hidden whenever the shader IS running. */
  colorBack: '#000000',
} satisfies Partial<GrainGradientProps>;

/* Reduced-motion policy for shader grounds, same as the landing's
   `MeshGround`: freeze, don't drop. `speed: 0` stops the render loop and
   paints one still frame of the same field; pinning `frame` makes that
   still deterministic instead of whatever t=0 happens to be. */
const SHADER_STILL = { speed: 0, frame: 2030025 } as const;
const SHADER_LIVE = { speed: 1.11 } as const;

function normalizeCode(value: string, maxLength: number) {
  return value
    .toUpperCase()
    .split('')
    .filter(char => ALPHANUM.includes(char) && char !== '-')
    .join('')
    .slice(0, maxLength);
}

function fitPlaceholder(placeholder: string, length: number) {
  return normalizeCode(placeholder, length).padEnd(length, 'X').slice(0, length);
}

/** Slice the flat code length into the design's 2-3-3-3 boxes. */
function buildGroups(length: number): ReadonlyArray<ReadonlyArray<number>> {
  const groups: number[][] = [];
  let index = 0;
  for (const size of GROUP_SIZES) {
    if (index >= length) break;
    groups.push(Array.from({ length: Math.min(size, length - index) }, (_, i) => index + i));
    index += size;
  }
  // Any surplus (a non-default codeLength) rides in one trailing box
  // rather than silently vanishing from the row.
  if (index < length) {
    groups.push(Array.from({ length: length - index }, (_, i) => index + i));
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Edge furniture                                                       */
/* ------------------------------------------------------------------ */

/** 17 ticks along the top, every 4th major; 11 down each side, every 5th. */
const TOP_TICKS = Array.from({ length: 17 }, (_, i) => i % 4 === 0);
const SIDE_TICKS = Array.from({ length: 11 }, (_, i) => i % 5 === 0);

const BRACKET_ARM = 'absolute bg-[color:var(--ci-mint-bracket)]';

/** The edge caption's type, shared by the resting line and the certified one. */
const CAPTION_GLYPH =
  'shrink-0 whitespace-nowrap font-geist-mono text-[length:calc(8*var(--ci-u))] leading-[calc(12*var(--ci-u))] tracking-[0.34em]';

/** One 32x32 corner L, drawn as two arms so each corner picks its own. */
function Bracket({ corner }: { corner: 'tl' | 'tr' | 'bl' | 'br' }) {
  const top = corner === 'tl' || corner === 'tr';
  const left = corner === 'tl' || corner === 'bl';
  return (
    <div
      aria-hidden
      className={cn(
        'absolute z-[4] hidden size-[calc(32*var(--ci-u))] md:block',
        top ? 'top-[calc(7*var(--ci-u))]' : 'bottom-[calc(7*var(--ci-u))]',
        left ? 'left-[calc(7*var(--ci-u))]' : 'right-[calc(7*var(--ci-u))]',
      )}
    >
      <span
        className={cn(
          BRACKET_ARM,
          'left-0 h-[calc(2*var(--ci-u))] w-full',
          top ? 'top-0' : 'bottom-0',
        )}
      />
      <span
        className={cn(
          BRACKET_ARM,
          'top-0 h-full w-[calc(2*var(--ci-u))]',
          left ? 'left-0' : 'right-0',
        )}
      />
    </div>
  );
}

function Ruler({ edge }: { edge: 'top' | 'left' | 'right' }) {
  const vertical = edge !== 'top';
  const ticks = vertical ? SIDE_TICKS : TOP_TICKS;
  return (
    <div
      aria-hidden
      className={cn(
        'absolute z-[4] hidden md:flex',
        edge === 'top' &&
          'left-[calc(180*var(--ci-u))] top-[calc(4*var(--ci-u))] h-[calc(10*var(--ci-u))] w-[calc(721*var(--ci-u))] items-start gap-[calc(44*var(--ci-u))]',
        vertical &&
          'top-[calc(200*var(--ci-u))] h-[calc(301*var(--ci-u))] w-[calc(10*var(--ci-u))] flex-col gap-[calc(29*var(--ci-u))]',
        edge === 'left' && 'left-[calc(4*var(--ci-u))] items-start',
        edge === 'right' && 'left-[calc(1066*var(--ci-u))] items-end',
      )}
    >
      {ticks.map((major, i) => (
        <span
          key={i}
          className={cn(
            'shrink-0',
            vertical ? 'h-px' : 'w-px',
            major
              ? 'bg-[color:var(--ci-tick-major)]'
              : 'bg-[color:var(--ci-tick-minor)]',
            vertical
              ? major
                ? 'w-[calc(10*var(--ci-u))]'
                : 'w-[calc(5*var(--ci-u))]'
              : major
                ? 'h-[calc(10*var(--ci-u))]'
                : 'h-[calc(5*var(--ci-u))]',
          )}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The modal                                                            */
/* ------------------------------------------------------------------ */

export function CertificateInviteModal({
  open,
  onOpenChange,
  codeLength = DEFAULT_CODE_LENGTH,
  placeholder = DEFAULT_PLACEHOLDER,
  autoFocus = true,
  resetOnOpen = true,
  serialNumber = null,
  onValidateCode,
  onSuccessAnimationComplete,
}: CertificateInviteModalProps) {
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<CertificatePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<FailureKind>('invalid');
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const validationStartedFor = useRef<string | null>(null);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight network validation, kicked off the moment the pulse starts
  // so the round trip overlaps the choreography instead of following it.
  // Wrapped so it can never reject unhandled.
  const pendingValidation = useRef<Promise<ValidationOutcome> | null>(null);

  const reducedMotion = usePrefersReducedMotion();

  const displayPlaceholder = useMemo(
    () => fitPlaceholder(placeholder, codeLength),
    [codeLength, placeholder],
  );
  const groups = useMemo(() => buildGroups(codeLength), [codeLength]);

  /* The ghosts scramble only while the row is enterable: `validating`
     belongs to the border pulse, and `error`/`success` are resolutions, not
     invitations. Reduced motion stills all of it. */
  const ghostDecodeEnabled =
    open && !reducedMotion && (phase === 'idle' || phase === 'inputting');
  const { registerGhost, burstNow } = useGhostDecode({
    enabled: ghostDecodeEnabled,
    length: codeLength,
    resting: displayPlaceholder,
  });

  // Support lines: one pass on open, then permanently at rest.
  const lineDecodeEnabled = open && !reducedMotion;
  const eyebrowRef = useTextDecode(EYEBROW_TEXT, lineDecodeEnabled, DECODE_FIRST_MS);
  const captionRef = useTextDecode(CAPTION_TEXT, lineDecodeEnabled, DECODE_FIRST_MS);

  useEffect(() => {
    if (!open) return;

    if (resetOnOpen) {
      setCode('');
      setPhase('idle');
      setError(null);
      validationStartedFor.current = null;
      pendingValidation.current = null;
    }

    if (autoFocus) {
      window.setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [autoFocus, open, resetOnOpen]);

  useEffect(() => {
    return () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
    };
  }, []);

  // Resolve `onValidateCode` to a tagged outcome that never rejects, so
  // the promise can be started early without an unhandled-rejection
  // window before `finishValidation` awaits it.
  const startValidation = useCallback(
    (codeToValidate: string): Promise<ValidationOutcome> =>
      Promise.resolve()
        .then(() => (onValidateCode ? onValidateCode(codeToValidate) : true))
        .then((verdict): ValidationOutcome => {
          // A bare boolean is the classic contract; a verdict object also
          // carries the api's reason, which is what names the misprint.
          const accepted = typeof verdict === 'boolean' ? verdict : verdict.accepted;
          if (accepted) return { kind: 'accepted' };
          const reason = typeof verdict === 'boolean' ? undefined : verdict.reason;
          return { kind: 'rejected', failure: failureKindFromReason(reason) };
        })
        .catch((): ValidationOutcome => ({ kind: 'failed' })),
    [onValidateCode],
  );

  const finishValidation = useCallback(
    async (codeToValidate: string) => {
      const outcome = await (pendingValidation.current ?? startValidation(codeToValidate));
      pendingValidation.current = null;

      if (outcome.kind !== 'accepted') {
        const rejected = outcome.kind === 'rejected';
        validationStartedFor.current = null;
        setFailureKind(rejected ? outcome.failure : 'invalid');
        setPhase('error');
        setError(rejected ? 'Code was not accepted' : 'Unable to validate code');
        resetTimer.current = setTimeout(() => {
          // A rejected code clears; a failed round trip keeps what was
          // typed so the user can simply retry. Either way the row is
          // enterable again and takes focus back.
          if (rejected) setCode('');
          setPhase(rejected ? 'idle' : 'inputting');
          inputRef.current?.focus();
        }, ERROR_RESET_MS);
        return;
      }

      setPhase('success');
      // Hold the hand-off until the stamp has landed and settled. The
      // classic modal fires immediately; here the stamping IS the success
      // design, and a caller that navigates on this callback would
      // otherwise pull the page out from under it mid-slam.
      handoffTimer.current = setTimeout(() => {
        onSuccessAnimationComplete?.(codeToValidate);
      }, SUCCESS_HANDOFF_MS);
    },
    [onSuccessAnimationComplete, startValidation],
  );

  const beginValidation = useCallback(
    (nextCode: string) => {
      if (validationStartedFor.current === nextCode) return;

      validationStartedFor.current = nextCode;
      setError(null);
      setPhase('validating');
      // Fire the network validation NOW so it runs concurrently with the
      // pulse: total wait is max(animation, network), not their sum.
      pendingValidation.current = startValidation(nextCode);

      if (validationTimer.current) clearTimeout(validationTimer.current);
      validationTimer.current = setTimeout(() => {
        void finishValidation(nextCode);
      }, VALIDATION_ANIMATION_MS);
    },
    [finishValidation, startValidation],
  );

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (phase === 'validating' || phase === 'success') return;

    const nextCode = normalizeCode(event.target.value, codeLength);
    setCode(nextCode);
    setError(null);
    setPhase(nextCode.length > 0 ? 'inputting' : 'idle');

    window.setTimeout(() => {
      inputRef.current?.setSelectionRange(nextCode.length, nextCode.length);
    }, 0);

    if (nextCode.length === codeLength) beginValidation(nextCode);
  };

  const canInteract = phase !== 'validating' && phase !== 'success';

  const statusText =
    phase === 'validating'
      ? 'Checking your invite code'
      : phase === 'success'
        ? 'Invite code confirmed'
        : (error ?? 'Enter your invite code');

  // The next slot to fill — the cell that wears the active border.
  const activeIndex = isFocused && canInteract && code.length < codeLength ? code.length : -1;

  /* The socket: the same leftmost unfilled cell, but held whether or not
     the row has focus. It is the row's invitation — an EMPTY cell with a
     pulsing glow — so it must not blink out into a ghost glyph the
     moment focus wanders. It also never scrambles. */
  const socketIndex = canInteract && code.length < codeLength ? code.length : -1;

  /* Both resolution states are rendered only in their own phase, so the
     resting certificate's DOM is exactly what it was before they existed. */
  const stamped = phase === 'success';
  const misprint = phase === 'error';
  const seat = formatSeat(serialNumber);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          /* `styles.stage` makes this the size container the panel
             measures itself against — see the stylesheet header for why
             the viewport is the wrong ruler here. */
          className={cn(
            styles.stage,
            // No padding: the panel's breathing room is the margin baked
            // into --ci-u, and overlay padding would shrink the container
            // the unit measures against, double-counting it.
            'fixed inset-0 z-[80] grid place-items-center overflow-hidden p-0',
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Invite code"
          onClick={() => {
            if (phase !== 'validating') onOpenChange(false);
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="absolute inset-0 bg-[color:var(--ci-scrim)]" aria-hidden />

          <AnimatePresence>
            {canInteract ? (
              <motion.button
                type="button"
                className="absolute right-[26px] top-6 z-10 grid size-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-[transform,background-color] duration-150 hover:bg-white/10 hover:-translate-y-px hover:rotate-90 motion-reduce:transition-none motion-reduce:hover:transform-none"
                aria-label="Close"
                onClick={event => {
                  event.stopPropagation();
                  onOpenChange(false);
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X aria-hidden="true" className="size-[17px]" />
              </motion.button>
            ) : null}
          </AnimatePresence>

          <motion.div
            className={cn(
              styles.cert,
              /* Spacing rides --ci-u rather than the rem scale: the root
                 font-size differs between the landing (16px) and the rest
                 of the app (14px), and this composition should not. */
              'group/cert relative z-[1] flex h-full w-full cursor-text flex-col items-center justify-center gap-[calc(28*var(--ci-u))] px-[calc(20*var(--ci-u))] py-[calc(24*var(--ci-u))]',
              'md:block md:h-[calc(700*var(--ci-u))] md:w-[calc(1080*var(--ci-u))] md:gap-0 md:p-0',
            )}
            data-phase={phase}
            onClick={event => {
              event.stopPropagation();
              if (canInteract) inputRef.current?.focus();
            }}
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              aria-hidden
              className="absolute inset-0 z-0 bg-black bg-[image:var(--ci-ground-fallback)]"
            >
              <GrainGradient
                {...SHADER_PARAMS}
                {...(reducedMotion ? SHADER_STILL : SHADER_LIVE)}
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            {/* Mobile has no frame and no room for the interior veils to
                spread, so the type would sit straight on the live field.
                One flat wash buys the contrast back without touching the
                desktop composition. */}
            <div aria-hidden className="absolute inset-0 z-[1] bg-black/60 md:hidden" />

            {/* A raw <img>, not next/image: the ice-ink treatment needs the
                bitmap under a blend mode and a filter chain, and the
                optimizer's srcset would fight the fixed 1080x700 geometry for
                no bandwidth win. Mobile drops the frame entirely (the design
                is desktop-only), so it costs nothing there. */}
            <img
              className={cn(styles.iceInk, 'absolute inset-0 z-[1] hidden h-full w-full md:block')}
              src="/invite/certificate-frame.png"
              alt=""
              width={1080}
              height={700}
              aria-hidden
            />

            <div
              className={cn(
                styles.veilInterior,
                'relative z-[2] order-2 flex w-full flex-col items-center py-[calc(24*var(--ci-u))]',
                'md:absolute md:left-[calc(84*var(--ci-u))] md:top-[calc(84*var(--ci-u))] md:block md:h-[calc(534*var(--ci-u))] md:w-[calc(923*var(--ci-u))] md:py-0',
              )}
            >
              <label
                className={cn(
                  styles.serialRow,
                  'relative flex w-full flex-wrap items-center justify-center gap-y-[calc(12*var(--ci-u))]',
                  'md:absolute md:left-0 md:top-[calc(333*var(--ci-u))] md:h-[calc(102*var(--ci-u))] md:flex-nowrap md:gap-y-0',
                )}
                aria-label="Invite code"
              >
                {groups.map((indices, groupIndex) => (
                  <SerialGroup
                    key={groupIndex}
                    indices={indices}
                    isLast={groupIndex === groups.length - 1}
                    breakAfter={groupIndex === MOBILE_BREAK_AFTER}
                    code={code}
                    placeholder={displayPlaceholder}
                    activeIndex={activeIndex}
                    socketIndex={socketIndex}
                    calm={groupIndex === CALM_GROUP_INDEX}
                    misprint={misprint}
                    registerGhost={registerGhost}
                  />
                ))}

                <input
                  ref={inputRef}
                  className="absolute inset-0 m-0 appearance-none border-0 bg-transparent p-0 text-transparent opacity-0 outline-none [caret-color:transparent] pointer-events-none"
                  value={code}
                  onChange={handleInputChange}
                  /* Focus answers with one extra collective burst — the row
                     acknowledging the cursor — after which the cycle
                     resumes from a fresh rest. The auto-focus on open is
                     refused by the hook's mount delay. */
                  onFocus={() => {
                    setIsFocused(true);
                    burstNow();
                  }}
                  onBlur={() => setIsFocused(false)}
                  disabled={!canInteract}
                  autoComplete="off"
                  autoCapitalize="characters"
                  inputMode="text"
                  spellCheck={false}
                />
              </label>

              {/* THE AFFORDANCE. Nothing about a row of engraved boxes says
                  "type here", and a first-time holder of an invite code has
                  to be told once. Rendered in every phase — it is the row's
                  standing label, not a state message — and hoisted out of
                  the row for the same reason the stamp is: the row carries
                  the 75% desktop scale, so a child of it would print at the
                  wrong size. Desktop hangs it 14u below the misprint's slot
                  so the two lines that can sit under the row never share
                  one; mobile stacks both in flow on the same 14u step.

                  It is printed the way the headline is — same serif, the
                  same three plates (mint up-left, pink down-right, lit face
                  between), the same inks — on its own offset and glow
                  tokens so the press reads at a quarter of the size. It
                  answers "Welcome To The Future.", so it speaks in that
                  voice rather than the captions'. */}
              <span
                aria-hidden
                className={cn(
                  styles.enterHint,
                  'relative mt-[calc(14*var(--ci-u))] block w-full text-center',
                  'font-instrument-serif text-[length:var(--ci-hint)] leading-[var(--ci-hint-lh)] tracking-[-0.01em]',
                  'md:absolute md:left-0 md:top-[calc(474*var(--ci-u))] md:mt-0',
                )}
              >
                <span
                  className={cn(
                    headlineFringe,
                    'text-[color:var(--ci-head-mint)] translate-x-[calc(-1*var(--ci-hint-dx))] translate-y-[calc(-1*var(--ci-hint-dy))]',
                  )}
                >
                  Enter Invite Code
                </span>
                <span
                  className={cn(
                    headlineFringe,
                    'text-[color:var(--ci-head-pink)] translate-x-[var(--ci-hint-dx)] translate-y-[var(--ci-hint-dy)]',
                  )}
                >
                  Enter Invite Code
                </span>
                <span className="relative block text-[color:var(--ci-head-face)] [text-shadow:var(--ci-head-glow)_0_0_var(--ci-hint-glow-r)]">
                  Enter Invite Code
                </span>
              </span>

              {/* THE STAMP. It lives here, not inside the row: the row
                  carries the approved 75% desktop scale, and a stamp that
                  shrank with it would print at the wrong size. This
                  container is unscaled, so panel design-pixels are honest.
                  Desktop coordinates are the R3-A board's, minus the
                  container's own (84,84) origin; mobile drops it into the
                  clear band under the two wrapped rows. */}
              {stamped ? (
                <span
                  aria-hidden
                  className={cn(
                    styles.stampAnchor,
                    /* Mobile centres it on this block's bottom edge, which
                       is 24u clear of the wrapped rows and 28u clear of the
                       caption below — the only band on a phone wide enough
                       to take the stamp without landing on the serial. */
                    'pointer-events-none absolute left-[68%] top-full',
                    'md:left-[calc(774*var(--ci-u))] md:top-[calc(250*var(--ci-u))]',
                  )}
                >
                  <span className={styles.stamp}>
                    <span className={styles.stampInner}>{`ADMITTED · Nº ${seat}`}</span>
                  </span>
                </span>
              ) : null}

              {misprint ? <MisprintStatusLine failureKind={failureKind} /> : null}
            </div>

            <Bracket corner="tl" />
            <Bracket corner="tr" />
            <Bracket corner="bl" />
            <Bracket corner="br" />

            <Ruler edge="top" />
            <Ruler edge="left" />
            <Ruler edge="right" />

            <div
              aria-hidden
              className="relative z-[4] order-3 flex w-full items-center justify-center gap-[calc(14*var(--ci-u))] md:absolute md:left-[calc(180*var(--ci-u))] md:top-[calc(685*var(--ci-u))] md:h-[calc(12*var(--ci-u))] md:w-[calc(720*var(--ci-u))]"
            >
              <span className="h-px w-[calc(34*var(--ci-u))] shrink-0 bg-[color:var(--ci-caption-rule)]" />
              {/* Two spans, not one with swapped text: the decode hook owns
                  the resting caption's textContent imperatively, so the
                  certified line is a separate element it never touches. */}
              {stamped ? (
                <span className={cn(CAPTION_GLYPH, 'text-[color:var(--ci-mint)]')}>
                  {`CERTIFIED · SEAT ${seat} OF ${EDITION_SIZE}`}
                </span>
              ) : (
                <span
                  ref={captionRef}
                  className={cn(
                    styles.monoGlyph,
                    CAPTION_GLYPH,
                    'text-[color:var(--ci-caption-ink)]',
                  )}
                >
                  {CAPTION_TEXT}
                </span>
              )}
              <span className="h-px w-[calc(34*var(--ci-u))] shrink-0 bg-[color:var(--ci-caption-rule)]" />
            </div>

            <div
              className={cn(
                styles.veilHead,
                'pointer-events-none relative z-[3] order-1 flex w-full flex-col items-center gap-[calc(14*var(--ci-u))]',
                'md:absolute md:left-[calc(84*var(--ci-u))] md:top-[calc(130*var(--ci-u))] md:block md:h-[calc(320*var(--ci-u))] md:w-[calc(923*var(--ci-u))] md:gap-0',
              )}
            >
              <CertificateArcs className="absolute hidden opacity-20 md:block md:left-[calc(74*var(--ci-u))] md:top-[calc(-54*var(--ci-u))] md:h-[calc(353*var(--ci-u))] md:w-[calc(755*var(--ci-u))]" />

              <div className="relative w-full text-center font-instrument-serif text-[length:var(--ci-head)] leading-[var(--ci-head-lh)] tracking-[-0.01em] md:absolute md:left-0 md:top-[calc(55*var(--ci-u))] md:h-[calc(92*var(--ci-u))]">
                <span
                  aria-hidden
                  className={cn(
                    headlineFringe,
                    'text-[color:var(--ci-head-mint)] translate-x-[calc(-1*var(--ci-head-dx))] translate-y-[calc(-1*var(--ci-head-dy))]',
                  )}
                >
                  Welcome To The Future.
                </span>
                <span
                  aria-hidden
                  className={cn(
                    headlineFringe,
                    'text-[color:var(--ci-head-pink)] translate-x-[var(--ci-head-dx)] translate-y-[var(--ci-head-dy)]',
                  )}
                >
                  Welcome To The Future.
                </span>
                <span className="relative block text-[color:var(--ci-head-face)] [text-shadow:var(--ci-head-glow)_0_0_40px]">
                  Welcome To The Future.
                </span>
              </div>

              <div className="flex w-full items-center justify-center gap-[var(--ci-eyebrow-gap)] md:absolute md:left-0 md:top-[calc(176*var(--ci-u))] md:h-[calc(28*var(--ci-u))]">
                <span
                  aria-hidden
                  className="h-px w-[var(--ci-eyebrow-rule)] shrink-0 bg-[color:var(--ci-eyebrow-line)]"
                />
                <span
                  ref={eyebrowRef}
                  className={cn(
                    styles.monoGlyph,
                    'shrink-0 whitespace-nowrap font-geist-mono text-[length:var(--ci-eyebrow)] tracking-[var(--ci-eyebrow-track)] text-[color:var(--ci-eyebrow-ink)] [text-shadow:var(--ci-eyebrow-glow)_0_0_20px]',
                  )}
                >
                  {EYEBROW_TEXT}
                </span>
                <span
                  aria-hidden
                  className="h-px w-[var(--ci-eyebrow-rule)] shrink-0 bg-[color:var(--ci-eyebrow-line)]"
                />
              </div>
            </div>

            <p className="sr-only" aria-live="polite">
              {statusText}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* One serial group box                                                 */
/* ------------------------------------------------------------------ */

function SerialGroup({
  indices,
  isLast,
  breakAfter,
  code,
  placeholder,
  activeIndex,
  socketIndex,
  calm,
  misprint,
  registerGhost,
}: {
  indices: ReadonlyArray<number>;
  isLast: boolean;
  breakAfter: boolean;
  code: string;
  placeholder: string;
  activeIndex: number;
  socketIndex: number;
  calm: boolean;
  misprint: boolean;
  registerGhost: (index: number, el: HTMLSpanElement | null) => void;
}) {
  return (
    <>
      <span
        className={cn(
          styles.group,
          'flex h-[var(--ci-group-h)] shrink-0 items-center justify-center gap-[var(--ci-cell-gap)] rounded-[var(--ci-group-r)] border p-[var(--ci-group-pad)]',
          'border-[color:var(--ci-group-border)] bg-[color:var(--ci-group-bg)] transition-colors duration-200',
          'group-data-[phase=error]/cert:border-[color:var(--ci-danger-line)]',
        )}
      >
        {indices.map(index => {
          const typed = code[index] ?? null;
          const isGhost = typed === null;
          const isSocket = index === socketIndex;
          return (
            <span
              key={index}
              data-active={index === activeIndex}
              /* The socket wears the pulse; the CSS owns the loop. */
              data-socket={isSocket}
              className={cn(
                styles.cell,
                'flex h-[var(--ci-cell-h)] w-[var(--ci-cell-w)] shrink-0 items-center justify-center rounded-[var(--ci-cell-r)] border',
                'border-[color:var(--ci-cell-border)] bg-[color:var(--ci-cell-bg)] transition-[border-color,background-color,box-shadow] duration-200',
                'data-[active=true]:border-[color:var(--ci-mint-line)]',
                'group-data-[phase=error]/cert:border-[color:var(--ci-danger-line)]',
                // Only the misprint needs a positioned cell, so the resting
                // row keeps the exact box it has always had.
                misprint && 'relative',
              )}
            >
              {/* THE MISPRINT. Two off-register copies of the glyph, red
                  low-left and cyan high-right, laid UNDER the white face
                  inside the cell — the plate slipping, not the paper
                  shaking. Rendered only while the press is wrong. */}
              {misprint && typed !== null ? (
                <>
                  <span aria-hidden className={cn(styles.misGhost, styles.misGhostRed)}>
                    {typed}
                  </span>
                  <span aria-hidden className={cn(styles.misGhost, styles.misGhostCyan)}>
                    {typed}
                  </span>
                </>
              ) : null}
              <span
                /* The scramble writes textContent imperatively, so React
                   only corrects a cell when its OWN text child changes —
                   and for the fixed `LIS` prefix the typed character is
                   the same character the placeholder already showed. A
                   cipher glyph caught there at the moment of typing could
                   therefore never be cleaned up, and the row would print
                   `Lh(99…` for the rest of the session. Keying on the
                   ghost/typed transition remounts the span, which makes
                   React's text authoritative again exactly when it has to
                   be. */
                key={isGhost ? 'ghost' : 'typed'}
                ref={el => {
                  registerGhost(index, el);
                }}
                /* The scramble's three gates, all read per tick: a filled
                   cell drops out mid-burst and rejoins the moment it is
                   cleared, the calm box never joins, and the socket stays
                   empty and still while the glow does its work. */
                data-ghost={isGhost}
                data-calm={calm}
                data-socket={isSocket}
                className={cn(
                  styles.ghostGlyph,
                  'text-center font-geist-mono font-medium text-[length:var(--ci-glyph)] leading-[var(--ci-glyph-lh)] transition-colors duration-300',
                  // The white face rides above its two off-register ghosts,
                  // which are positioned and would otherwise paint over it.
                  misprint && 'relative z-[1]',
                  // Ghosts sit back at half strength so a typed character
                  // reads as typed; the fixed LIS prefix keeps the mint it
                  // has on the design board. Typed glyphs stay white.
                  isGhost && 'opacity-50',
                  isGhost && index < PREFIX_LENGTH
                    ? 'text-[color:var(--ci-mint)]'
                    : 'text-[color:var(--ci-ink)]',
                )}
              >
                {isSocket ? '' : (typed ?? placeholder[index] ?? '')}
              </span>
            </span>
          );
        })}
      </span>
      {isLast ? null : (
        <span
          aria-hidden
          className={cn(
            'h-[calc(2*var(--ci-u))] w-[var(--ci-dash-w)] shrink-0 rounded-[1px] bg-[color:var(--ci-mint-dash)]',
            // A dash that would land on the mobile wrap point joins nothing.
            breakAfter && 'max-md:hidden',
          )}
        />
      )}
      {/* Forces the mobile wrap so the row reads [L I][S X X] over
          [X X X][X X X], each dash staying inside its own line. */}
      {breakAfter ? <span aria-hidden className="h-0 w-full md:hidden" /> : null}
    </>
  );
}
