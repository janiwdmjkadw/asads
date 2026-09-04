import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { ORDER, type Condition, type ConditionIcon, type Leg } from './orderData';

/**
 * The card's shared pieces: marks, chips, amounts, condition rows.
 *
 * They live apart from both the whole card and the fragments so that
 * neither has to import the other. Three decisions in them are worth
 * calling out.
 *
 * MONO. The PNG is mint and red on a blue-black card, from the palette the
 * page has left. Buy and sell still have to be told apart instantly, so
 * the distinction moves from hue to WEIGHT: buy is a filled chip, sell is
 * an outlined one. That survives greyscale, projection and colour
 * blindness, which the original never did.
 *
 * REAL MARKUP. The card was a picture: it could not be recoloured, a
 * screen reader got one sentence of alt text, it cost ~83KB, and it went
 * soft on a retina display. This is text.
 *
 * THE DETAIL IS THE POINT. Every row in the PNG carries a glyph, the
 * cross-references to leg one are chips rather than words, units are set
 * smaller than the numbers they follow, and Details has a disclosure
 * chevron. Those are what make it read as a real order ticket instead of a
 * mock-up of one, so they are all here.
 *
 * TOKEN MARKS: SOL is the real Solana logo, official geometry and brand
 * gradient. The TAU avatar exists ONLY inside the PNG — it is not in the
 * export as a file — so it renders as a lettermark until the real asset is
 * dropped into `public/landing/img/`. See `AssetMark`.
 */

export const SANS = 'font-[family-name:var(--font-instrument-sans)]';
export const MONO = 'font-geist-mono';

/*
 * THE LABELS ARE SENTENCE CASE NOW.
 *
 * They were 10px, uppercase, at 0.16em tracking — When, Then, Settlement
 * chained, Decide within, all of them. Six shouted captions on a card
 * whose whole job is to be read calmly, and the loudest type treatment in
 * the product spent on its quietest words. It is also the single thing
 * that dates a fintech card: nothing has set a label that way since about
 * 2019.
 *
 * The DATA was never uppercase — see orderData.ts — so removing the
 * transform gives back the sentence case that was written all along.
 *
 * 12.5px, not 10. At 10px on a #0a0a0a card a label is a smudge, and the
 * tracking was there to compensate for a size that was too small.
 */
export const LABEL = `${SANS} text-[12.5px] leading-5 text-lp-ink-2`;


/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/* The three condition glyphs, drawn rather than imported: at 14px a
   borrowed icon set brings its own voice, and these only have to read as
   three different things. */
