import { memo } from 'react';
import type { TweetDTO } from '@/lib/api/tweet';
import { compactAge, compactNumber } from '@/lib/format';
import { renderTweetText } from '@/components/tweet/render-text';
import { XLogo } from '@/components/tweet/icons';
import './tracker-tweet.css';

/**
 * One post in the tracker's feed.
 *
 * This used to mount `TweetCardHeader` + `TweetCardBody` — the HOVER
 * CARD's own two halves. That card introduces a stranger: it carries a
 * bordered plate, a divider under the identity, a "joined · followers"
 * line, four brand-coloured metric icons and a "Read more on X" button.
 * Correct for a card that opens over a token you have never seen; wrong
 * six times in a column, where it reads as a stack of business cards.
 *
 * So this is its own thing: a feed row. Identity on one line, the text,
 * the pictures, and one grey line of counts. The whole row is the link
 * out to X — selection still works, since a drag selects and only a
 * plain click navigates.
 *
 * Memoized: a streamed tweet prepends without re-rendering the retained
 * rows. `ageTick` is the parent's coarse clock — it is not read here,
 * but bumping it defeats the memo so the ages keep advancing.
 */
export const TrackerTweet = memo(function TrackerTweet({ tweet }: { tweet: TweetDTO; ageTick?: number }) {
  const { author } = tweet;
  const age = tweet.createdAtMs != null ? compactAge(Date.now() - tweet.createdAtMs) : null;
  const images = tweet.media.images.slice(0, 4);
  const video = tweet.media.videos[0] ?? null;
  const m = tweet.metrics;
  const initial = (author.name || author.handle).trim()[0]?.toUpperCase() ?? '?';
  const hue = [...(author.name || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

  return (
    <a className="tw" href={tweet.url} target="_blank" rel="noreferrer">
      <span
        className="tw-pfp"
        style={author.avatarUrl ? undefined : { background: `hsl(${hue}, 24%, 22%)`, color: `hsl(${hue}, 55%, 75%)` }}
      >
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl.replace('_normal', '_400x400')}
            alt=""
            draggable={false}
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </span>

      <span className="tw-main">
        <span className="tw-who">
          <span className="tw-name">{author.name || author.handle}</span>
          {author.verified ? <img className="tw-check" src="/assets/x_blue_check_icon.svg" alt="" aria-label="Verified" /> : null}
          <span className="tw-at">@{author.handle}</span>
          {age ? (
            <>
              <span className="tw-dot" aria-hidden>·</span>
              <span className="tw-age">{age}</span>
            </>
          ) : null}
          <span className="tw-x" aria-hidden>
            <XLogo size={13} />
          </span>
        </span>

        {tweet.text ? <p className="tw-text">{renderTweetText(tweet.text)}</p> : null}

        {video ? (
          <video
            className="tw-video"
            src={video.url}
            poster={video.poster ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            onError={(e) => {
              (e.currentTarget as HTMLVideoElement).style.display = 'none';
            }}
          />
        ) : images.length > 0 ? (
          <span className="tw-media" data-n={images.length}>
            {images.map((img, i) => (
              <img
                key={`${img.url}-${i}`}
                src={img.url}
                alt=""
                loading="lazy"
                draggable={false}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ))}
          </span>
        ) : null}

        {m ? (
          <span className="tw-stats">
            <Stat value={m.replies}>
              <path d="M20.5 12.4c0 4.1-3.8 7.4-8.5 7.4a10 10 0 0 1-2.6-.3l-5 1.9 1.6-4.2a7 7 0 0 1-2-4.8C4 8.3 7.8 5 12.5 5s8 3.3 8 7.4Z" />
            </Stat>
            <Stat value={m.retweets}>
              <path d="M4 8.5h11.5a3 3 0 0 1 3 3V15M4 8.5 7 5.5M4 8.5l3 3" />
              <path d="M20 15.5H8.5a3 3 0 0 1-3-3V9M20 15.5l-3 3M20 15.5l-3-3" />
            </Stat>
            <Stat value={m.likes}>
              <path d="M12 19.5S4 15 4 9.9A4 4 0 0 1 12 8a4 4 0 0 1 8 1.9c0 5.1-8 9.6-8 9.6Z" />
            </Stat>
            <Stat value={m.views}>
              <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
              <circle cx="12" cy="12" r="2.6" />
            </Stat>
          </span>
        ) : null}
      </span>
    </a>
  );
});

/** One count and its mark, both in the panel's grey. */
function Stat({ value, children }: { value: number | null | undefined; children: React.ReactNode }) {
  return (
    <span className="tw-stat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {compactNumber(value ?? 0)}
    </span>
  );
}
