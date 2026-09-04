'use client';

/**
 * What the burger opens below 800px — the `vault` treatment off the
 * `/whatever` sheet.
 *
 * ── WHAT IT HOLDS, AND WHY IT GREW ───────────────────────────────────
 *
 * It used to hold exactly the three things the bar sheds at that width:
 * the destinations, Ask Soren, and the one conditional action. Its own
 * note said the account tile stayed on the bar at every width, so it did
 * not need to be here.
 *
 * That is no longer true. The avatar came off the bar below 800, and
 * Edit profile, Account and security and Sign out went with it — none of
 * which had another route on a phone. They are here now, and so is the
 * wallet, because a drawer that is the whole screen and shows only six
 * words is spending a screen on nothing.
 *
 * ── THE WALLET IS THE HEADER ─────────────────────────────────────────
 *
 * The balance is the biggest thing in here, at 38px with tabular
 * figures, because on a phone that is what the menu gets opened to
 * check. Deposit and Ask Soren sit under it as a pair, one filled and
 * one not.
 *
 * ── AND THE DESTINATIONS ARE ONE CARD ────────────────────────────────
 *
 * Six loose rows read as six buttons. One card with hairlines between
 * them reads as a list, and starting those rules at the label rather
 * than at the card's edge is what makes it a grouped list rather than a
 * table.
 *
 * ── IT HAS TO BE PORTALLED, AND THAT IS NOT OPTIONAL ─────────────────
 *
 * The burger lives in `<header class="topnav relative z-30">`, which is a
 * STACKING CONTEXT. A drawer rendered in place competes only inside that
 * header no matter how high its own z-index goes — at 200 it was still
 * painted over by `.dock-terminal`, a fixed sibling at z-30 that simply
 * comes later in the document.
 *
 * So it portals into `.listen-root`, the same container the dialog and
 * popover primitives use. That escapes the header's context and keeps
 * the theme cascade (`data-theme-id` → `--ink-*`, `--accent-*`) that
 * lives on `.listen-root` — portalling to `document.body` would lose it.
 *
 * ── DISMISSAL ────────────────────────────────────────────────────────
 *
 * Escape, the scrim, the close button, and picking a destination. Not a
 * Radix Dialog: this needs no focus trap fighting the bar behind it.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useClerk, useUser } from '@clerk/nextjs';
import {
  ChartPie,
  Compass,
  Gift,
  GitBranch,
  KeyRound,
  LogOut,
  MessageSquare,
  Radar,
  UserPen,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useFrenProfile } from '@/lib/api/frens';
import { PixelAvatar } from './PixelAvatar';
import { useWalletBalancesContext } from './WalletBalanceProvider';
import type { NavTab } from './navigation';
import './nav-drawer.css';

/* Closed at boot on every page, so the editor's chunk loads on first
   open rather than riding the shared shell bundle — the same posture
   `AccountMenu` takes with it. */
const SettingsPanel = dynamic(
  () => import('./SettingsPanel').then((m) => m.SettingsPanel),
  { ssr: false },
);

/**
 * The destinations' glyphs, from `lucide-react` — the same set
 * `AccountMenu` imports, so nothing here is a hand-drawn approximation
 * of an icon. `ChartPie` for Portfolio is the product's own pairing, not
 * a new one; so are the three in the foot.
 */
const TAB_ICON: Record<string, LucideIcon> = {
  discover: Compass,
  tracker: Radar,
  portfolio: ChartPie,
  rewards: Gift,
  frens: Users,
  chat: MessageSquare,
  conditionals: GitBranch,
  'agent-wallet': ChartPie,
};

const TAB_LABEL: Record<string, string> = {
  discover: 'Discover',
  tracker: 'Tracker',
  portfolio: 'Portfolio',
  rewards: 'Rewards',
  frens: 'Frens',
  chat: 'Chat',
  conditionals: 'Conditionals',
  'agent-wallet': 'Agent wallet',
};

/**
 * Soren's face, the same glyph the bar draws beside "Ask Soren".
 *
 * The eyes are a variable, not a literal. The head takes `currentColor`,
 * and on the white press that makes it black — with the eyes hard coded
 * black too, the whole face went to one silhouette and read as a blob.
 * `--nvd-eye` is set to white wherever the head is dark.
 */
