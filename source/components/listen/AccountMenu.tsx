'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useClerk, useUser } from '@clerk/nextjs';
import { ChartPie, KeyRound, LogOut, UserPen } from 'lucide-react';
import { useFrenProfile } from '@/lib/api/frens';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PixelAvatar } from './PixelAvatar';
import { TAB_VIEWS, navigateToView } from './navigation';
import './account-menu-v2.css';

// Lazy for the reason the topnav's other panels are: the profile editor is
// closed at boot on every page, so its chunk loads on first open rather
// than riding the shared shell bundle.
const SettingsPanel = dynamic(
  () => import('./SettingsPanel').then((m) => m.SettingsPanel),
  { ssr: false },
);

const ICON_SIZE = 15;
const ICON_STROKE = 1.75;

/* The panel's own material — ground, ring, radius, row rhythm, the
   narrow-screen sheet — lives in `account-menu-v2.css`, next to the
   reasoning for each rule. This file decides only what goes in it. */

export interface AccountMenuContentProps {
  slug: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  /** The bio, shown under the handle. Real data the account already set —
      the line that used to sit here was invented. */
  bio?: string | null;
  seed: string;
  onPortfolio: () => void;
  onEditProfile: () => void;
  onSecurity: () => void;
  onSignOut: () => void;
}

/**
 * The menu's body: the header, then the destinations, then sign out.
 * Pure and props-driven — no hooks, no Clerk, no network — so the dev
 * gallery and the tests can render every state directly.
 *
 * `fade`, off the `/whatever` sheet. The art has NO BOTTOM EDGE: it runs
 * the whole header and the scrim carries it to black by the time it
 * reaches the first row, so there is no band to align the mark against
 * and no seam to get wrong. Identity is centred and the destinations are
 * not, which is what makes the top read as a header rather than as the
 * first two rows of a list.
 */
export function AccountMenuContent({
  slug,
  avatarUrl,
  bannerUrl,
  bio,
  seed,
  onPortfolio,
  onEditProfile,
  onSecurity,
  onSignOut,
}: AccountMenuContentProps): React.ReactElement {
  return (
    <>
      <div className="acct-head">
        {bannerUrl ? (
          /* Plain <img>, not next/image: profile art arrives as a data URL
             from `/frens/profile`, which the optimizer cannot touch. */
          <img src={bannerUrl} alt="" className="acct-art" />
        ) : (
          /* NO UPLOAD, NO AURORA. The empty state used to be a gradient
             built from the theme accent, which is the one thing this
             material rules out. The account's own creature stands in:
             art it already has, seeded from the user id, spending no
             accent. See `.acct-art-fallback`. */
          <span className="acct-art-fallback" aria-hidden>
            <PixelAvatar seed={seed} size={64} />
          </span>
        )}
        <span className="acct-scrim" aria-hidden />

        <div className="acct-id">
          <span className="acct-mark">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <PixelAvatar seed={seed} size={32} />
            )}
          </span>
          <span className="acct-name">{slug ? `@${slug}` : 'Set up your profile'}</span>
          {slug ? (
            bio ? <span className="acct-meta">{bio}</span> : null
          ) : (
            <span className="acct-meta">claim your @handle · pick your art</span>
          )}
        </div>
      </div>

      {/* NO `GO TO`. It was 9.5px uppercase at 0.13em over four rows that
          are self evidently places to go, which is the loudest type on
          the panel spent on the one word carrying no information. The
          rule already says a new group starts. */}
      <div aria-hidden className="acct-rule" />
      <MenuRow icon={<ChartPie {...iconProps} />} label="Portfolio" onClick={onPortfolio} />
      <MenuRow icon={<UserPen {...iconProps} />} label="Edit profile" onClick={onEditProfile} />
      <MenuRow icon={<KeyRound {...iconProps} />} label="Account and security" onClick={onSecurity} />

      {/* Sign out takes no colour and no extra height. `--down` means a
          fill failed or money left, and signing out is neither — it is a
          position problem, so the rule and the bottom of the panel are
          the whole warning. */}
      <div aria-hidden className="acct-rule" />
      <MenuRow icon={<LogOut {...iconProps} />} label="Sign out" onClick={onSignOut} out />
    </>
  );
}

