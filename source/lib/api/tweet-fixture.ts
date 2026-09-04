/**
 * Local dev fixture for the tweet hover card.
 *
 * In development `resolveTweet` resolves this fixture directly (localhost
 * can't reach the private Aurora, and UI iteration wants an instant,
 * offline, content-rich card). So: run `npm run dev` in `terminal/`,
 * hover any X icon, and tweak `TweetHoverCard.tsx` with fast-refresh.
 *
 * `MAX_FIXTURE` is intentionally a "kitchen sink" tweet — long text, a
 * reply parent (with pfp), a quoted tweet (pfp + link-card + metrics), a
 * hero video, an image grid, and full footer metrics — so every icon and
 * size is on screen at once. Edit it freely to test layout variations;
 * it is never used in production.
 */

import type { TweetDTO, TweetResult } from './tweet';

const SAMPLE_VIDEO =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4';
const SAMPLE_VIDEO_POSTER =
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyrides.jpg';
const img = (seed: string, w = 600, h = 400) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (seed: string) => `https://picsum.photos/seed/${seed}/96`;

const MAX_FIXTURE: TweetDTO = {
  id: 'fixture',
  url: 'https://x.com/maxfixture/status/2061509036814528734',
  createdAtMs: Date.now() - 9 * 60_000,
  lang: 'en',
  text:
    'This is the MAX dev fixture for the hover card \uD83E\uDDEA\n\n' +
    'It packs everything in at once so you can tweak icons, spacing, and sizes ' +
    'without deploying: a long multi-paragraph body that scrolls, a reply parent ' +
    'above, a quoted tweet with a link-card below, a hero video, an image grid, ' +
    'and the full footer metrics row.\n\n' +
    'Edit `tweet-fixture.ts` to test different shapes \u2014 drop the quote, add more ' +
    'images, lengthen the text to its scroll limit, etc. Nothing here ships to ' +
    'production; it only renders on localhost.\n\n' +
    'Hover any X icon on the Discover or Trade pages to see it. https://example.com',
  author: {
    handle: 'maxfixture',
    name: 'Max Fixture',
    avatarUrl: avatar('avMain'),
    verified: true,
    followersCount: 1_234_567,
    joinedAtMs: Date.UTC(2009, 11, 1),
  },
  media: {
    images: [],
    videos: [{ url: SAMPLE_VIDEO, poster: SAMPLE_VIDEO_POSTER, durationMs: 15_000 }],
  },
  metrics: {
    views: 6_200_000,
    likes: 184_000,
    retweets: 49_700,
    replies: 9_800,
    bookmarks: 12_300,
  },
  card: null,
  replyTo: {
    id: 'fixture-parent',
    handle: 'breakingfeed',
    name: 'Breaking Feed',
    avatarUrl: avatar('avParent'),
    verified: true,
    createdAtMs: Date.now() - 2 * 3_600_000,
    text: 'Replying-to parent tweet: this thread continues below with the big news \uD83D\uDC47',
    media: { images: [{ url: img('parentImg', 600, 360) }], videos: [] },
    card: null,
    metrics: { likes: 23, retweets: 3, replies: 12, views: 14_900, bookmarks: 5 },
  },
  quoted: {
    id: 'fixture-quote',
    url: 'https://x.com/quotedinsider/status/2061500000000000000',
    createdAtMs: Date.now() - 5 * 3_600_000,
    text: 'Quoted tweet with an image grid and a link-card preview attached below.',
    author: {
      handle: 'quotedinsider',
      name: 'Quoted Insider',
      avatarUrl: avatar('avQuoted'),
      verified: true,
      followersCount: 530_000,
      joinedAtMs: Date.UTC(2012, 4, 1),
    },
    media: { images: [{ url: img('quoteA') }, { url: img('quoteB') }], videos: [] },
    metrics: { views: 6_200_000, likes: 48_000, retweets: 6_400, replies: 2_300, bookmarks: 800 },
    card: {
      url: 'https://www.bbc.com/news/articles/fixture',
      image: img('cardImg', 600, 315),
      title: 'Sample article headline that the link-card renders with its image and domain',
      description: 'A short description line the card may show beneath the title.',
    },
    replyTo: null,
    quoted: null,
    source: 'fixture',
    capturedAtMs: Date.now(),
  },
  source: 'fixture',
  capturedAtMs: Date.now(),
};

export function resolveFixtureTweet(id: string): TweetResult {
  // Keep the requested id so the URL/permalink stays sensible, but serve
  // the same rich content for any hover during local iteration.
  return { kind: 'ok', tweet: { ...MAX_FIXTURE, id } };
}
