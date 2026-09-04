import type { TweetDTO } from '@/lib/api/tweet';
import { LinkCard } from './LinkCard';
import { NestedTweet, quotedToNested, refToNested } from './NestedTweet';
import { TweetCardFooter } from './TweetCardFooter';
import { TweetMediaBlock } from './TweetMedia';
import { renderTweetText } from './render-text';
import { RHYTHM } from './tweet-styles';

/**
 * Tweet content box. For a reply this reads top-to-bottom like X's detail
 * view: a "replying to @handle" context line, then the reply's own text +
 * media, then the parent tweet as a nested subcard below. A pure quote
 * renders the quoted tweet as that subcard instead. Vertical rhythm comes
 * from `space-y` (rule 6); this box owns no scroll — that lives on the shell.
 */
export function TweetCardBody({ tweet }: { tweet: TweetDTO }) {
  // At most one nested parent: the reply parent wins (keeps the reply layout
  // coherent with its "replying to" line); otherwise fall back to the quote.
  const nested = tweet.replyTo
    ? refToNested(tweet.replyTo)
    : tweet.quoted
      ? quotedToNested(tweet.quoted)
      : null;

  // pt-2: a small breathing gap below the header divider (the body owns its
  // divider-facing top edge; the header owns the gap above the divider).
  // Outer bottom padding comes from the shell. Inter-element rhythm: space-y.
  return (
    <div data-tweet-box="body" className={`pt-2 ${RHYTHM}`}>
      {tweet.replyTo ? <ReplyContext handle={tweet.replyTo.handle} /> : null}

      {tweet.text ? (
        <p
          className="whitespace-pre-wrap break-words text-sm leading-[1.45]"
          style={{ color: 'var(--ink-0)' }}
        >
          {renderTweetText(tweet.text)}
        </p>
      ) : null}

      <LinkCard card={tweet.card} />

      <TweetMediaBlock media={tweet.media} />

      {nested ? <NestedTweet data={nested} /> : null}

      <TweetCardFooter tweet={tweet} />
    </div>
  );
}

/**
 * "│ replying to @handle" context line above a reply's own text. A
 * fixed-height box carrying the thread-bar (border-l) with the text
 * vertically centered — no padding tricks.
 */
function ReplyContext({ handle }: { handle: string }) {
  const h = handle.replace(/^@/, '');
  return (
    <div
      className="flex h-6 items-center border-l-2 pl-2.5 text-xs leading-none"
      style={{ borderColor: 'var(--hairline-2)', color: 'var(--ink-3)' }}
    >
      <span>
        replying to{' '}
        <a
          href={`https://x.com/${h}`}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
          style={{ color: 'var(--accent-primary)' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          @{h}
        </a>
      </span>
    </div>
  );
}
