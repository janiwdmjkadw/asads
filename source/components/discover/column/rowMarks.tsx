/*
 * ── THE MARKS ON THE SECOND LINE ─────────────────────────────────────
 *
 * The artwork only — the paths and circles, not the `<svg>` around them.
 *
 * ── WHY THE WRAPPER STAYS BEHIND ─────────────────────────────────────
 *
 * These are drawn at one weight and one size on the row: a 24 viewBox, a
 * 1.7 stroke, 15.5px on screen. That is a property of the LINE, not of
 * any one mark — a line of marks drawn at different weights reads as a
 * line of unrelated things — so the row keeps its `Social` and `Glyph`
 * wrappers and this module ships only what goes inside them.
 *
 * It exists so the sheet on `/whatever` and the row itself cannot drift.
 * The sheet's whole job is judging these at the size they render at, and
 * a sheet holding its own copy of the paths is a sheet that eventually
 * shows a mark the product does not have.
 *
 * The crown carries `filled`, because it is the one solid mark in the
 * set: five points in outline at 15.5px is a row of spikes with gaps
 * between them, and the gaps end up being most of it.
 */

import type { ReactNode } from 'react';

export interface RowMark {
  readonly label: string;
  readonly art: ReactNode;
  /** Solid rather than outlined. The crown, and nothing else. */
  readonly filled?: boolean;
  /**
   * Only where it is not the usual `0 0 24 24`. The leaf is drawn a
   * pixel down its box, so it carries its own.
   */
  readonly viewBox?: string;
}

