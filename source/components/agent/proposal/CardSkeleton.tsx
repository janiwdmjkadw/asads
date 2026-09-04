/**
 * The Conditional Order card's GHOST — what stands where the card will be
 * while the turn is still streaming, the flag gate is still opening and
 * the card's own chunk is still arriving.
 *
 * WHY IT HAS ANATOMY. The reserve it replaces was three grey bars and 600
 * empty pixels, which reads as a hole in the thread rather than as a card
 * on its way; the owner reported it as "a mostly-blank tall box". A ghost
 * that echoes the real geometry — letterhead, two leg panels each with a
 * WHEN tile and a THEN tile, the settlement connector, the details row and
 * the footer — reads as the card arriving, and the swap moves nothing
 * because the pieces are already where the card's pieces go.
 *
 * WHY IT IS NOT IN `v2/`. This is the LOADING state for the v2 chunk. Living
 * in that chunk it could only appear after the chunk had arrived, which is
 * precisely when it is no longer wanted. It shares no module with the card
 * for the same reason, so the ghost costs the eager bundle its own markup
 * and nothing else.
 *
 * HEIGHT IS THE CONTRACT. `minHeightPx` is the caller's reserve — the real
 * card's measured height — and the anatomy is laid out to fill it rather
 * than to add to it, so the end-of-turn swap does not shove the thread.
 * The reveal's anchor maths is untouched.
 *
 * AND SINCE THE BUILD SEQUENCE, THE GHOST CAN BE TRUE (spec/30-creature
 * §3.5, "the skeleton must be built from the real leg count"). Handed a
 * `GhostPlan` read off the `propose_conditional` arguments, it draws the
 * REAL leg count, each leg's real condition-row count, the settlement cap
 * where the plan chains, each leg's rail in its real hue and the real verb
 * word — "the ghost keeps its identity, not just its geometry". No
 * min-height is wanted then: the geometry IS the height.
 *
 * Without a plan it is byte-for-byte the shipped two-leg ghost. That shape
 * is a guess, and it survives only where there is nothing better: the flag
 * off, and a payload this build cannot read.
 */

import { Fragment } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { GhostPlan } from '@/lib/agent/ghost-plan';
import { railHueFor } from './v2/rails';

/** The app's skeleton idiom: a quiet pulse on the box-depth grey. Reduced
 *  motion gets the same shapes, still. */
const GHOST = 'animate-pulse rounded bg-[var(--surface-3)] motion-reduce:animate-none';

const CARD =
  'w-full max-w-[458px] overflow-hidden rounded-[20px] border border-[var(--hairline)] bg-[var(--surface-1)]';
const PAD = 'px-[14px] @[344.02px]:px-[20px]';

/** The leg panel, exactly as the shipped ghost draws it. */
const LEG_PANEL =
  'relative overflow-hidden rounded-[14px] border border-[var(--hairline)] bg-[var(--surface-2)] pt-[12px] pr-[12px] pb-[13px] pl-[14px] @[344.02px]:pt-[13px] @[344.02px]:pr-[16px] @[344.02px]:pb-[15px] @[344.02px]:pl-[18px]';

/**
 * The 2px rail, as `ProposalCardV2`'s `PANEL` draws it — same pseudo,
 * same variable. §3.5's ghost keeps its IDENTITY, and the rail is the
 * leg's identity, so it renders in the leg's REAL hue rather than as a bar.
 */
const LEG_RAIL =
  "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-[var(--pcv2-rail)] before:content-['']";

/**
 * The verb word, in the card's own THEN-tile box — `soren-skin.ts`'s
 * `.pcv2-verb` geometry (20px, r4, glass rim and fill, mono 11/14 at
 * .06em) written out here because the skin's sheet ships inside the card's
 * chunk and the ghost stands where that chunk has not arrived. Every
 * colour reads the skin's variable FIRST and falls back to the measured
 * literal, so the two agree wherever both exist.
 */
const VERB_GHOST =
  'inline-flex h-[20px] flex-none items-center justify-center rounded-[4px] border border-[var(--pcv2-glass-rim,rgba(255,255,255,.10))] bg-[var(--pcv2-glass-fill,rgba(255,255,255,.06))] px-[7px] font-[family-name:var(--font-geist-mono)] text-[11px] font-medium leading-[14px] tracking-[.06em]';

/** The verbs' locked values (spec §3.5): `#4AC99B` buy · `#EA667D` sell. */
const VERB_INK: Readonly<Record<'buy' | 'sell', string>> = {
  buy: 'var(--pcv2-buy, #4AC99B)',
  sell: 'var(--pcv2-sell, #EA667D)',
};

/**
 * GHOST WEIGHT. The word is TRUE at act 2 — it is on the wire — but it is
 * not yet the card, so it wears the ghost's weight rather than the card's.
 */
const VERB_GHOST_OPACITY = 0.6;

