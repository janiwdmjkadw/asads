import type { CSSProperties, ReactNode } from 'react';
import { compactAge } from '@/lib/format';
import type { TweetDTO } from '@/lib/api/tweet';
import { Avatar } from './Avatar';
import { JoinedIcon, VerifiedBadge, XLogo } from './icons';
import { ageColorVar, compactLower, formatJoined } from './tweet-format';
import { DIVIDER_BOTTOM } from './tweet-styles';

/**
 * Author identity box. Two stacked sub-boxes:
 *   top    — avatar | (name+verified / @handle) | (X logo / age)
 *   bottom — joined · followers (single row)
 */
// Sits in the top 50% slice of the identity row, a little smaller than the
// slice so there's breathing room above the age below.
const X_LOGO_SIZE = 18;

export function TweetCardHeader({ tweet }: { tweet: TweetDTO }) {
  const { author } = tweet;
  const ageMs = tweet.createdAtMs != null ? Date.now() - tweet.createdAtMs : null;
  const age = ageMs != null ? compactAge(ageMs) : null;
  const profileUrl = `https://x.com/${author.handle.replace(/^@/, '')}`;
  // Outer top padding comes from the shell; the header owns only its bottom
  // (divider-facing) gap.
  return (
    <div data-tweet-box="header" className={`flex flex-col gap-2 pb-3 ${DIVIDER_BOTTOM}`}>
      {/* items-stretch: children fill the row height set by the avatar, so the
          right column derives its height from the row, not a magic value. */}
      <div className="flex items-stretch gap-2.5">
        <Avatar url={author.avatarUrl} name={author.name || author.handle} />

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="flex min-w-0 items-center gap-1">
            <ProfileLink
              href={profileUrl}
              className="truncate text-sm font-semibold leading-tight"
              style={{ color: 'var(--ink-0)' }}
            >
              {author.name || author.handle}
            </ProfileLink>
            {author.verified ? <VerifiedBadge /> : null}
          </span>
          <ProfileLink
            href={profileUrl}
            className="truncate text-xs leading-tight"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
          >
            @{author.handle}
          </ProfileLink>
        </div>

        {/* Right column splits 70/30 vertically: the X logo fills the top
            70% slice, the age sits in the bottom 30%. Height comes from the
            row's items-stretch — no explicit height needed. */}
        {/* 50/50 split: icon centered in the top half, age centered (both
            axes) in the bottom half. items-center keeps both on the same
            vertical axis, so the age reads as centered under the icon. */}
        <div className="flex shrink-0 flex-col items-center">
          <a
            href={tweet.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on X"
            className="flex flex-[5] items-center justify-center transition-opacity hover:opacity-70"
            style={{ color: 'var(--ink-1)' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <XLogo size={X_LOGO_SIZE} />
          </a>
          {age && ageMs != null ? (
            <span
              className="flex flex-[5] items-center justify-center text-xs leading-none"
              style={{ color: ageColorVar(ageMs), fontFamily: 'var(--mono)' }}
            >
              {age}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-1.5 text-xs leading-none"
        style={{ color: 'var(--ink-3)' }}
      >
        <span className="flex items-center gap-1">
          <JoinedIcon />
          Joined {author.joinedAtMs != null ? formatJoined(author.joinedAtMs) : 'Unknown'}
        </span>
        <span>
          <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
            {compactLower(author.followersCount ?? 0)}
          </span>{' '}
          followers
        </span>
      </div>
    </div>
  );
}

/** Name / @handle link to the author's X profile; underlines on hover. */
function ProfileLink({
  href,
  className,
  style,
  children,
}: {
  href: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`hover:underline ${className ?? ''}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