export function ConditionMark({ icon }: { icon: ConditionIcon }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden focusable="false" className="shrink-0">
      {icon === 'trend' ? (
        <>
          <path d="M1.8 9.8 5.2 6.2 7.6 8.2 12 3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 3.4H9.2M12 3.4v2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : null}
      {icon === 'link' ? (
        <>
          <path d="M5.9 8.1 8.1 5.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M7.6 4.4 8.8 3.2a2.3 2.3 0 0 1 3.2 3.2l-1.2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6.4 9.6 5.2 10.8A2.3 2.3 0 0 1 2 7.6l1.2-1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : null}
      {icon === 'clock' ? (
        <>
          <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7 4.2V7l2 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
    </svg>
  );
}

export /* The Solana mark as a MASK, not an inline <svg> with a gradient.
   
   The gradient version shipped `<linearGradient id="lp-sol">` inside every
   copy of the card, and this page renders the card up to three times — the
   desktop composition, the whole mobile card, and the mobile fragment. Ids
   are document-global, so all three `fill="url(#lp-sol)"` resolved to the
   FIRST definition, which at mobile widths sits inside the `hidden lg:flex`
   desktop block. A paint server inside a `display: none` subtree paints
   nothing, so the visible marks came out empty: laid out at 16×13, filled
   with air.

   Painting the gradient and punching the silhouette out of it with a mask
   has no ids at all, so it cannot collide however many times it renders.
   It is also exactly what the Listen mark in the header does. */
const SOL_SILHOUETTE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 397.7 311.7'%3E%3Cpath fill='%23000' d='M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z'/%3E%3Cpath fill='%23000' d='M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z'/%3E%3Cpath fill='%23000' d='M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z'/%3E%3C/svg%3E\")";

const SOL_MASK = {
  maskImage: SOL_SILHOUETTE,
  WebkitMaskImage: SOL_SILHOUETTE,
  maskSize: 'contain',
  WebkitMaskSize: 'contain',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
  maskPosition: 'center',
  WebkitMaskPosition: 'center',
} as const;

/**
 * A token mark.
 *
 * `sol` is the actual Solana mark — the official geometry on the brand
 * gradient. That gradient is the one exception to MONO on this page and it
 * is deliberate: a token mark recoloured is a token mark nobody
 * recognises, which defeats the point of putting it on the row.
 *
 * `tau` is the project's own avatar — a raster image that lives only
 * inside conditional-card.png and was never exported as a file — so it
 * falls back to a lettermark. Drop `tau.png` (or .svg) into
 * `public/landing/img/` and swap the fallback for an <img>.
 */
export function AssetMark({ mark, symbol }: { mark: 'sol' | 'tau'; symbol: string }) {
  if (mark === 'sol') {
    return (
      <span
        aria-hidden
        style={SOL_MASK}
        className="block h-[13px] w-4 shrink-0 bg-[linear-gradient(135deg,#00FFA3_0%,#03E1FF_50%,#DC1FFF_100%)]"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${SANS} grid size-[18px] shrink-0 place-items-center rounded-full bg-lp-ink-1 text-[9px] font-semibold leading-none text-lp-accent-ink`}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** Units set smaller and lighter than the number they follow, as in the PNG. */
export function Amount({ value, unit, className }: { value: string; unit?: string; className?: string }) {
  return (
    <span className={cn(SANS, 'font-medium tabular-nums text-lp-ink-1', className)}>
      {value}
      {unit ? <span className="text-[0.72em] text-lp-ink-2">{unit}</span> : null}
    </span>
  );
}

/** A cross-reference to another leg. A chip, not a word, exactly as the
    PNG has it — it is a pointer at an object on the same card. Its own
    margins carry the spacing, so the fragments around it never need to
    ship leading or trailing spaces that collapse in JSX. */
export function LegChip({ label }: { label: string }) {
  return (
    <span
      className={`${SANS} mr-1.5 inline-flex items-center rounded-[6px] bg-white/[0.06] px-1.5 py-0.5 align-[1px] text-[11.5px] leading-4 text-lp-ink-2`}
    >
      {label}
    </span>
  );
}

/**
 * One condition, and where it stands.
 *
 * The sentence is the target. `now` is the live figure beside it and
 * `progress` is the hairline track under it, and between them they are the
 * difference between a card that shows a rule and a card that shows a rule
 * BEING WATCHED. Market cap ≥ $5K says nothing about whether it is at
 * $200 or $4,900; `$4,180` with the track five sixths of the way across
 * says the whole thing at a glance.
 *
 * The track is 2px and it is the hairline colour until it is met. Nothing
 * on this card glows.
 */
export function ConditionRow({ condition, className }: { condition: Condition; className?: string }) {
  const pct = condition.progress === undefined ? null : Math.round(condition.progress * 100);
  return (
    <div className={cn(SANS, 'min-w-0', className)}>
      <div className="flex items-baseline gap-3 text-[15px] leading-5 text-lp-ink-1">
        <span className="relative top-[2px] shrink-0 text-lp-ink-2">
          <ConditionMark icon={condition.icon} />
        </span>
        <span className="min-w-0 flex-1">
          {condition.text.map((part, index) => {
            if (typeof part === 'string') return <span key={index}>{part}</span>;
            if ('chip' in part) return <LegChip key={index} label={part.chip} />;
            return <Amount key={index} value={part.value} unit={part.unit} />;
          })}
        </span>
        {condition.now ? (
          <span
            className={cn(
              'shrink-0 tabular-nums text-[12.5px] leading-5',
              condition.met ? 'text-lp-ink-1' : 'text-lp-ink-2',
            )}
          >
            {condition.now}
          </span>
        ) : null}
      </div>
      {pct === null ? null : (
        /* Capped. Stretched across a 640px row the track stops reading
           as a gauge and becomes an underline beneath the sentence; at
           200 it is an object beside the words, which is what a meter is. */
        <div className="mt-2 ml-[26px] h-[2px] w-full max-w-[200px] overflow-hidden rounded-full bg-white/[0.09]">
          <div
            className={cn('h-full rounded-full', condition.met ? 'bg-lp-ink-1' : 'bg-white/40')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function Side({ side }: { side: Leg['side'] }) {
  return (
    <span
      className={cn(
        `${SANS} inline-flex h-[26px] shrink-0 items-center rounded-[7px] px-2.5 text-[12.5px] font-semibold leading-none capitalize`,
        side === 'buy' ? 'bg-lp-ink-1 text-lp-accent-ink' : 'text-lp-ink-1 shadow-[inset_0_0_0_1px_rgba(245,245,245,0.22)]',
      )}
    >
      {side}
    </span>
  );
}

/**
 * The state on a row: Awaiting approval, Watching, Queued, Arms on
 * approval.
 *
 * IT IS NOT AN OBJECT ANY MORE. It was a 26px ringed rectangle with a
 * dot, and there are five of them on this card — five small outlined
 * things sitting beside the five rows they are labelling and competing
 * with them. A ring says "I am a control". None of these is a control.
 *
 * So there is no box, no plate, no ring and no dot. The state is text on
 * the right of its row, and the only thing that separates a state which is
 * HAPPENING from one that is waiting is how far back the ink is: full for
 * live, two steps back for pending. Nothing is added to the card that was
 * not already on it.
 */
export function Badge({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className={cn(`${SANS} shrink-0 text-[12.5px] leading-5`, live ? 'text-lp-ink-1' : 'text-lp-ink-3')}>
      {children}
    </span>
  );
}

