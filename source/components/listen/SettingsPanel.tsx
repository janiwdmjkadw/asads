'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ImageUp, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AVATAR_MAX_CHARS,
  AVATAR_MAX_EDGE,
  AVATAR_THUMB_MAX_CHARS,
  AVATAR_THUMB_MAX_EDGE,
  BANNER_MAX_CHARS,
  BANNER_MAX_EDGE,
  dataUrlToBoundedThumb,
  fileToBoundedDataUrl,
  patchFrenProfile,
  useFrenProfile,
  useInvalidateFrenProfile,
  type FrenProfile,
} from '@/lib/api/frens';
import { claimReferralCode } from '@/lib/api/referral';
import './profile-editor.css';

/**
 * Slice "Frens": the Settings modal behind the top-nav gear (the theme
 * "Tweaks" panel moved to the status bar's canvas button). Profile is the
 * first — and currently only — section:
 *
 *   banner  → click Edit to upload (downscaled client-side)
 *   avatar  → circle over the banner, click to upload
 *   username → THE referral slug (one identity): claiming here IS claiming
 *              your /fren link; immutable once set (server-enforced)
 *   bio     → ≤200 chars
 *   privacy → public (default, discoverable on Frens) / private
 */

const MAX_BIO = 200;
const SLUG_REGEX = /^[a-z0-9_-]{1,32}$/;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: Props): React.ReactElement {
  const { getToken } = useAuth();
  const profileQuery = useFrenProfile({ enabled: open });
  const invalidateProfile = useInvalidateFrenProfile();
  const profile: FrenProfile | null =
    profileQuery.data?.kind === 'ok' ? profileQuery.data.data : null;

  // Draft state seeds from the loaded profile once per open.
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [username, setUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !profile) return;
    seededRef.current = true;
    setBio(profile.bio ?? '');
    setAvatar(profile.avatar_data_url);
    setBanner(profile.banner_data_url);
    setVisibility(profile.visibility);
    setUsername(profile.slug ?? '');
  }, [open, profile]);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  const pickImage = async (
    input: HTMLInputElement | null,
    kind: 'avatar' | 'banner',
  ): Promise<void> => {
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const dataUrl =
      kind === 'avatar'
        ? await fileToBoundedDataUrl(file, AVATAR_MAX_EDGE, AVATAR_MAX_CHARS)
        : await fileToBoundedDataUrl(file, BANNER_MAX_EDGE, BANNER_MAX_CHARS);
    if (!dataUrl) {
      toast('Could not read that image', { description: 'Try a smaller png/jpeg/webp.' });
      return;
    }
    if (kind === 'avatar') setAvatar(dataUrl);
    else setBanner(dataUrl);
  };

  const slugLocked = Boolean(profile?.slug);
  const usernameNormalized = username.trim().toLowerCase();
  const usernameValid =
    usernameNormalized.length === 0 || SLUG_REGEX.test(usernameNormalized);

  const initials = useMemo(() => {
    const source = (profile?.slug ?? profile?.label ?? '?').replace(/^@/, '');
    return source.slice(0, 2).toUpperCase();
  }, [profile]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await getToken();
      // Username claim first (set-once; separate writer from the profile).
      if (!slugLocked && usernameNormalized.length > 0) {
        if (!SLUG_REGEX.test(usernameNormalized)) {
          toast('Invalid username', {
            description: 'Use a-z, 0-9, - or _, up to 32 characters.',
          });
          return;
        }
        const claim = await claimReferralCode(usernameNormalized, { authToken: token });
        if (claim.kind === 'rejected') {
          toast('Could not claim username', {
            description:
              claim.reason === 'taken'
                ? 'That name is taken — try another.'
                : claim.reason === 'already_set'
                  ? 'Your username is already set (usernames are permanent).'
                  : 'That name is reserved or malformed.',
          });
          return;
        }
        if (claim.kind !== 'ok') {
          toast('Could not claim username', { description: 'Try again in a moment.' });
          return;
        }
      }
      // The list surfaces (leaderboard rows) serve a tiny thumb instead
      // of the full avatar — derive it here so one save writes both.
      const avatarThumb =
        avatar !== null
          ? await dataUrlToBoundedThumb(avatar, AVATAR_THUMB_MAX_EDGE, AVATAR_THUMB_MAX_CHARS)
          : null;
      const result = await patchFrenProfile(
        {
          bio: bio.trim().length > 0 ? bio.trim() : null,
          avatarDataUrl: avatar,
          avatarThumbDataUrl: avatarThumb,
          bannerDataUrl: banner,
          visibility,
        },
        { authToken: token },
      );
      if (result.kind !== 'ok') {
        toast('Could not save profile', {
          description: result.kind === 'error' ? result.reason : 'Sign in again and retry.',
        });
        return;
      }
      invalidateProfile();
      toast('Profile saved');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        data-profile-editor=""
        /* `DialogContent` merges the shadcn defaults through `cn`, and
           tailwind-merge only drops them if their counterparts are passed
           here. The stylesheet repeats the same values with `!important`
           because the shipped shadow is an inline style. */
        className="w-[480px] max-w-[calc(100vw-2rem)] gap-0 rounded-2xl border-0 p-0 overflow-hidden"
      >
        <DialogTitle className="sr-only">Edit profile</DialogTitle>

        <div
          className={`pe-banner${banner ? '' : ' is-empty'}`}
          style={banner ? { backgroundImage: `url(${JSON.stringify(banner)})` } : undefined}
        >
          {/* A lucide pencil, not a `✎` in the label. The glyph came from
              whatever face the label was set in and rendered at a
              different weight and baseline to every other icon here. */}
          <button type="button" className="pe-chip" onClick={() => bannerInputRef.current?.click()}>
            <Pencil aria-hidden />
            Edit banner
          </button>
          <button
            type="button"
            aria-label="Change profile picture"
            className={`pe-avatar${avatar ? '' : ' is-empty'}`}
            style={avatar ? { backgroundImage: `url(${JSON.stringify(avatar)})` } : undefined}
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatar ? null : initials}
            {/* The avatar is a file picker and never said so. A mark on
                hover is the whole affordance. */}
            <span className="pe-avatar-hint" aria-hidden>
              <ImageUp />
            </span>
          </button>
        </div>

        <input
          ref={avatarInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={() => void pickImage(avatarInputRef.current, 'avatar')}
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={() => void pickImage(bannerInputRef.current, 'banner')}
        />

        <div className="pe-body">
          <div className="pe-name">{profile?.label ?? '…'}</div>

          {/* Username = the fren slug. Set once, server enforced. */}
          <div className="pe-field">
            <span className="pe-cap">Username</span>
            {slugLocked ? (
              <>
                {/* Permanent, so it is a value and not a disabled input. */}
                <div className="pe-locked">
                  <span className="pe-link">listen.money/fren/{profile?.slug}</span>
                  <button
                    type="button"
                    className="pe-copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        `listen.money/fren/${profile?.slug ?? ''}`,
                      );
                    }}
                  >
                    Copy
                  </button>
                </div>
                <div className="pe-note">Usernames are permanent. This one is yours.</div>
              </>
            ) : (
              <>
                <input
                  type="text"
                  className={`pe-input${usernameValid ? '' : ' is-invalid'}`}
                  value={username}
                  placeholder="Claim your username"
                  maxLength={32}
                  spellCheck={false}
                  onChange={(e) => setUsername(e.target.value)}
                />
                <div className={`pe-note${usernameValid ? '' : ' is-bad'}`}>
                  {usernameValid
                    ? `One time claim. This becomes your @name and your invite link: listen.money/fren/${usernameNormalized || 'you'}`
                    : 'Use a to z, 0 to 9, dash or underscore, up to 32 characters.'}
                </div>
              </>
            )}
          </div>

          <div className="pe-field">
            <span className="pe-cap">Bio</span>
            <textarea
              className="pe-area"
              rows={3}
              maxLength={MAX_BIO}
              placeholder="Tell people what you trade…"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <div className="pe-count pe-num">
              {bio.length}/{MAX_BIO}
            </div>
          </div>

          <div className="pe-vis">
            {/* Classes, not inline styles: an inline style beats every
                selector, so a colour written here would survive the
                sheet and stay dark grey on a white panel. */}
            <span className="pe-vis-main">
              <span className="pe-vis-name">Public profile</span>
              <span className="pe-vis-note">
                Discoverable on Frens. Your stats and calls rank on the leaderboard.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={visibility === 'public'}
              aria-label="Public profile"
              className={`pe-switch${visibility === 'public' ? ' is-on' : ''}`}
              onClick={() => setVisibility((v) => (v === 'public' ? 'private' : 'public'))}
            >
              <span aria-hidden />
            </button>
          </div>

          <div className="pe-acts">
            <span className="pe-acts-gap" />
            <button type="button" className="pe-btn is-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="pe-btn is-primary"
              disabled={saving || !usernameValid}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