function SorenFace({ size = 17 }: { size?: number }) {
  return (
    <svg aria-hidden className="nvd-face" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.5c5.2 0 8.5 3.4 8.5 8.4v6.4c0 2.6-1.8 4.2-4.4 4.2H7.9c-2.6 0-4.4-1.6-4.4-4.2v-6.4c0-5 3.3-8.4 8.5-8.4z"
        fill="currentColor"
      />
      <ellipse cx="9.1" cy="11" rx="1.35" ry="1.75" fill="var(--nvd-eye, #000000)" />
      <ellipse cx="14.9" cy="11" rx="1.35" ry="1.75" fill="var(--nvd-eye, #000000)" />
    </svg>
  );
}

export interface NavDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The bar's list, already filtered by the conditionals flag. */
  readonly tabs: readonly NavTab[];
  readonly active: NavTab | null;
  readonly onSelect: (tab: NavTab) => void;
  /** The bar's conditional action, or null when it has none to show. */
  readonly action?: { readonly label: string; readonly onPress: () => void } | null;
  /** Ask Soren, when the agent chat flag is on. Decorative otherwise. */
  readonly onAskSoren?: (() => void) | null;
}

export function NavDrawer({
  open,
  onClose,
  tabs,
  active,
  onSelect,
  action = null,
  onAskSoren = null,
}: NavDrawerProps): React.ReactElement | null {
  /*
   * `.listen-root` is resolved in an effect, not during render: it does
   * not exist on the server, and reading the DOM while rendering would
   * make the first client pass disagree with the server's.
   */
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>('.listen-root') ?? document.body);
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Escape closes. Bound only while open, so nothing listens when shut.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // The board behind must not scroll under an open drawer.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || container === null) return null;

  return (
    <>
      {createPortal(
        <>
          <div data-nav-drawer-scrim="" onClick={onClose} aria-hidden />
          <div data-nav-drawer="" role="dialog" aria-modal="true" aria-label="Menu">
            <Identity onClose={onClose} onEditProfile={() => setSettingsOpen(true)} />

            {/*
              THE BALANCE LEADS TO THE PORTFOLIO.
              
              Not to a deposit. The bar's deposit modal is state owned by
              `WalletNavCluster`, along with the pubkey and wallet id it
              needs; reaching it from here would mean resolving the same
              wallet a second time, and two resolutions of one wallet is
              how two surfaces end up disagreeing about which one is
              selected. Portfolio is where the balance is explained and
              where depositing lives, so the figure goes there.
            */}
            <Wallet
              onPress={() => {
                onSelect('portfolio');
                onClose();
              }}
            />

            <div className="nvd-acts">
              <SorenControl onPress={onAskSoren} onClose={onClose} solo />
            </div>

            {/* The conditional action keeps its own full width row: it is
                the one thing here that is sometimes offered, and putting
                it beside a permanent control would make the pair jump. */}
            {action === null ? null : (
              <button
                type="button"
                className="nvd-action"
                onClick={() => {
                  action.onPress();
                  onClose();
                }}
              >
                {action.label}
              </button>
            )}

            <nav className="nvd-list">
              {tabs.map((tab) => {
                const Icon = TAB_ICON[tab] ?? Compass;
                return (
                  <button
                    key={tab}
                    type="button"
                    className="nvd-row"
                    aria-current={tab === active ? 'page' : undefined}
                    onClick={() => {
                      onSelect(tab);
                      onClose();
                    }}
                  >
                    <span className="nvd-rowglyph">
                      <Icon size={17} strokeWidth={1.6} aria-hidden />
                    </span>
                    <span className="nvd-rowlabel">{TAB_LABEL[tab] ?? tab.replace(/-/g, ' ')}</span>
                  </button>
                );
              })}
            </nav>

            <AccountFoot onClose={onClose} onEditProfile={() => setSettingsOpen(true)} />
          </div>
        </>,
        container,
      )}
      {/* Mounted only while open, the same posture the topnav's other
          panels take — the editor's chunk stays out of the boot path. */}
      {settingsOpen ? (
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  );
}

/* ── the identity row ───────────────────────────────────────────────── */

function Identity({
  onClose,
  onEditProfile,
}: {
  onClose: () => void;
  onEditProfile: () => void;
}): React.ReactElement {
  const { user } = useUser();
  const profileQuery = useFrenProfile({ enabled: true });
  const profile = profileQuery.data?.kind === 'ok' ? profileQuery.data.data : null;
  const slug = profile?.slug ?? null;
  const avatarUrl = profile?.avatar_data_url ?? null;
  // Seeded from the user id, the same way `AccountMenu` seeds it, so the
  // first frame paints this user's own invader rather than a placeholder.
  const seed = user?.id ?? slug ?? 'anon';

  return (
    <div className="nvd-top">
      <button type="button" className="nvd-who" onClick={onEditProfile}>
        <span className="nvd-mark">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <PixelAvatar seed={seed} size={26} />}
        </span>
        <span className="nvd-whoname">{slug ? `@${slug}` : 'Set up your profile'}</span>
      </button>
      <button type="button" className="nvd-close" onClick={onClose} aria-label="Close menu">
        <X size={17} strokeWidth={1.9} aria-hidden />
      </button>
    </div>
  );
}

