/**
 * THE BURGER MENU. No `'use client'` on this file.
 *
 * A VALUE imported out of a `'use client'` module into a server component
 * arrives as a client reference proxy, so `.map` throws and the route
 * 500s. That has cost this project three 500s already.
 *
 * ── WHAT IT HAS TO CARRY ─────────────────────────────────────────────
 *
 * Who you are, where you can go, what you can do, and the way out. The
 * avatar came off the bar below 800 and took Edit profile, Account and
 * security and Sign out with it, so this is the only route to any of
 * them on a phone.
 *
 * ── TWO ──────────────────────────────────────────────────────────────
 *
 * Earlier rounds were six drawers that were all the same drawer: a column
 * of icon-and-label rows, differing in whether the row had a number on
 * it, a line under it, or a blur behind it.
 *
 * Two, and they disagree about one thing: where the wallet goes.
 *
 *   command  a field that asks and searches, wallet at the foot
 *   vault    the balance IS the header, navigation under it
 *
 * Black, white and grey in both. Whatever they have to say is said with
 * hierarchy, spacing and weight.
 */

export type BurgerKind = 'command' | 'vault';

export const BURGER_KINDS: readonly BurgerKind[] = ['command', 'vault'];

export const BURGER_TITLES: Record<BurgerKind, string> = {
  command: 'Command',
  vault: 'Wallet first',
};

export const BURGER_NOTES: Record<BurgerKind, string> = {
  command:
    'One field that asks and searches, with Soren’s face as its mark — the white slab above the list is gone, and so is the second control doing half the same job. Type and the list narrows; type something that names no page and the row offering to ask him is the result. The wallet takes the foot, which is where eighty pixels of nothing used to be.',
  vault:
    'The wallet is the header instead of the foot: the balance is the biggest thing on the screen, with Deposit and Ask Soren under it as a pair. Navigation is one grouped card, and its rules start at the label rather than running edge to edge, which is what makes it a list rather than a stack of buttons.',
};

/* ── the contents ─────────────────────────────────────────────────── */

/*
 * NO COUNTS.
 *
 * The last cut hung a figure off every destination — 412, 12, +12.4% —
 * and none of them meant anything: they were invented, they were not the
 * same KIND of quantity as each other, and a menu is not a dashboard. A
 * number beside a destination has to be worth reading before it earns
 * the width, and none of those were.
 *
 * What is left is what the page is, which is the only thing a menu can
 * honestly tell you before you press it.
 */
export interface Dest {
  readonly id: string;
  readonly label: string;
  /** What the page is, for the variant that sets it as a caption. */
  readonly caption: string;
}

export const DESTS: readonly Dest[] = [
  { id: 'discover', label: 'Discover', caption: 'New pairs as they launch' },
  { id: 'tracker', label: 'Tracker', caption: 'The wallets you follow' },
  { id: 'portfolio', label: 'Portfolio', caption: 'What you are holding' },
  { id: 'rewards', label: 'Rewards', caption: 'Fees earned and waiting' },
  { id: 'frens', label: 'Frens', caption: 'Your invites and their volume' },
  { id: 'conditionals', label: 'Conditionals', caption: 'Orders armed to fire on a trigger' },
];

export interface AccountItem {
  readonly id: string;
  readonly label: string;
  readonly caption: string;
}

/*
 * Ask Soren is NOT in this list. It is the one thing in the drawer that
 * DOES something rather than takes you somewhere, and the real drawer
 * already knows that — it sits above the rule with Soren's own face on
 * it. Drawn as a row it reads as a seventh destination.
 */
export const ACCOUNT: readonly AccountItem[] = [
  { id: 'profile', label: 'Edit profile', caption: 'Name, avatar and handle' },
  { id: 'security', label: 'Account and security', caption: 'Passkeys, sessions and export' },
];

export const IDENTITY = {
  name: 'soren',
  handle: '@sorentrades',
  wallet: '7xKXtg2CW…9mWqB1',
  walletShort: '7xKX…9mWq',
  sol: '29.740',
  usd: '4,612.08',
  pnlPct: '+12.4%',
} as const;
