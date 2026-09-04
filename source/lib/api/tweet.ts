/**
 * Tweet data layer — the normalized `TweetDTO` contract plus the
 * client-side resolver, cache, and prewarm primitives that power the
 * tweet hover card.
 *
 * The DTO is j7-shaped on purpose: it is the durable contract the
 * whole feature standardizes on, so the backend resolution order
 * (j7 cache -> deferred fallbacks) can fill it with whatever fidelity
 * each source offers without the UI caring which source won.
 *
 * Latency model: hover must be a cache read, never a cold fetch. The
 * cache + in-flight de-dupe here make repeated hovers and copycat
 * mints (which reuse the same source tweet) collapse onto a single
 * resolution. Callers prewarm on feed-arrival / hover-intent so the
 * card opens against warm data.
 *
 * `fetchTweet` resolves against the terminal's own `GET /api/tweet/{id}`
 * route, which reads the `tweets` table in Supabase (populated by the
 * input engine's live j7 capture). A dev-only fixture fallback covers
 * local work without the backend.
 */

export interface TweetAuthor {
  handle: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  /** From j7 `author.followersCount`; null when the source omits it. */
  followersCount: number | null;
  /** Account creation time. Needs a profile source — best-effort, often null. */
  joinedAtMs: number | null;
}

export interface TweetImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface TweetVideo {
  /** Direct mp4 variant, ready for an autoplay `<video>`. */
  url: string;
  /** Poster frame painted before the first video frame decodes. */
  poster?: string | null;
  durationMs?: number | null;
}

export interface TweetMedia {
  images: TweetImage[];
  videos: TweetVideo[];
}

export interface TweetMetrics {
  /** From j7 `tweet_update`; absent until an update lands. */
  views?: number | null;
  likes?: number | null;
  retweets?: number | null;
  replies?: number | null;
  bookmarks?: number | null;
}

/** Link-preview card (e.g. a news-article embed) attached to a tweet. */
export interface TweetCard {
  url: string;
  image?: string | null;
  title?: string | null;
  description?: string | null;
}

/**
 * A nested tweet (the reply parent), rendered as its own mini card with
 * its text, media, link-card, and metrics.
 */
export interface TweetRef {
  id: string | null;
  handle: string;
  name?: string | null;
  avatarUrl?: string | null;
  verified?: boolean;
  /** Parent tweet publish time in epoch ms; null when the source omits it. */
  createdAtMs?: number | null;
  text?: string | null;
  media?: TweetMedia | null;
  card?: TweetCard | null;
  metrics?: TweetMetrics | null;
}

export type TweetSource = 'j7' | 'twitter_api' | 'syndication' | 'fixture';

export interface TweetDTO {
  id: string;
  url: string;
  /** Tweet publish time in epoch ms; null when the source omits it. */
  createdAtMs: number | null;
  text: string;
  lang?: string | null;
  author: TweetAuthor;
  media: TweetMedia;
  metrics: TweetMetrics | null;
  /** Link-preview card (news article, etc.) when present. */
  card?: TweetCard | null;
  replyTo?: TweetRef | null;
  /** Quoted tweet, kept structured (never flattened into the text). */
  quoted?: TweetDTO | null;
  source: TweetSource;
  capturedAtMs: number;
}

/** Discriminated result so callers handle miss/error without try/catch. */
export type TweetResult =
  | { kind: 'ok'; tweet: TweetDTO }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

/**
 * Parse the numeric status ID out of a tweet URL. Returns null for
 * profile / community / non-status links (those have no single tweet
 * to preview) and for anything unparseable.
 */
