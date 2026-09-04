/**
 * The order card, in pieces.
 *
 * Desktop shows the card whole with the reasoning out in the margin.
 * Mobile has no margin to put anything in, so it INTERLEAVES instead: a
 * note, then the piece of the order that note is about, then the next
 * note. Same content and the same components, read top to bottom instead
 * of left to right.
 *
 * These fragments render their INNER content only — no surface, no
 * padding. Whoever composes them owns that, which is what lets the whole
 * card put four of them in one box while the mobile stack gives each its
 * own.
 */
import { cn } from '@/lib/utils';
import { Countdown } from './Countdown';
import { ORDER, type Leg } from './orderData';
import { Amount, AssetMark, Badge, ConditionRow, LABEL, MONO, SANS, Side } from './parts';

/**
 * THE CARD'S OWN STATUS SITS OPPOSITE THE TITLE, and the LEG states sit
 * under their leg names. That is not an inconsistency, it is the two
 * things being different sizes.
 *
 * The card head is the full width of the card. A 21px title alone in it
 * leaves the entire right half empty, and the head is the first thing
 * anybody looks at, so the card opens on a gap. Stacked under the title
 * the status read correctly and the head read half finished.
 *
 * A leg head is a smaller thing inside a row of other things, and there
 * the right edge already has work to do, which is why the same move that
 * empties the card head fills the leg head.
 *
 * What makes the status work over there now is that it is no longer an
 * object: no ring, no plate, no dot, just ink two steps back. See
 * `Badge` in parts.tsx. The chip was the problem, not the position.
 */
export function CardHead({ className, armed = false }: { className?: string; armed?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className={`${SANS} text-[21px] font-semibold leading-none tracking-[-0.028em] text-lp-ink-1`}>
        {ORDER.title}
      </span>
      <Badge live={armed}>{armed ? ORDER.statusArmed : ORDER.status}</Badge>
    </div>
  );
}

export function LegHead({
  leg,
  className,
  armed = false,
  chained = false,
}: {
  leg: Leg;
  className?: string;
  armed?: boolean;
  chained?: boolean;
}) {
  /*
   * BEFORE APPROVAL, LEG 1 SAYS NOTHING.
   *
   * It used to say "Arms on approval", directly under a card head already
   * reading "Awaiting approval". That is the same fact twice, in the two
   * places a reader looks first, and it was the longest of the three
   * states. Three states on one card were never three pieces of
   * information; they were two and an echo.
   *
   * Leg 2 keeps "Queued", because that one says something the head does
   * not: this leg is behind the other one. Once the order is armed both
   * legs speak again, and then they are saying different things —
   * Watching against Queued — which is the point at which two states
   * earn their place.
   */
  const state = armed ? leg.armedState : chained ? leg.state : null;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className={`${SANS} text-[14px] font-semibold leading-none tracking-[-0.01em] text-lp-ink-1`}>{leg.name}</span>
      {state ? <Badge live={armed && leg.armedState === 'Watching'}>{state}</Badge> : null}
    </div>
  );
}

/* The label sits ABOVE its value below `lg` and beside it above.
   
   A fixed 44px label column costs 13% of a 340px card, which is what was
   pushing the Then row into a second line and making the whole card feel
   cramped. Stacking gives that width back to the content, where it is
   actually needed; at desktop the column is free and reads better.
   
   ── NO MORE TUBS ───────────────────────────────────────────────────
   
   Every row used to sit in its own `rounded-xl bg-white/[0.04]` panel,
   inside a bordered leg box, inside the card. Three levels of rounded
   container for one line of text apiece, which is exactly what makes a
   card read as chopped: nothing is a surface, everything is a tray.
   
   A row is a row now. Hairlines separate them, the card is the only
   surface, and the space that was going into padding four nested boxes
   goes into the rhythm between the lines instead. */
const ROW = 'flex flex-col gap-1.5 py-3.5 lg:flex-row lg:items-baseline lg:gap-5 lg:py-4';
const ROW_LABEL = 'lg:w-12 lg:shrink-0';
/* The same column, unconditionally: the seam uses it at every width so
   its glyph sits where every row's label sits. */
const ROW_LABEL_STATIC = 'w-12 shrink-0';

export function WhenRow({ leg, className }: { leg: Leg; className?: string }) {
  return (
    <div className={cn(ROW, className)}>
      <span className={cn(LABEL, ROW_LABEL)}>When</span>
      <ConditionRow condition={leg.when} className="flex-1" />
    </div>
  );
}

