'use client';

/**
 * THE FEED'S SHARED RHYTHM — four columns, one figure edge, no seams.
 *
 * Activity and Transactions are NOT two row systems. They are the same
 * grid — marker · sentence · FIGURE · time — with a different marker and a
 * different sentence, which is the whole reason a fill reads the same in
 * both tabs and why `+0.005` lands on one edge down the page. That is a
 * property of the layout, so the layout lives in ONE module and both tabs
 * import it; a second copy of the template is a second edge waiting to
 * drift, and the sweep asserts the two edges are the same number.
 *
 * NO SEAM ANYWHERE. Rows are separated by ~54px of air (17px either side
 * of a 14px/1.45 line) and run bands by 30px more plus a quiet label. The
 * page keeps exactly one hairline, under the tab bar, and it is not drawn
 * here.
 *
 * THE FIGURE COLUMN IS FIXED, NOT AUTO, and it holds MOVEMENTS ONLY. The
 * numeral is the only 15.5px mono on the page and the only place `--up` /
 * `--down` are spent — a broker inks the number that moved. The ◎ beside
 * it stays the app's brand mark: `marks.tsx` gives up the lab's per-context
 * ink steps because a gradient cannot honour them, and one SOL logo that
 * changes colour per surface is not a logo.
 *
 * THE GROUP HEADERS STICK. A run band can be taller than the viewport, and
 * a reader scrolled into the middle of run 1 must still be told it is run
 * 1; the header takes the page's own ground so the rows pass under it.
 */

import type { ReactElement, ReactNode } from 'react';
import { SolMark } from '@/components/agent/proposal/v2/marks';
import type { FeedDelta, FeedMark } from './event-feed';

/**
 * The four columns, at the ribbon's own container width. Base is the
 * narrow case (the repo's plugin emits min-width only), and the step
 * restores the lab's 18/88/44 with its 12px gutters.
 */
export const FEED_GRID =
  'grid grid-cols-[16px_minmax(0,1fr)_72px_38px] items-center gap-x-[10px] ' +
  '@[430.02px]:grid-cols-[18px_minmax(0,1fr)_88px_44px] @[430.02px]:gap-x-[12px]';

/** ~54px: air, not seams. */
export const FEED_ROW = `${FEED_GRID} px-[2px] py-[17px]`;

export const FEED_SENTENCE =
  'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] leading-[1.45] ' +
  'tracking-[-.002em] text-[var(--ink-1)]';

/**
 * The one figure inside a sentence: a condition, never a movement.
 *
 * NO MONOSPACE. It was set in the mono face, so a row read as two fonts
 * arguing over one clause. Tabular figures in the page's own family line
 * up exactly as well and read as the same sentence.
 */
export const FEED_INLINE = 'text-[1em] font-semibold tabular-nums tracking-[-.014em]';

const MARK_PATHS: Readonly<Record<FeedMark, readonly string[]>> = {
  check: ['M2.1 6.35 4.85 9.1 9.9 3.3'],
  hold: ['M4.3 2.9V9.1', 'M7.7 2.9V9.1'],
  clock: ['M6 3.2V6H8.4'],
  stop: ['M3 6H9'],
  fail: ['M3.4 3.4 8.6 8.6', 'M8.6 3.4 3.4 8.6'],
  link: ['M5.1 3.7H3.7a2.3 2.3 0 0 0 0 4.6H5.1', 'M6.9 3.7H8.3a2.3 2.3 0 0 1 0 4.6H6.9', 'M4.7 6H7.3'],
  dot: ['M5.999 6h.002'],
};

/**
 * The row's marker: an 11px drawing on the card's own 12-unit grid, and
 * NOT a chip. The tinted 16px chip the shipped page used was a bounded
 * object doing a glyph's job, and P5-A2 deletes every bounded object on
 * this page except the one inside the card.
 */
export function FeedMarkGlyph({
  mark,
  hold = false,
}: {
  readonly mark: FeedMark;
  readonly hold?: boolean;
}): ReactElement {
  return (
    <span
      className={`grid h-[18px] w-[18px] flex-none place-items-center ${
        hold ? 'text-[var(--ink-0)]' : 'text-[var(--ink-2)]'
      }`}
      aria-hidden
      data-testid="cd-feed-mark"
      data-mark={mark}
    >
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        focusable="false"
        className="block h-[11px] w-[11px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap={mark === 'dot' ? 'round' : 'butt'}
        strokeLinejoin="miter"
      >
        {mark === 'clock' ? <circle cx="6" cy="6" r="4.55" /> : null}
        {(MARK_PATHS[mark] ?? []).map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    </span>
  );
}

/**
 * THE HERO. Right-aligned, fixed-width, 15.5px mono, inked `--up`/`--down`.
 * The numeral is its own element so it is one colour on one ground and the
 * page sweep can grade it; the mark beside it carries no text.
 */
export function FeedFigure({ delta }: { readonly delta: FeedDelta | null }): ReactElement {
  if (delta === null) return <span className="justify-self-end" aria-hidden />;
  return (
    <span
      className="flex items-baseline justify-self-end whitespace-nowrap"
      data-testid="cd-figure"
      data-direction={delta.direction}
    >
      <span
        className={`text-[15.5px] font-semibold tabular-nums tracking-[-.018em] ${
          delta.direction === 'up' ? 'text-[var(--up)]' : 'text-[var(--down)]'
        }`}
      >
        {delta.sign === '-' ? '−' : '+'}
        {delta.amount}
      </span>
      <SolMark className="pcv2-sol inline-block h-[.9em] w-[.9em] flex-none ml-[.24em] align-[-.09em] opacity-[.78]" />
    </span>
  );
}

/** The time whispers, on the page's own 24-hour local clock. */
export function FeedTime({ at }: { readonly at: string }): ReactElement {
  return (
    <span
      className="justify-self-end whitespace-nowrap text-right text-[11.5px] leading-[1.3] tabular-nums text-[var(--ink-3)]"
      data-testid="cd-feed-time"
    >
      {at}
    </span>
  );
}

/**
 * A run band's header: quiet sans in sentence case, its date on the right.
 * Spaced mono caps were decoration at this size — the run label is already
 * the loudest thing the band needs to say.
 */
export function FeedGroupHeader({
  title,
  date,
}: {
  readonly title: string;
  readonly date: string;
}): ReactElement {
  return (
    <div
      // The ground is BLACK, which is what the page is. It took
      // --surface, hsl(220 12% 3%), and every run band read as a grey
      // stripe laid across a black page.
      className="sticky top-0 z-[1] flex items-baseline gap-[12px] bg-black px-[2px] pb-[11px] pt-[10px]"
      data-testid="cd-feed-head"
    >
      {title === '' ? null : (
        <span className="text-[12.5px] font-medium leading-[1.3] tracking-[.002em] text-[var(--ink-2)]">
          {title}
        </span>
      )}
      {date === '' ? null : (
        <span className="ml-auto flex-none whitespace-nowrap text-[11.5px] leading-[1.3] text-[var(--ink-3)]">
          {date}
        </span>
      )}
    </div>
  );
}

/** The tab body: the ribbon's own container, so every step measures IT. */
export function FeedSection({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}): ReactElement {
  return (
    <section className="@container mt-[12px] flex min-w-0 flex-col" data-testid={testId}>
      {children}
    </section>
  );
}
