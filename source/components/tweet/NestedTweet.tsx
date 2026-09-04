import type { ReactNode } from 'react';
import { compactAge } from '@/lib/format';
import type { TweetCard, TweetDTO, TweetMedia, TweetMetrics, TweetRef } from '@/lib/api/tweet';
import { Avatar } from './Avatar';
import { LinkCard } from './LinkCard';
import { TweetMediaBlock } from './TweetMedia';
import { renderTweetText } from './render-text';
import { ageColorVar, compactLower } from './tweet-format';
import { BookmarkIcon, EyeIcon, HeartIcon, ReplyIcon, RepostIcon, VerifiedBadge } from './icons';
import { NESTED_CARD } from './tweet-styles';

/** Normalized shape rendered by `NestedTweet` (reply parent or quoted). */
export interface NestedData {
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
  verified: boolean;
  createdAtMs: number | null;
  text: string | null;
  media: TweetMedia;
  card: TweetCard | null;
  metrics: TweetMetrics | null;
}

export function refToNested(ref: TweetRef): NestedData {
  return {
    handle: ref.handle || null,
    name: ref.name ?? null,
    avatarUrl: ref.avatarUrl ?? null,
    verified: ref.verified === true,
    createdAtMs: ref.createdAtMs ?? null,
    text: ref.text ?? null,
    media: ref.media ?? { images: [], videos: [] },
    card: ref.card ?? null,
    metrics: ref.metrics ?? null,
  };
}

export function quotedToNested(q: TweetDTO): NestedData {
  return {
    handle: q.author.handle || null,
    name: q.author.name || null,
    avatarUrl: q.author.avatarUrl,
    verified: q.author.verified,
    createdAtMs: q.createdAtMs,
    text: q.text || null,
    media: q.media,
    card: q.card ?? null,
    metrics: q.metrics,
  };
}

/**
 * A nested tweet (reply parent or quoted tweet) rendered as its own mini
 * card: optional author header, text, media, link-card, and metrics.
 * Shared by both slots so they showcase identically.
 */
export function NestedTweet({ data }: { data: NestedData }) {
  const name = data.name || data.handle;
  const ageMs = data.createdAtMs != null ? Date.now() - data.createdAtMs : null;
  // gap-2.5 matches NESTED_CARD's p-2.5 → uniform 10px rhythm, so the metrics
  // row sits equidistant from the media above and the card edge below.
  return (
    <div data-tweet-box="nested" className={`flex flex-col gap-2.5 ${NESTED_CARD}`}>
      {name || data.avatarUrl ? (
        <span className="flex min-w-0 items-center gap-1 text-[11px]">
          {data.avatarUrl ? <Avatar url={data.avatarUrl} name={name ?? '?'} size={18} /> : null}
          {name ? (
            <span className="truncate font-semibold" style={{ color: 'var(--ink-1)' }}>
              {name}
            </span>
          ) : null}
          {data.verified ? <VerifiedBadge /> : null}
          {data.handle ? (
            <span className="truncate" style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
              @{data.handle}
            </span>
          ) : null}
          {ageMs != null ? (
            <span
              className="ml-auto shrink-0 text-[11px] tabular-nums leading-none"
              style={{ color: ageColorVar(ageMs), fontFamily: 'var(--mono)' }}
            >
              {compactAge(ageMs)}
            </span>
          ) : null}
        </span>
      ) : null}
      {data.text ? (
        <p
          className="whitespace-pre-wrap break-words text-[11px] leading-[1.4]"
          style={{ color: 'var(--ink-2)' }}
        >
          {renderTweetText(data.text)}
        </p>
      ) : null}
      <TweetMediaBlock media={data.media} />
      <LinkCard card={data.card} />
      <NestedMetrics metrics={data.metrics} />
    </div>
  );
}

/**
 * Compact metrics line for nested tweets. Always renders all five slots
 * (missing values fall back to 0) for a stable layout.
 * Order: likes · comments · retweets · impressions · bookmarks.
 */
function NestedMetrics({ metrics }: { metrics?: TweetMetrics | null }) {
  const m = metrics ?? {};
  const items: Array<{ icon: ReactNode; value: number }> = [
    { icon: <HeartIcon size={13} />, value: m.likes ?? 0 },
    { icon: <ReplyIcon size={13} />, value: m.replies ?? 0 },
    { icon: <RepostIcon size={13} />, value: m.retweets ?? 0 },
    { icon: <EyeIcon size={13} />, value: m.views ?? 0 },
    { icon: <BookmarkIcon size={13} />, value: m.bookmarks ?? 0 },
  ];
  return (
    <div
      className="flex items-center justify-between text-[11px] tabular-nums leading-none"
      style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
    >
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1 leading-none">
          {it.icon}
          <span className="leading-none">{compactLower(it.value)}</span>
        </span>
      ))}
    </div>
  );
}