export const ROW2_MARKS = {
  /*
   * The audit leaf. It takes a tier — good, warn, bad — from
   * `.arc-leaf[data-tier]`, which is why it is the one mark here whose
   * colour is not decided by the line it sits on.
   */
  leaf: {
    label: 'Audit',
    viewBox: '0 1 24 24',
    art: (
      <path d="M19.5684 4.02051C18.7511 6.20255 17.9819 7.57497 17.2959 8.2627C16.9592 8.59935 16.6253 8.93286 16.292 9.2666L15.5859 9.97363L16.834 11.2217C15.7719 13.6999 13.2019 16.0647 9.87598 16.4805C8.32683 16.6741 7.0171 17.3162 6.00879 18.4248C5.1695 19.3477 4.58202 20.5479 4.20508 21.9727H4.18066C4.69129 18.959 5.50902 14.8051 7.6123 11.2295C9.7918 7.52452 13.3565 4.4315 19.5684 4.02051Z" />
    ),
  },
  cashback: {
    label: 'Cashback',
    filled: true,
    art: (
      <path d="M19.3788 15.1057C20.9258 11.4421 19.5373 7.11431 16.0042 5.0745C13.4511 3.60046 10.4232 3.69365 8.03452 5.0556L7.04216 3.31879C10.028 1.61639 13.8128 1.4999 17.0042 3.34245C21.4949 5.93513 23.2139 11.4848 21.1217 16.112L22.4635 16.8867L18.2984 19.1008L18.1334 14.3867L19.3788 15.1057ZM4.62961 8.89968C3.08263 12.5633 4.47116 16.8911 8.00421 18.9309C10.5573 20.4049 13.5851 20.3118 15.9737 18.9499L16.9661 20.6867C13.9803 22.389 10.1956 22.5055 7.00421 20.663C2.51357 18.0703 0.794565 12.5206 2.88672 7.89342L1.54492 7.11873L5.70999 4.90463L5.87505 9.61873L4.62961 8.89968ZM8.50421 14.0027H14.0042C14.2804 14.0027 14.5042 13.7788 14.5042 13.5027C14.5042 13.2266 14.2804 13.0027 14.0042 13.0027H10.0042C8.6235 13.0027 7.50421 11.8834 7.50421 10.5027C7.50421 9.122 8.6235 8.00271 10.0042 8.00271H11.0042V7.00271H13.0042V8.00271H15.5042V10.0027H10.0042C9.72807 10.0027 9.50421 10.2266 9.50421 10.5027C9.50421 10.7788 9.72807 11.0027 10.0042 11.0027H14.0042C15.3849 11.0027 16.5042 12.122 16.5042 13.5027C16.5042 14.8834 15.3849 16.0027 14.0042 16.0027H13.0042V17.0027H11.0042V16.0027H8.50421V14.0027Z" />
    ),
  },
  charity: {
    label: 'Charity coin',
    art: (
      <path d="M12.5836 3.8721C12.3615 3.99329 12.1665 4.11496 12 4.22818C11.8335 4.11496 11.6385 3.99329 11.4164 3.8721C10.6185 3.4369 9.45449 3 8 3C6.48169 3 4.96498 3.60857 3.83296 4.81606C2.69616 6.02865 2 7.78592 2 10C2 13.3448 4.37277 16.1023 6.58187 17.9272C7.71336 18.8619 8.86688 19.6065 9.7917 20.1203C10.2539 20.377 10.6687 20.5816 11.004 20.7253C11.1707 20.7967 11.3289 20.858 11.4705 20.9033C11.5784 20.9378 11.7841 21 12 21C12.2159 21 12.4216 20.9378 12.5295 20.9033C12.6711 20.858 12.8293 20.7967 12.996 20.7253C13.3313 20.5816 13.7461 20.377 14.2083 20.1203C15.1331 19.6065 16.2866 18.8619 17.4181 17.9272C19.6272 16.1023 22 13.3448 22 10C22 7.78592 21.3038 6.02865 20.167 4.81606C19.035 3.60857 17.5183 3 16 3C14.5455 3 13.3815 3.4369 12.5836 3.8721Z" />
    ),
  },
  feeSharing: {
    label: 'Fee sharing',
    art: (
      <>
        <path d="M4 12h5.4a3 3 0 0 0 2.5-1.3l1.6-2.4A3 3 0 0 1 16 7h4M11.9 13.3a3 3 0 0 0 2.5 1.3H20" />
        <path d="m17.4 4.4 2.6 2.6-2.6 2.6M17.4 12l2.6 2.6-2.6 2.6" />
      </>
    ),
  },
  boost: {
    label: 'Boosted',
    art: (
      <>
        <path d="M12 2.6c2.7 2 4.3 5.2 4.3 8.7v3.9l-2 2.2h-4.6l-2-2.2v-3.9c0-3.5 1.6-6.7 4.3-8.7z" />
        <path d="M7.7 10.6 5.2 13v3.4l2.5-1.5M16.3 10.6 18.8 13v3.4l-2.5-1.5" />
        <path d="M10.4 19.4c.5 1 1.1 1.7 1.6 2 .5-.3 1.1-1 1.6-2" />
      </>
    ),
  },
  account: {
    label: 'Account',
    art: (
      <>
        <circle cx="12" cy="7.5" r="4" />
        <path d="M5.5 20.5v-1.5a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5v1.5" />
      </>
    ),
  },
  website: {
    label: 'Website',
    art: (
      <>
        <circle cx="12" cy="12" r="8.6" />
        <path d="M3.4 12h17.2" />
        <path d="M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2z" />
      </>
    ),
  },
  telegram: {
    label: 'Telegram',
    art: (
      <>
        <path d="M21.2 3.6 2.9 10.4a.5.5 0 0 0 0 .95l4.6 1.6 1.7 5.2a.5.5 0 0 0 .87.18l2.5-2.8 4.5 3.3a.5.5 0 0 0 .78-.27l3.9-14.3a.5.5 0 0 0-.65-.6z" />
        <path d="m9.2 17.5.3-4.2 11.2-9.4-8.1 11.2" />
      </>
    ),
  },
  github: {
    label: 'GitHub',
    art: (
      <>
        <path d="M14.8 21v-3.2a2.9 2.9 0 0 0-.8-2.2c2.7 0 5.4-1.4 5.4-4.9a3.9 3.9 0 0 0-.9-2.7 3.6 3.6 0 0 0-.1-2.7s-.9 0-2.7 1.3a11.3 11.3 0 0 0-6 0C7.9 5.3 7 5.3 7 5.3a3.6 3.6 0 0 0-.1 2.7 3.9 3.9 0 0 0-.9 2.7c0 3.5 2.7 4.9 5.4 4.9a2.9 2.9 0 0 0-.8 2.2V21" />
        <path d="M10.6 18.6c-3.4 1.4-3.7-1.6-5.3-1.6" />
      </>
    ),
  },
  search: {
    label: 'Search the contract',
    art: (
      <>
        <circle cx="10.6" cy="10.6" r="6.4" />
        <path d="m15.3 15.3 4.5 4.5" />
      </>
    ),
  },
  holders: {
    label: 'Total holders',
    art: (
      <>
        <circle cx="9.6" cy="8.4" r="3.4" />
        <path d="M3.8 19.4v-1.1a4.2 4.2 0 0 1 4.2-4.2h3.2a4.2 4.2 0 0 1 4.2 4.2v1.1" />
        <path d="M16.6 6.1a3.3 3.3 0 0 1 0 6.2M18.2 14.3a4.2 4.2 0 0 1 2.4 3.8v1.3" />
      </>
    ),
  },
  migrations: {
    label: 'Dev migrations',
    filled: true,
    art: (
      <path d="M3.05 7.4a1.5 1.5 0 0 1 2.32 1.7l-.02.08 2.53 1.55 2.86-4.4a1.5 1.5 0 1 1 2.52 0l2.86 4.4 2.53-1.55-.02-.08a1.5 1.5 0 1 1 1.42.4L19.6 18.2a1 1 0 0 1-.99.85H5.39a1 1 0 0 1-.99-.85L2.95 9.5a1.5 1.5 0 0 1 .1-2.1z" />
    ),
  },
} as const satisfies Record<string, RowMark>;

export type Row2Key = keyof typeof ROW2_MARKS;

/* Render order on the row, so the sheet lists them in the order they are
   actually met rather than alphabetically. */
export const ROW2_ORDER: readonly Row2Key[] = [
  'leaf',
  'cashback',
  'charity',
  'feeSharing',
  'boost',
  'account',
  'website',
  'telegram',
  'github',
  'search',
  'holders',
  'migrations',
];
