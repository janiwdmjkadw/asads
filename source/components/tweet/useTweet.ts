'use client';

import { useEffect, useState } from 'react';
import { fetchTweet, getCachedTweet, type TweetDTO } from '@/lib/api/tweet';

export type TweetState =
  | { status: 'idle'; tweet: null }
  | { status: 'loading'; tweet: null }
  | { status: 'ready'; tweet: TweetDTO }
  | { status: 'not_found'; tweet: null }
  | { status: 'error'; tweet: null };

/* Dev-only latency probe: time from hover-intent to first ready paint.
   Keyed by tweet id so concurrent triggers don't clobber each other.
   No-ops in production and where the Performance API is unavailable. */
const INTENT_MARK = (id: string) => `tweet-intent:${id}`;
const isDev = process.env.NODE_ENV !== 'production';

export function markTweetIntent(id: string): void {
  if (!isDev || typeof performance === 'undefined') return;
  try {
    performance.mark(INTENT_MARK(id));
  } catch {
    // best-effort instrumentation only
  }
}

function measureIntentToPaint(id: string): void {
  if (!isDev || typeof performance === 'undefined') return;
  try {
    const marks = performance.getEntriesByName(INTENT_MARK(id));
    if (marks.length === 0) return;
    const ms = Math.round(performance.now() - marks[marks.length - 1]!.startTime);
    console.debug(`[tweet] intent -> paint ${ms}ms (id=${id})`);
    performance.clearMarks(INTENT_MARK(id));
  } catch {
    // best-effort instrumentation only
  }
}

/**
 * Resolve a tweet for display. Reads the module cache synchronously so
 * a prewarmed tweet renders on the first frame (no loading flash), and
 * only falls back to an async fetch on a cold cache. `enabled` gates
 * the fetch so the hover card does no work until it actually opens.
 */
export function useTweet(id: string | null, enabled: boolean): TweetState {
  const [state, setState] = useState<TweetState>(() => {
    if (!id || !enabled) return { status: 'idle', tweet: null };
    const cached = getCachedTweet(id);
    return cached ? { status: 'ready', tweet: cached } : { status: 'loading', tweet: null };
  });

  useEffect(() => {
    if (!id || !enabled) {
      setState({ status: 'idle', tweet: null });
      return;
    }

    const cached = getCachedTweet(id);
    if (cached) {
      setState({ status: 'ready', tweet: cached });
      measureIntentToPaint(id);
      return;
    }

    let active = true;
    setState({ status: 'loading', tweet: null });
    void fetchTweet(id).then((result) => {
      if (!active) return;
      if (result.kind === 'ok') {
        setState({ status: 'ready', tweet: result.tweet });
        measureIntentToPaint(id);
      } else if (result.kind === 'not_found') {
        setState({ status: 'not_found', tweet: null });
      } else {
        setState({ status: 'error', tweet: null });
      }
    });

    return () => {
      active = false;
    };
  }, [id, enabled]);

  return state;
}
