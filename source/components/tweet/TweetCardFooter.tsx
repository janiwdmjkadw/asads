import type { ReactNode } from 'react';
import type { TweetDTO } from '@/lib/api/tweet';
import { BookmarkIcon, EyeIcon, HeartIcon, ReplyIcon, RepostIcon, XLogo } from './icons';
import { compactLower, formatDateTime } from './tweet-format';
import { DIVIDER, RHYTHM } from './tweet-styles';

// X's link blue — used for the full-width "Read more on X" affordance.
const X_BLUE = '#1d9bf0';

/**
 * Expanded-tweet footer (mirrors X's single-tweet detail view): absolute
 * timestamp + bookmark/view counts, a like/repost/reply row, and a
 * full-width "Read more on X" affordance. Rendered as the last section of
 * the body so it is always reachable and never clipped on long tweets.
 */
export function TweetCardFooter({ tweet }: { tweet: TweetDTO }) {
  const m = tweet.metrics;
  const stamp = tweet.createdAtMs != null ? formatDateTime(tweet.createdAtMs) : null;

  // Always render every slot (missing values fall back to 0) so the footer
  // keeps a stable layout instead of collapsing when data is absent.
  return (
    <div data-tweet-box="footer" className={`flex flex-col ${RHYTHM}`}>
      <span aria-hidden className={DIVIDER} />
      <div
        className="flex items-center justify-between gap-2 text-xs tabular-nums"
        style={{ color: 'var(--ink-3)' }}
      >
        {stamp ? <span>{stamp}</span> : null}
        <span className="flex items-center gap-1">
          <BookmarkIcon />
          <span style={{ color: 'var(--ink-1)' }}>{compactLower(m?.bookmarks ?? 0)}</span>
        </span>
        <span className="flex items-center gap-1">
          <EyeIcon />
          <span style={{ color: 'var(--ink-1)' }}>{compactLower(m?.views ?? 0)}</span>
        </span>
      </div>

      <span aria-hidden className={DIVIDER} />
      <div className="flex items-center justify-between gap-2 text-sm tabular-nums">
        <Metric icon={<HeartIcon />} value={m?.likes ?? 0} />
        <Metric icon={<RepostIcon />} value={m?.retweets ?? 0} />
        <Metric icon={<ReplyIcon />} value={m?.replies ?? 0} />
      </div>

      <a
        href={tweet.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-semibold transition-colors hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]"
        style={{ border: '1px solid var(--hairline)', color: X_BLUE }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        Read more on
        <XLogo size={14} />
      </a>
    </div>
  );
}

function Metric({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      <span style={{ color: 'var(--ink-1)' }}>{compactLower(value)}</span>
    </span>
  );
}
