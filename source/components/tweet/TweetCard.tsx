'use client';

import type { CSSProperties } from 'react';
import { useTweet } from './useTweet';
import { TweetCardHeader } from './TweetCardHeader';
import { TweetCardBody } from './TweetCardBody';
import { XLogo } from './icons';
import { GUTTER } from './tweet-styles';

const CARD_WIDTH = 300;
/* Viewport-aware: Radix reports the height available before the popover
   collides with a viewport edge; fall back to 80vh off-overlay (dev page),
   capped at 28rem so it never sprawls on tall screens. */
const SHELL_MAX_HEIGHT = 'min(var(--radix-hover-card-content-available-height, 80vh), 28rem)';

/**
 * The tweet card shell — the single scroll owner. Header + body stack and
 * scroll together (whole-card scroll); `overscroll-contain` keeps the wheel
 * from chaining to the page. Mounts lazily (only while a hover is open), so
 * a full Discover list adds zero render cost until a real hover.
 */
export function TweetCard({ tweetId, tweetUrl }: { tweetId: string; tweetUrl: string }) {
  const state = useTweet(tweetId, true);

  const shell: CSSProperties = {
    width: CARD_WIDTH,
    maxHeight: SHELL_MAX_HEIGHT,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    background: 'var(--card-bg)',
    border: '1px solid var(--hairline)',
    boxShadow: 'var(--card-shadow)',
  };

  if (state.status === 'loading') {
    return (
      <div className={`rounded-lg ${GUTTER}`} style={shell}>
        <TweetSkeleton />
      </div>
    );
  }

  if (state.status !== 'ready') {
    // not_found / error / idle: degrade to a minimal "open on X" card.
    return (
      <div
        className={`rounded-lg ${GUTTER}`}
        style={{ ...shell, maxHeight: undefined, overflowY: undefined }}
      >
        <FallbackCard tweetUrl={tweetUrl} />
      </div>
    );
  }

  return (
    <div data-tweet-box="shell" className={`scroll-hide rounded-lg ${GUTTER}`} style={shell}>
      <TweetCardHeader tweet={state.tweet} />
      <TweetCardBody tweet={state.tweet} />
    </div>
  );
}

function TweetSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="h-10 w-10 rounded-full" style={{ background: 'var(--surface-3)' }} />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-3 w-1/2 rounded" style={{ background: 'var(--surface-3)' }} />
          <div className="h-2.5 w-1/3 rounded" style={{ background: 'var(--surface-2)' }} />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-2.5 rounded"
          style={{ background: 'var(--surface-2)', width: i === 2 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

function FallbackCard({ tweetUrl }: { tweetUrl: string }) {
  return (
    <a
      href={tweetUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 text-xs transition-opacity hover:opacity-80"
      style={{ color: 'var(--ink-1)' }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <XLogo />
      <span>View tweet on X</span>
    </a>
  );
}
