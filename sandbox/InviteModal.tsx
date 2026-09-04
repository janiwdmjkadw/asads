'use client';

import { useRef, useState, type ClipboardEvent, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * The invite code sheet.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────
 *
 * Variant 25 off the sheet of forty: a dark band across the top carrying
 * the mark, a bare field at 46px under it, and one full width control.
 * Nothing else on the card.
 *
 * ── THE BAND IS THE POINT ────────────────────────────────────────────
 *
 * It gives the card an ISSUER. Every other version was a form that
 * appeared over a page; this one is a thing that was sent to you, and the
 * band is what does that in one strip. It is #0A0A0A, the same ink surface
 * the conditional order card uses, so the material is the product's own.
 *
 * ── AND THE FIELD IS NOT AN OBJECT ───────────────────────────────────
 *
 * No box, no rule, no seven cells. The code is set at 46px in the card's
 * own type, so the thing you are typing is the largest thing on the card
 * and there is no second rectangle competing with the band above it.
 *
 * The tracking is what makes seven characters countable, which was the
 * only job the boxes were doing. It is not monospace: Geist Mono slashes
 * its zero, and on an invite code a slashed zero gets read back as a
 * letter over a call.
 *
 * ── ONE INPUT, NOT SEVEN ─────────────────────────────────────────────
 *
 * The earlier segmented build needed focus hand carried between seven
 * boxes on every keystroke, backspace to jump backwards at a boundary,
 * paste split by hand, and it gave password managers somewhere to dump the
 * whole code. One field gets all of that from the browser.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

/*
 * THE SHEET DECLARES ITS OWN INK, and it is not optional.
 *
 * `tokens.css` still describes the page that was cleared: `--lp-ink-1` on
 * `.lp` is #f5f5f5, white, for a black ground. Every band on the rebuilt
 * page overrides the scale locally, and this sheet is a SIBLING of
 * `<LandingPage/>` rather than a child of any band, so without this it
 * inherits the black page's scale and paints white ink on white paper with
 * a white button under a white label. Nothing visible, and nothing thrown.
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

/** Codes this product issues: seven characters, upper case and digits. */
const LENGTH = 7;
const ALLOWED = /[^A-Z0-9]/g;

/*
 * THE MARK, AS THE FOUR PATHS IT ACTUALLY IS.
 *
 * Taken verbatim from `public/landing/svg/mark.svg`. The first build of
 * this band carried ONE of them, the outer swoop, which is the least
 * recognisable part of the mark on its own: no eyes, no head, just a
 * curve. It read as a generic swoosh, which is exactly what a logo must
 * never do.
 *
 * The file's own fills are orange to red gradients. Here it is flat white,
 * because the band is ink and the mark is the only thing on it.
 */
const MARK_PATHS: readonly string[] = [
  'M317.5 452C307.5 403.2 329.333 376 341.5 368.5C381.5 362.5 423.667 432.833 438 469.5C439.2 518.7 395.667 523.167 374.5 518.5C339.3 513.7 321.833 472.167 317.5 452Z',
  'M699.5 466C715.9 405.2 694.333 375.333 681.5 368C652.7 361.6 618.167 407.667 604.5 431.5C565.3 486.3 593.167 511 612 516.5C664.8 531.3 692.333 489 699.5 466Z',
  'M541.5 585C535.9 589.4 512 748.5 512 748.5C488.4 596.5 450.833 484.167 435 447C400.2 377 299.167 300.167 253 270.5C329.4 290.1 380.5 332 396.5 350.5C420.9 375.3 445.667 404.833 455 416.5C477.4 454.1 502.333 513.5 512 538.5C516.4 516.9 546.833 458.167 561.5 431.5C605.5 374.5 602.5 373.5 655 332C697 298.8 745.167 290.833 764 291C728 301.5 716.5 320.5 712.5 319.5C708.5 318.5 654 355.5 620.5 399C587 442.5 590 444.5 568 493.5C546 542.5 548.5 579.5 541.5 585Z',
  'M562 880L573.5 935.5L297 710C138.6 585.6 132 422.167 148.5 356C206.1 124.4 429.833 79.8333 534.5 86.4999C710.9 105.7 801 214.167 824 266C699.6 82.8 491.167 108 402.5 143.5C189.3 219.5 180.333 399.167 202.5 479.5C246.5 622.7 429.167 757.167 515 806.5L645 710C756.6 624.8 802.833 520.833 812 479.5C854.4 283.1 753.667 264.333 698 279.5C843.2 205.1 882.833 362.5 884.5 450.5C880.1 590.9 695.333 758.333 603.5 824.5C565.9 847.7 560.167 871.167 562 880Z'
];

export interface InviteModalProps {
  /** Seeds the field. Anything past the length is dropped. */
  code?: string;
  className?: string;
}

export function InviteModal({ code = '', className }: InviteModalProps) {
  const [value, setValue] = useState(() => code.toUpperCase().replace(ALLOWED, '').slice(0, LENGTH));
  const ref = useRef<HTMLInputElement | null>(null);

  const take = (raw: string): void => setValue(raw.toUpperCase().replace(ALLOWED, '').slice(0, LENGTH));
  const complete = value.length === LENGTH;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invite code"
      style={LIGHT}
      className={cn(
        /* The order card's radius, the page's hairline as an inset ring,
           and the shadow that lifts it off a ground it shares a colour
           with. `overflow-hidden` is what lets the band meet the corners. */
        'w-full max-w-[560px] overflow-hidden rounded-[20px] bg-white',
        'shadow-[inset_0_0_0_1px_rgba(11,11,11,0.10),0_40px_90px_-30px_rgba(11,14,20,0.45)]',
        className,
      )}
    >
      {/*
        ── THE BAND ────────────────────────────────────────────────────

        The mark and the name, and nothing else on it.

        NO SCARCITY. It carried "Invitation 088" and then "88 of 500 left",
        and both were wrong for the same reason: this is not a limited
        drop. Putting a countdown on it tells somebody they are competing
        for a place that is not actually being rationed, which is a claim
        the product does not make anywhere else.
      */}
      <div className="flex items-center gap-[11px] bg-[#0a0a0a] px-6 py-4 text-[#f5f5f5]">
        <svg viewBox="0 0 1024 1024" width="22" height="22" fill="none" aria-hidden>
          {MARK_PATHS.map((d) => (
            <path key={d.slice(0, 18)} d={d} fill="currentColor" />
          ))}
        </svg>
        <span className={`${SANS} text-[14px] font-semibold leading-none tracking-[-0.01em]`}>Listen</span>
      </div>

      <div className="px-7 pb-8 pt-7 lg:px-8">
        {/*
          THE FIELD.

          Bare: no box, no rule. At 46px the code is the largest thing on
          the card, which is the whole reason the band above it can be as
          strong as it is.
        */}
        <label className="block">
          <span className={`${SANS} block text-[13px] leading-5 text-lp-ink-3`}>Enter your invite code</span>
          <input
            ref={ref}
            value={value}
            onChange={(e) => take(e.target.value)}
            onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
              /* Taken by hand so a code pasted with its dashes or spaces
                 still lands: the strip has to run before the length cap. */
              e.preventDefault();
              take(e.clipboardData.getData('text'));
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={LENGTH}
            placeholder="LIS4K29"
            aria-label={`Invite code, ${LENGTH} characters`}
            className={cn(
              `${SANS} mt-2 block h-[1.4em] w-full border-0 bg-transparent p-0 text-lp-ink-1 outline-none`,
              'text-[clamp(30px,7vw,46px)] font-medium tracking-[0.07em]',
              'placeholder:text-[#c8c8cd]',
            )}
          />
        </label>

        <button
          type="button"
          disabled={!complete}
          className={cn(
            `${SANS} mt-6 h-12 w-full rounded-full bg-lp-ink-1 text-[15px] font-medium leading-none text-white`,
            'transform-gpu will-change-transform transition-[transform,box-shadow,opacity] duration-200 ease-in-out',
            complete
              ? 'hover:-translate-y-px hover:shadow-[0_8px_28px_-10px_rgba(11,11,11,0.55)] active:translate-y-0 active:shadow-none'
              : 'cursor-default opacity-25',
            FOCUS,
          )}
        >
          Redeem
        </button>

        <p className={`${SANS} mt-4 text-[13px] leading-5 text-lp-ink-3`}>
          {complete ? 'Ready to redeem.' : `${LENGTH - value.length} characters to go.`}
        </p>
      </div>
    </div>
  );
}
