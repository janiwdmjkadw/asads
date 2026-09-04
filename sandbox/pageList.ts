/**
 * Every page in the bundle, once.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
 *
 * Two things read it: the sandbox index, and `/og`, which draws a preview
 * card per page. They used to be separate lists, which meant a page could
 * appear on the index with a note that its own preview card contradicted.
 * One list, and the card is a rendering of the same words the index shows.
 *
 * ── `id` IS THE CARD KEY ─────────────────────────────────────────────
 *
 * `/og?p=<id>` draws this entry. Ids are stable: they are baked into
 * the OG tags of anything already shared, so renaming one silently breaks
 * a preview somebody has already posted.
 */

export interface PageEntry {
  /** Stable. It is the `/og?p=` key and it appears in shared OG tags. */
  readonly id: string;
  readonly href: string;
  readonly name: string;
  /** What the page is. One line, on the index and on the card. */
  readonly note: string;
  /**
   * Anything somebody should know BEFORE they open it: parked work, a
   * flag it needs, a stub behind it. Told ahead of the click, so nobody
   * concludes a deliberately empty page is a broken one.
   */
  readonly caveat?: string;
}

export interface PageGroup {
  readonly title: string;
  readonly note: string;
  readonly entries: readonly PageEntry[];
}

export const PAGE_GROUPS: readonly PageGroup[] = [
  {
    title: 'The site',
    note: 'The public pages, all served from the landing route group so they render at one scale in one set of tokens.',
    entries: [
      {
        id: 'landing',
        href: '/',
        name: 'Landing',
        note: 'The home page. Conditionals, rewards, frens and the footer, under the glass bar.',
        caveat: 'Hero parked: an empty band at its real height while the ground is decided.',
      },
      {
        id: 'agentic',
        href: '/agentic-trading',
        name: 'Agentic trading',
        note: 'The run in the open, the corpus wall, the loop, and what the agent can and cannot reach.',
        caveat: 'Hero parked here too, for the same reason.',
      },
      {
        id: 'invite',
        href: '/?invite',
        name: 'Invite code',
        note: 'The code sheet, over the real landing page at the real scale rather than on a stage.',
      },
      {
        id: 'whatever',
        href: '/whatever',
        name: 'Design route',
        note: 'Where variants are built before they go on a page.',
        caveat: 'Empty right now. Nothing is in flight.',
      },
    ],
  },
  {
    title: 'The terminal',
    note: 'The product itself, fed by local fixtures rather than by a server.',
    entries: [
      { id: 'discover', href: '/discover', name: 'Discover', note: 'The three lane market board. 130 live cards.' },
      {
        id: 'discover-evm',
        href: '/discover/evm',
        name: 'Discover, EVM',
        note: 'The BSC and Robinhood lane set.',
        caveat: 'Needs evm-client-surface on.',
      },
      { id: 'trade', href: '/trade', name: 'Trade', note: 'Chart, buy and sell panel, analytics, trades table.' },
      { id: 'tracker', href: '/tracker', name: 'Tracker', note: 'Tracked wallets and the tweet feed.' },
      { id: 'portfolio', href: '/portfolio', name: 'Portfolio', note: 'Positions, spot, wallets, orders, history.' },
      { id: 'rewards', href: '/rewards', name: 'Rewards', note: 'Cashback, referrals, partner tiers.' },
      { id: 'frens', href: '/frens', name: 'Frens', note: 'The referral surface.' },
      {
        id: 'conditionals',
        href: '/conditionals',
        name: 'Conditionals',
        note: 'Conditional orders.',
        caveat: 'Needs conditionals-surface on.',
      },
      {
        id: 'agent',
        href: '/agent',
        name: 'Agent',
        note: 'Full page agent chat.',
        caveat: 'Needs NEXT_PUBLIC_AGENT_CHAT true.',
      },
      {
        id: 'agent-wallet',
        href: '/agent-wallet',
        name: 'Agent wallet',
        note: 'Create, fund, delegate, nonce setup.',
      },
    ],
  },
  {
    title: 'Getting in',
    note: 'Onboarding, invite links and the auth screens.',
    entries: [
      {
        id: 'welcome',
        href: '/welcome',
        name: 'Onboarding',
        note: 'Full screen two step flow.',
        caveat: 'Needs onboarding-fullscreen on.',
      },
      {
        id: 'fren-link',
        href: '/fren/designer',
        name: 'Fren invite link',
        note: 'Captures the slug and forwards to signup.',
      },
      { id: 'fren-signup', href: '/signup/fren/designer', name: 'Fren signup', note: 'Where the invite link lands.' },
      {
        id: 'sign-in',
        href: '/sign-in',
        name: 'Sign in',
        note: 'The auth card.',
        caveat: 'Clerk is stubbed here, so the card itself is a placeholder.',
      },
      { id: 'sign-up', href: '/sign-up', name: 'Sign up', note: 'The same, one step along.', caveat: 'Also stubbed.' },
    ],
  },
];

export const PAGES: readonly PageEntry[] = PAGE_GROUPS.flatMap((group) => group.entries);

/** `/og` looks an entry up by its `p` parameter through this. */
export function findPage(id: string | null): PageEntry | undefined {
  if (!id) return undefined;
  return PAGES.find((page) => page.id === id);
}
