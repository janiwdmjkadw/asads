import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * The invite code modal, remade in the page's own materials.
 *
 * ── WHAT IT WAS ──────────────────────────────────────────────────────
 *
 * A near black sheet under a 72% scrim, with a tracked uppercase mono
 * eyebrow reading INVITATION, the code set in Geist Mono at 54px, and a
 * second tracked uppercase line reading 4 CHARACTERS TO GO · 088
 * REMAINING. It was built against a landing page that was black, and that
 * page does not exist any more.
 *
 * ── WHAT CHANGED, AND WHY EACH ───────────────────────────────────────
 *
 * IT IS PAPER. Every band behind it is white now, so a black sheet is the
 * only dark object on the page, arriving at the moment somebody is being
 * asked to type. The sheet is the page's own surface and the ink is the
 * page's own ink.
 *
 * SENTENCE CASE, BOTH OF THEM. Two tracked uppercase blocks on a panel
 * with four elements in it was most of the panel shouting. The eyebrow is
 * now the same 13.5px quiet line every band on the page opens with.
 *
 * NO MONOSPACE. The code was Geist Mono, which slashes its zero, and an
 * invite code is exactly the string where a slashed zero gets read back as
 * a letter. It is Instrument Sans with 0.16em of tracking instead: the
 * tracking is what makes the characters countable, which is the only job
 * the mono was doing.
 *
 * THE SCRIM CAME BACK UP. It was `rgba(0,0,0,0.72)`, argued for because a
 * near black sheet cannot hold itself against a half dim. A white sheet
 * has the opposite problem, so it is 46% with a blur behind it, the same
 * treatment the header bar uses. The page stays legible underneath, which
 * is the point of putting the sheet over it rather than on a route.
 *
 * ── TWO COMPOSITIONS, hard seam at `lg`, matching the rest of the page ─
 *
 * The code is the measurement that decides it. At 52px with tracking the
 * row runs past a 390 viewport once the gutters and padding are out, so it
 * steps to 30. The caret and the waiting dots step with it, or they stop
 * reading as part of the same line.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

/*
 * THE SHEET DECLARES ITS OWN INK, and it is not optional.
 *
 * `tokens.css` still describes the page that was cleared: `--lp-ink-1` on
 * `.lp` is #f5f5f5, white, for a black ground. Every band on the rebuilt
 * page overrides the scale locally, which is why they all look right —
 * and this sheet is a SIBLING of `<LandingPage/>` rather than a child of
 * any band, so it inherited the black page's scale and painted white ink
 * on white paper with a white button under a white label. Nothing was
 * visible and nothing threw.
 *
 * Same six values every band declares. When tokens.css finally follows the
 * page light, this block and theirs go together.
 */
const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
  '--lp-hover': 'rgba(11, 11, 11, 0.06)',
} as CSSProperties;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lp-ink-1 focus-visible:ring-offset-2 focus-visible:ring-offset-lp-ground';

export interface InviteModalProps {
  /** What has been typed so far. */
  code?: string;
  /** How many characters are still expected. */
  remaining?: number;
  /** How many invites are left in the batch. */
  left?: number;
  className?: string;
}

export function InviteModal({ code = 'LIS4K29', remaining = 4, left = 88, className }: InviteModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite code"
      style={LIGHT}
      className={cn(
        /* The page's own paper, and the card radius the order card uses.
           The ring is the hairline every divider on the page is drawn in;
           the shadow is what lifts it off a ground it shares a colour
           with, which a black sheet never had to solve. */
        'w-full max-w-[620px] rounded-[20px] bg-white',
        'shadow-[inset_0_0_0_1px_rgba(11,11,11,0.10),0_40px_90px_-30px_rgba(11,14,20,0.45)]',
        'px-6 py-9 lg:px-12 lg:py-12',
        className,
      )}
    >
      {/* The same quiet opener every band on the page has: sentence case,
          13.5px, third ink. Not a label in small caps. */}
      <p className={`${SANS} text-[13.5px] leading-5 text-lp-ink-3`}>Invitation</p>

      <p
        className={`${SANS} mt-3 text-[26px] font-semibold leading-[1.12] tracking-[-0.03em] text-lp-ink-1 lg:mt-4 lg:text-[34px] lg:tracking-[-0.035em]`}
      >
        Enter your invite code
      </p>

      {/*
        The code.

        `break-all` is the guard for a longer code than this product
        issues: it wraps inside the panel rather than pushing the sheet
        wider than the viewport. The trailing tracking is trimmed with a
        negative margin, because letter spacing adds a gap after the LAST
        character too and without that the caret sits adrift of the code
        it belongs to.
      */}
      <p
        className={`${SANS} mt-7 break-all text-[30px] font-medium leading-none tracking-[0.16em] text-lp-ink-1 lg:mt-9 lg:text-[52px]`}
      >
        <span className="-mr-[0.16em]">{code}</span>
        <span
          aria-hidden
          className="mx-[0.16em] inline-block h-[0.82em] w-[2px] translate-y-[0.1em] bg-lp-ink-1 lg:w-[3px]"
        />
        <span className="text-lp-ink-3">{'·'.repeat(remaining)}</span>
      </p>

      {/* Stacked and full width on a phone, inline at `lg`. */}
      <div className="mt-8 flex flex-col items-stretch gap-4 lg:mt-10 lg:flex-row lg:items-center lg:gap-6">
        {/* The page's one filled control, the same object Rewards and
            Agent use: ink fill, paper label, and it lifts a pixel rather
            than changing shade. */}
        <button
          type="button"
          className={cn(
            `${SANS} h-12 w-full shrink-0 rounded-full bg-lp-ink-1 px-7 text-[15px] font-medium leading-none text-white lg:w-auto`,
            'transform-gpu will-change-transform transition-[transform,box-shadow] duration-200 ease-in-out hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none',
            FOCUS,
          )}
        >
          Redeem
        </button>

        {/* Two facts, and they are about different things: one is about
            what you are typing, the other about the batch. A middot
            between them said they were the same kind of fact. */}
        <p className={`${SANS} text-center text-[13.5px] leading-5 text-lp-ink-3 lg:text-left`}>
          {remaining} characters to go.
          <br className="hidden lg:block" /> {left} invites left in this batch.
        </p>
      </div>
    </div>
  );
}