const iconProps = {
  size: ICON_SIZE,
  strokeWidth: ICON_STROKE,
  'aria-hidden': true,
} as const;

function Chevron() {
  return (
    <svg
      className="acct-go"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/**
 * One destination. `out` marks sign out, which changes its ink and
 * nothing else — see the note beside `.acct-row.is-out`.
 */
function MenuRow({
  icon,
  label,
  onClick,
  out = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  out?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={cn('acct-row', out && 'is-out')}>
      <span aria-hidden className="acct-ico">
        {icon}
      </span>
      <span className="acct-label">{label}</span>
      <Chevron />
    </button>
  );
}

/**
 * The header's account surface: a trigger tile in the bar's etched-control
 * family, over a popover carrying the app's own identity and destinations.
 * The tile spends no accent — it is a profile icon, not a call to action,
 * and the gradient read as a stray blue border around the avatar; the bar's
 * accent spend lives in the signed-out sign-in CTA instead. Replaces
 * Clerk's `<UserButton>`, whose light card broke every theme and whose
 * avatar was the OAuth photo rather than the picture set in Settings.
 */
export function AccountMenu(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const clerk = useClerk();
  const { user } = useUser();
  const profileQuery = useFrenProfile({ enabled: true });
  const profile = profileQuery.data?.kind === 'ok' ? profileQuery.data.data : null;

  const slug = profile?.slug ?? null;
  // The app profile is the ONLY avatar source: no Clerk imageUrl, so a
  // loading or failed profile falls to the seeded invader rather than
  // flashing borrowed OAuth art.
  const bio = profile?.bio ?? null;
  const avatarUrl = profile?.avatar_data_url ?? null;
  const bannerUrl = profile?.banner_data_url ?? null;
  // Seeded from the user id, which `useUser` has synchronously inside
  // <SignedIn> — so the first frame paints this user's own invader. The
  // fallback used to be a monogram derived from the PROFILE, which is null
  // while it loads, so every refresh flashed a literal "?".
  const seed = user?.id ?? slug ?? 'anon';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            data-testid="account-menu-trigger"
            className="shrink-0 overflow-hidden p-0"
            style={{
              width: 'var(--hdr-h)',
              height: 'var(--hdr-h)',
              borderRadius: 'var(--hdr-r)',
              // The header's etched-control family, same as the bell: one
              // hairline, one step up while open. No gradient and no glow —
              // the accent spend on this bar belongs to the sign-in CTA.
              border: `1px solid ${open ? 'var(--hdr-edge-on)' : 'var(--hdr-edge)'}`,
              background: 'var(--surface-2)',
              transition: 'border-color 160ms var(--ease-out)',
            }}
          >
            {/* The photo fills the plate edge to edge; the invader insets to
                24px instead. 24 divides the 8-cell grid exactly (3px a cell,
                where 26 gives a ragged 3.25) and keeps its outer legs clear
                of the corner radius, which at 26 clipped them. */}
            <span className="grid h-full w-full place-items-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <PixelAvatar seed={seed} size={24} />
              )}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          /* `data-acct` is the hook `account-menu-v2.css` hangs the whole
             surface off, including the narrow-screen rule that has to
             reach the popper WRAPPER rather than this element. Width,
             ground, ring and radius all live there: `PopoverContent`
             merges shadcn defaults through `cn` and its shadow is an
             inline style, so the stylesheet repeats them with
             `!important` the way `notis-v2.css` does. */
          data-acct=""
          className="overflow-hidden p-0"
        >
          <AccountMenuContent
            slug={slug}
            avatarUrl={avatarUrl}
            bannerUrl={bannerUrl}
            bio={bio}
            seed={seed}
            onPortfolio={() => {
              setOpen(false);
              const dest = TAB_VIEWS['portfolio'];
              if (dest) navigateToView(dest);
            }}
            onEditProfile={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
            onSecurity={() => {
              setOpen(false);
              clerk.openUserProfile();
            }}
            onSignOut={() => {
              setOpen(false);
              void clerk.signOut({
                redirectUrl: process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL ?? '/',
              });
            }}
          />
        </PopoverContent>
      </Popover>
      {/* Mounted only while open, the same posture the topnav's other
          panels take — the editor's chunk stays out of the boot path. */}
      {settingsOpen ? (
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  );
}