/* ── the balance ────────────────────────────────────────────────────── */

function Wallet({ onPress }: { onPress: () => void }): React.ReactElement {
  const { sol, usdc } = useWalletBalancesContext();
  return (
    <button type="button" className="nvd-bal" onClick={onPress}>
      <span className="nvd-balrow">
        <span className="nvd-balfig">{sol}</span>
        <span className="nvd-balunit">SOL</span>
      </span>
      {/*
       * USDC as the second line rather than a second figure beside the
       * first: they are not the same currency, and setting them at the
       * same size invites reading one as the other's conversion.
       */}
      <span className="nvd-balsub">{usdc} USDC</span>
    </button>
  );
}

/* ── the account foot ───────────────────────────────────────────────── */

function AccountFoot({
  onClose,
  onEditProfile,
}: {
  onClose: () => void;
  onEditProfile: () => void;
}): React.ReactElement {
  const clerk = useClerk();
  /*
   * THEY GET THEIR WORDS BACK.
   *
   * The foot was three bare glyphs — a pencil, a key and a door — with
   * the meaning in a `title` a phone cannot show. A drawer that has
   * spelled out all seven destinations has no business making the last
   * three a guess, and one of them signs you out.
   */
  return (
    <div className="nvd-foot">
      <button type="button" className="nvd-footbtn" onClick={onEditProfile}>
        <UserPen size={16} strokeWidth={1.6} aria-hidden />
        Profile
      </button>
      <button
        type="button"
        className="nvd-footbtn"
        onClick={() => {
          onClose();
          clerk.openUserProfile();
        }}
      >
        <KeyRound size={16} strokeWidth={1.6} aria-hidden />
        Security
      </button>
      {/*
       * Sign out takes no colour. `--down` means a fill failed or money
       * left, and signing out is neither — the rule above it and the
       * bottom of the drawer are the whole warning, which is the same
       * call `AccountMenu` makes.
       */}
      <button
        type="button"
        className="nvd-footbtn"
        onClick={() => {
          onClose();
          void clerk.signOut({
            redirectUrl: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL ?? '/',
          });
        }}
      >
        <LogOut size={16} strokeWidth={1.6} aria-hidden />
        Sign out
      </button>
    </div>
  );
}

/**
 * Ask Soren. A real button when the agent chat flag is on, and the same
 * inert chrome the bar renders when it is off — the bar decides that, and
 * the drawer must not offer an opener the bar does not have.
 */
function SorenControl({
  onPress,
  onClose,
  solo,
}: {
  onPress: (() => void) | null;
  onClose: () => void;
  /** No Deposit beside it, so it takes the whole row. */
  solo: boolean;
}): React.ReactElement {
  const inner: ReactNode = (
    <>
      <SorenFace />
      Ask Soren
    </>
  );
  const className = `nvd-act${solo ? ' is-solo' : ''}`;
  if (onPress === null) return <div className={className}>{inner}</div>;
  return (
    <button
      type="button"
      className={className}
      data-testid="nav-drawer-soren"
      onClick={() => {
        onPress();
        onClose();
      }}
    >
      {inner}
    </button>
  );
}