export function parseTweetStatusId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const match = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i.exec(trimmed);
  if (match?.[1]) return match[1];
  if (/^\d{5,25}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * The id used to gate the hover-card trigger: a real `/status/<id>` tweet
 * id, or null for profile / community / missing links (which have no single
 * tweet to preview). The hover card only mounts when this is non-null, so a
 * token whose `twitter` is a bare profile — or absent — gets no preview and
 * no handle/follower readout.
 *
 * Dev note: the local fixture is exercised via the `/dev/tweet` playground
 * (which passes `'fixture'` directly), NOT by forcing every icon to a
 * fixture id — that made non-tweet tokens render the fixture's author.
 */
export function hoverTweetId(twitterUrl: string | null | undefined): string | null {
  return parseTweetStatusId(twitterUrl);
}

/* ── Module-scoped cache + in-flight de-dupe ─────────────────────────
   Module scope (not React state) so the cache survives card unmounts
   on scroll and is shared across every trigger. `getCachedTweet` lets
   the hook render synchronously on the warm path — the whole point of
   the latency budget. */
const cache = new Map<string, TweetDTO>();
const inflight = new Map<string, Promise<TweetResult>>();
/** Session cap; oldest-inserted entries evicted first. */
const MAX_CACHED_TWEETS = 300;

/** Synchronous warm-cache read. Drives instant first paint on hover. */
export function getCachedTweet(id: string): TweetDTO | null {
  return cache.get(id) ?? null;
}

/**
 * Resolve a tweet by ID. Idempotent and de-duped: concurrent callers
 * for the same ID share one resolution, and a resolved tweet is cached
 * for the session.
 */
export function fetchTweet(id: string): Promise<TweetResult> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve({ kind: 'ok', tweet: cached });

  const existing = inflight.get(id);
  if (existing) return existing;

  const promise = resolveTweet(id)
    .then((result) => {
      if (result.kind === 'ok') {
        cache.set(id, result.tweet);
        while (cache.size > MAX_CACHED_TWEETS) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
      }
      return result;
    })
    .finally(() => {
      inflight.delete(id);
    });

  inflight.set(id, promise);
  return promise;
}

/**
 * Fire-and-forget warm-up. Call on feed-arrival (top rows) and on
 * hover-intent so the card opens against cached data. Never throws.
 */
export function prewarmTweet(id: string): void {
  if (cache.has(id) || inflight.has(id)) return;
  void fetchTweet(id).catch(() => undefined);
}

/**
 * The single resolution seam. Resolves against the terminal's
 * `GET /api/tweet/{id}` route (Supabase-backed, fed by live j7 capture).
 * A `204 No Content` means the tweet isn't cached (old/untracked) ->
 * `not_found`, and the UI degrades to the plain X link. In development we
 * fall back to the local fixture so the card can be exercised without the
 * backend.
 */
async function resolveTweet(id: string): Promise<TweetResult> {
  // Local dev resolves the fixture directly: localhost can't reach the
  // private Aurora, and UI iteration wants an instant, offline, rich card.
  // Production (NODE_ENV=production) always uses live data.
  if (process.env.NODE_ENV !== 'production') {
    const { resolveFixtureTweet } = await import('./tweet-fixture');
    return resolveFixtureTweet(id);
  }
  return fetchTweetFromApi(id);
}

async function fetchTweetFromApi(id: string): Promise<TweetResult> {
  try {
    // The route serves `cache-control: public, max-age=30` — let the browser/CDN
    // honor it so reloads and repeat hover-prewarms are served off-origin.
    const res = await fetch(`/api/tweet/${encodeURIComponent(id)}`, { cache: 'default' });
    // 204 No Content is the canonical "not cached" response (an expected miss
    // that stays out of the console). Must be handled BEFORE `res.ok` /
    // `res.json()` since 204 is a 2xx with an empty body that would throw on
    // parse. 404 is still accepted for one rolling-deploy window in case a
    // stale server build is serving the old contract.
    if (res.status === 204 || res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return { kind: 'error', message: `tweet fetch ${res.status}` };
    const dto = (await res.json()) as TweetDTO;
    if (!dto || typeof dto.id !== 'string') {
      return { kind: 'error', message: 'malformed tweet payload' };
    }
    return { kind: 'ok', tweet: dto };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message ?? 'network error' };
  }
}