export function EitherRows({ leg, className }: { leg: Leg; className?: string }) {
  if (!leg.either) return null;
  return (
    <div className={cn(ROW, className)}>
      {/* Holds the label column open at desktop so the panel lines up with
          the When row above it; contributes nothing on mobile. */}
      <span aria-hidden className={cn('hidden', ROW_LABEL, 'lg:block')} />
      {/*
        A FORK, DRAWN.
        
        These two conditions are an OR: either one satisfies the leg. As a
        stack of rows under a caption that is a claim the reader has to
        take on faith, so the branch is drawn — a trunk down the left that
        splits into a stub at each condition, which is the shape an OR
        actually has.
        
        The trunk stops at the LAST branch rather than running to the
        bottom of the box: a line that carries on past the last thing it
        connects to reads as an edge, not as a connector. Its height is
        `100% - (100 / 2n)%`, which is exactly the centre of the final row
        for any number of branches.
      */}
      <div className="min-w-0 flex-1">
        <div className={`${SANS} pb-1 text-[12.5px] leading-5 text-lp-ink-2`}>{ORDER.eitherLabel}</div>
        <div className="relative pl-6">
          <span
            aria-hidden
            className="absolute left-0 top-0 w-px bg-lp-hairline"
            style={{ height: `calc(100% - ${100 / (2 * leg.either.length)}%)` }}
          />
          {leg.either.map((condition, index) => (
            <div key={index} className="relative py-2.5">
              {/* NO NODE WHERE THE BRANCH LANDS.

                  There was a hollow 7px circle here, and it was the thing
                  making the fork look chopped: the stub had to stop short
                  to leave room for it, so what should read as one line
                  from the trunk to the condition read as a short dash,
                  then a gap, then a bead. The stub runs the whole 24px to
                  the row now and the branch is a single unbroken line.

                  The one dot left on this card is the one on the armed
                  row, which is a different job: that one says something is
                  happening, and it is the only place it is said. */}
              <span aria-hidden className="absolute -left-6 top-[19px] h-px w-6 bg-lp-hairline" />
              <ConditionRow condition={condition} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * THE ACTION, AND WHAT IT COSTS.
 *
 * It read `Buy 5 ◎ — TAU ⓣ`: a chip, a bare number, the Solana mark, an
 * em dash, the symbol and a lettermark. Six objects on one line, and the
 * dash in the middle had to be decoded as "becomes". The one thing a
 * person actually wants off that row — what the trade costs — was the
 * thing it did not say.
 *
 * It is the side, the amount and the asset, and then the consideration in
 * the SAME right hand column every When row already uses for its live
 * figure. That column is what turns four loose rows into a table you can
 * read down.
 */
export function ThenRow({ leg, className }: { leg: Leg; className?: string }) {
  return (
    <div className={cn(ROW, className)}>
      <span className={cn(LABEL, ROW_LABEL)}>Then</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <Side side={leg.side} />
        <span className="flex min-w-0 items-baseline gap-1.5">
          <Amount value={leg.size.value} unit={leg.size.unit} className="text-[15px] leading-5" />
          <span className={`${SANS} text-[15px] font-semibold leading-5 text-lp-ink-1`}>{leg.asset.symbol}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className={`${SANS} text-[12.5px] leading-5 text-lp-ink-3`}>{leg.consideration.label}</span>
          {leg.consideration.mark ? <AssetMark mark={leg.consideration.mark} symbol="SOL" /> : null}
          <span className={`${SANS} tabular-nums text-[12.5px] leading-5 text-lp-ink-2`}>
            {leg.consideration.value}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * THE SEAM BETWEEN THE LEGS.
 *
 * It was a hairline with two words punched out of the middle of it,
 * floating between two blocks. A centred caption is the weakest object a
 * card can have: it belongs to neither thing it sits between, it lines up
 * with nothing, and `Settlement chained` on its own never said what it
 * meant.
 *
 * It is a band now, full width of the card, with a hairline top and
 * bottom and the faintest possible ground. It carries an arrow, the two
 * words, and the clause that explains them — and it lines up with the
 * label column every other row uses, so it reads as part of the document
 * rather than as a gap in it.
 *
 * `surface` is kept for callers that place it on a different ground.
 */
export function ChainDivider({ className }: { className?: string; surface?: string }) {
  return (
    <div
      className={cn(
        'relative flex items-start gap-3 border-y border-lp-hairline bg-white/[0.025] py-3.5',
        className,
      )}
    >
      {/* Left aligned, not centred: every label in the column starts at
          its left edge, and a glyph centred in the same column sits
          twenty pixels off the line they all share. */}
      <span aria-hidden className={cn('flex shrink-0 justify-start text-lp-ink-2', ROW_LABEL_STATIC)}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" focusable="false">
          <path d="M7 2v10M3.4 8.6 7 12.2l3.6-3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {/* The clause sits UNDER the words, not beside them.
      
          Beside them it was guarded with `sm:`, which is a VIEWPORT query
          — and the card is 500 wide inside a 1600 window, so the guard
          passed and the clause squeezed in anyway, wrapping "Settlement
          chained" onto two lines. A card that has to be laid out against
          its own width cannot be laid out against the window's. Stacking
          needs no query at all and reads the same at 500 and at 900. */}
      <span className="min-w-0">
        <span className={`${SANS} block text-[13px] font-medium leading-5 text-lp-ink-1`}>{ORDER.chain}</span>
        <span className={`${SANS} mt-0.5 block text-[12.5px] leading-5 text-lp-ink-2`}>{ORDER.chainNote}</span>
      </span>
    </div>
  );
}

export function DetailsRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {/* NO CHEVRON. It promised a disclosure that does not open, which
          on a card nobody can click is an invitation to try. The row is a
          caption over two facts now, not a control. */}
      <span className={`${SANS} shrink-0 text-[13px] leading-none text-lp-ink-3`}>{ORDER.detailsLabel}</span>
      <div className="flex gap-2">
        {ORDER.meta.map((chip) => (
          <span
            key={chip.value}
            className={`${SANS} rounded-[7px] bg-white/[0.06] px-2.5 py-1.5 text-[11.5px] leading-none text-lp-ink-2`}
          >
            {chip.value}
            {chip.unit ? <span className="text-[0.85em]">{chip.unit}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * THE ONE THING ON THIS PAGE YOU CAN ACTUALLY DO.
 *
 * Approve works. The card is not a screenshot of an order waiting for
 * approval; it is an order waiting for approval, and pressing the button
 * arms it — the status badge flips, leg one starts watching, the timer
 * goes, and the row says what happened. Undo puts it back, so it can be
 * played more than once.
 *
 * DECLINE DOES NOT. It is drawn because the real card has it and an
 * approval with no refusal beside it is not a decision, but it carries
 * `aria-disabled` and takes no hover, so it reads as part of the picture
 * rather than as a control that is broken. A landing page gets to
 * demonstrate one gesture, and it should be the one the product is for.
 */
export function DecisionRow({
  className,
  armed = false,
  onApprove,
  onUndo,
}: {
  className?: string;
  armed?: boolean;
  onApprove?: () => void;
  onUndo?: () => void;
}) {
  if (armed) {
    return (
      <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
        <span className={`${SANS} flex items-center gap-2.5 text-[13.5px] leading-5 text-lp-ink-1`}>
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-lp-ink-1" />
          {ORDER.armedNote}
        </span>
        <button
          type="button"
          onClick={onUndo}
          className={`${SANS} h-9 rounded-[10px] px-3.5 text-[13px] leading-none text-lp-ink-2 transition-colors duration-200 ease-in-out hover:bg-[var(--lp-hover)] hover:text-lp-ink-1`}
        >
          Undo
        </button>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <span className={LABEL}>
        Decide within{' '}
        <Countdown from={ORDER.decideWithin} className={`${MONO} ml-1 text-[15px] tracking-normal text-lp-ink-1`} />
      </span>
      <div className="flex items-center gap-2.5">
        <span
          aria-disabled="true"
          className={`${SANS} flex h-10 cursor-default select-none items-center rounded-[10px] px-5 text-[13.5px] leading-none text-lp-ink-3 shadow-[inset_0_0_0_1px_rgba(245,245,245,0.14)]`}
        >
          Decline
        </span>
        <button
          type="button"
          onClick={onApprove}
          className={`${SANS} h-10 rounded-[10px] bg-lp-cta px-6 text-[13.5px] font-semibold leading-none text-lp-accent-ink transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_6px_20px_-6px_rgba(255,255,255,0.4)] active:translate-y-0 active:shadow-none`}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