/**
 * What the build sequence puts ON a condition row — a class, a delay and
 * the pellet that flew in with it (spec §3.5 beat 6).
 *
 * It decorates the row the ghost ALREADY draws; it never wraps it. The
 * row's box tree is therefore the same with the sequence and without it,
 * which is what lets the running→committed remount swap one ghost for the
 * other with nothing moving: the incoming ghost simply has no animation
 * to play, so every row is at rest the frame it mounts.
 */
export interface GhostRowMotion {
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Painted inside the row, absolutely, so it costs no layout. */
  readonly pellet?: ReactNode;
}

/** One leg panel: the tag/chip header, then the WHEN and THEN tiles. */
function LegGhost({
  rows,
  rail,
  verb,
  rowIndexBase,
  rowMotion,
}: {
  readonly rows: number;
  /** The leg's real rail hue; absent → the shipped railless ghost. */
  readonly rail?: string;
  /** The leg's real verb; absent → the shipped bar. */
  readonly verb?: 'buy' | 'sell' | null;
  /** This leg's first row's index DOWN THE CARD; absent → the shipped ghost. */
  readonly rowIndexBase?: number;
  readonly rowMotion?: (rowIndex: number) => GhostRowMotion;
}) {
  const railStyle = { '--pcv2-rail': rail } as CSSProperties;
  return (
    <section
      className={rail === undefined ? LEG_PANEL : `${LEG_PANEL} ${LEG_RAIL}`}
      data-testid="pcv2-skeleton-leg"
      {...(rail === undefined ? {} : { style: railStyle })}
    >
      <div className="mb-[11px] flex items-center justify-between gap-[12px]">
        <span className={`${GHOST} h-[11px] w-[38px]`} />
        <span className={`${GHOST} h-[19px] w-[92px] rounded-[6px]`} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-[14px] gap-y-[6px] @[420.02px]:grid-cols-[50px_minmax(0,1fr)] @[420.02px]:gap-y-0">
        <span className={`${GHOST} h-[11px] w-[36px] @[420.02px]:mt-[10px]`} />
        {/* The WHEN tile, with a row's worth of marker + sentence in it. */}
        <div className="rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-3)] px-[10px] py-[8px] @[420.02px]:px-[12px]">
          {Array.from({ length: rows }, (_, index) => {
            if (rowIndexBase === undefined) {
              return (
                <div key={index} className="flex items-center gap-[9px] py-[6px]">
                  <span className={`${GHOST} h-[16px] w-[16px] flex-none rounded-[5px]`} />
                  <span className={`${GHOST} h-[12px]`} style={{ width: index === 0 ? '72%' : '54%' }} />
                </div>
              );
            }
            const at = rowIndexBase + index;
            const motion = rowMotion?.(at);
            return (
              <div
                key={index}
                className={
                  motion?.className === undefined
                    ? 'relative flex items-center gap-[9px] py-[6px]'
                    : `relative flex items-center gap-[9px] py-[6px] ${motion.className}`
                }
                data-ghost-row={at}
                {...(motion?.style === undefined ? {} : { style: motion.style })}
              >
                {motion?.pellet}
                <span className={`${GHOST} h-[16px] w-[16px] flex-none rounded-[5px]`} />
                <span className={`${GHOST} h-[12px]`} style={{ width: index === 0 ? '72%' : '54%' }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-[10px] grid grid-cols-[minmax(0,1fr)] items-start gap-x-[14px] gap-y-[6px] @[420.02px]:grid-cols-[50px_minmax(0,1fr)] @[420.02px]:gap-y-0">
        <span className={`${GHOST} h-[11px] w-[36px] @[420.02px]:mt-[15px]`} />
        {/* The THEN tile: a verb chip, a figure, a token lockup. */}
        <div className="flex min-h-[41px] items-center gap-[7px] rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-3)] px-[10px] @[420.02px]:min-h-[44px] @[420.02px]:gap-[9px] @[420.02px]:px-[12px]">
          {verb === undefined || verb === null ? (
            <span className={`${GHOST} h-[21px] w-[44px] flex-none rounded-[7px]`} />
          ) : (
            <span
              className={VERB_GHOST}
              style={{ color: VERB_INK[verb], opacity: VERB_GHOST_OPACITY }}
              data-testid="pcv2-skeleton-verb"
              data-side={verb}
            >
              {verb === 'buy' ? 'BUY' : 'SELL'}
            </span>
          )}
          <span className={`${GHOST} h-[13px] w-[62px] flex-none`} />
          <span className={`${GHOST} h-[15px] w-[15px] flex-none rounded-full`} />
          <span className={`${GHOST} h-[13px] w-[40px] flex-none`} />
        </div>
      </div>
    </section>
  );
}

/** The settlement connector, drawn as the card draws it (`CHAIN*` in v2). */
const CHAIN = 'flex flex-col items-center py-[2px]';
const CHAIN_LINE = 'h-[10px] w-px bg-[var(--hairline-2)]';
/**
 * REAL TEXT, not a bar: §3.5 measures the cap as one of the three things
 * the ghost keeps whole (with the rails and the dividers), because it is
 * the plan's wiring rather than its content.
 */
const CHAIN_CAP =
  'py-[6px] text-[10px] uppercase leading-none tracking-[.14em] text-[var(--ink-2)] opacity-70';

export interface ProposalCardGhostProps {
  /** The reserve, in px — the real card's measured height. */
  readonly minHeightPx?: number;
  /**
   * The shape the wire already stated (`lib/agent/ghost-plan.ts`). With
   * one the ghost is TRUE and needs no reserve; without one it falls back
   * to the shipped two-leg guess.
   */
  readonly plan?: GhostPlan | null;
  /** The build sequence's per-row decoration; still ghosts, still true. */
  readonly rowMotion?: (rowIndex: number) => GhostRowMotion;
}

/** The row index each leg's first condition row carries down the card. */
export function ghostRowBases(plan: GhostPlan): number[] {
  const bases: number[] = [];
  let at = 0;
  for (const leg of plan.legs) {
    bases.push(at);
    at += leg.rows;
  }
  return bases;
}

/** Every condition row the plan will draw — the stagger's length. */
export function ghostRowCount(plan: GhostPlan): number {
  return plan.legs.reduce((total, leg) => total + leg.rows, 0);
}

export function ProposalCardGhost({ minHeightPx, plan, rowMotion }: ProposalCardGhostProps) {
  const bases = plan === undefined || plan === null ? [] : ghostRowBases(plan);
  return (
    <div
      className={`@container/pcv2 ${CARD}`}
      data-testid="agent-proposal-skeleton"
      data-skeleton="v2"
      aria-busy
      aria-label="Loading the conditional order"
      role="status"
      {...(minHeightPx === undefined ? {} : { style: { minHeight: minHeightPx } })}
    >
      <div className={`${PAD} flex items-center gap-[10px] border-b border-[var(--hairline)] py-[14px]`}>
        <span className={`${GHOST} h-[24px] w-[186px]`} />
        <span className={`${GHOST} ml-auto h-[19px] w-[118px] rounded-[6px]`} />
      </div>

      <div className={`${PAD} flex flex-col pt-[18px] pb-[20px]`}>
        {plan === undefined || plan === null ? (
          <>
            <LegGhost rows={2} />
            {/* The settlement connector, drawn as the card draws it. */}
            <div className="flex flex-col items-center py-[2px]" aria-hidden>
              <span className="h-[10px] w-px bg-[var(--hairline-2)]" />
              <span className={`${GHOST} my-[6px] h-[10px] w-[132px]`} />
              <span className="h-[10px] w-px bg-[var(--hairline-2)]" />
            </div>
            <LegGhost rows={2} />
          </>
        ) : (
          plan.legs.map((leg, index) => {
            // Leg 1 arms with the plan, so a cap above it would be the
            // ghost inventing wiring; the schema forbids it and the ghost
            // refuses it either way.
            const capped = leg.chained && index > 0;
            return (
              <Fragment key={index}>
                {capped ? (
                  <div className={CHAIN} aria-hidden data-testid="pcv2-skeleton-chain">
                    <span className={CHAIN_LINE} />
                    <span className={CHAIN_CAP}>Settlement-chained</span>
                    <span className={CHAIN_LINE} />
                  </div>
                ) : null}
                <LegGhost
                  rows={leg.rows}
                  rail={railHueFor(index, plan.legs[0]?.verb === 'buy')}
                  verb={leg.verb}
                  rowIndexBase={bases[index] ?? 0}
                  {...(rowMotion === undefined ? {} : { rowMotion })}
                />
              </Fragment>
            );
          })
        )}
      </div>

      <div className={`${PAD} flex items-center gap-[10px] border-t border-[var(--hairline)] py-[13px]`}>
        <span className={`${GHOST} h-[11px] w-[11px] rounded-[3px]`} />
        <span className={`${GHOST} h-[13px] w-[58px]`} />
        <span className={`${GHOST} ml-auto h-[19px] w-[72px] rounded-[var(--r-chip)]`} />
        <span className={`${GHOST} h-[19px] w-[86px] rounded-[var(--r-chip)]`} />
      </div>

      <div className={`${PAD} flex items-center gap-[16px] border-t border-[var(--hairline)] pt-[13px] pb-[14px]`}>
        <span className={`${GHOST} h-[15px] w-[112px]`} />
        <span className={`${GHOST} ml-auto h-[36px] w-[86px] rounded-[11px]`} />
        <span className={`${GHOST} h-[36px] w-[96px] rounded-[11px]`} />
      </div>
    </div>
  );
}
