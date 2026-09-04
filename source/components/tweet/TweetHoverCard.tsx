'use client';

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useCardVisibility } from '@/components/discover/layout/cardVisibility';
import { prewarmTweet } from '@/lib/api/tweet';
import { markTweetIntent } from './useTweet';
import { TweetCard } from './TweetCard';

interface Props {
  tweetId: string;
  tweetUrl: string;
  /** The trigger element (the X icon). Rendered via `asChild`, so no extra
   *  DOM node is introduced and the caller's click/keyboard handlers keep
   *  bubbling unchanged — same contract as `TokenImagePreview`. */
  children: ReactNode;
}

// openDelay 0: the card opens the instant the cursor touches the icon (no
// intent gate). Prewarm fires on pointer-enter and (ideally) on feed-arrival
// so the body is warm by the time it opens.
const OPEN_DELAY_MS = 0;
const CLOSE_DELAY_MS = 140;

/**
 * Hovering the X icon pops a compact, scrollable preview of the source
 * tweet. The card (`TweetCard`) mounts lazily — only while open — and open
 * state lives in the Radix portal, so parent cards never re-render on hover.
 */
export function TweetHoverCard({ tweetId, tweetUrl, children }: Props) {
  // Feed-arrival prewarm: fetch the tweet as soon as the icon renders, so the
  // card opens against a warm cache with openDelay=0 (no skeleton on first
  // hover). prewarmTweet de-dupes (cache + in-flight), so a feed of many icons
  // fetches each tweet at most once. Gated on card visibility so a churning
  // off-screen lane doesn't generate a steady background fetch stream; the
  // context defaults to true where no lane provides it (e.g. the trade page),
  // and pointer intent (below) still prewarms on demand either way.
  const visible = useCardVisibility();
  useEffect(() => {
    if (!visible) return;
    prewarmTweet(tweetId);
  }, [tweetId, visible]);

  const onIntent = useCallback(() => {
    markTweetIntent(tweetId);
    prewarmTweet(tweetId);
  }, [tweetId]);

  const trigger = isValidElement(children) ? (
    cloneElement(
      children as ReactElement<{
        onPointerEnter?: (e: ReactPointerEvent) => void;
        onFocus?: (e: ReactFocusEvent) => void;
      }>,
      {
        onPointerEnter: composeHandler(
          (children as ReactElement<{ onPointerEnter?: (e: ReactPointerEvent) => void }>).props
            .onPointerEnter,
          onIntent,
        ),
        onFocus: composeHandler(
          (children as ReactElement<{ onFocus?: (e: ReactFocusEvent) => void }>).props.onFocus,
          onIntent,
        ),
      },
    )
  ) : (
    <>{children}</>
  );

  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        /* Strip the popover's default chrome; the inner card owns its own
           surface so it reads as a tweet card, not a tooltip. `duration-100`
           tightens the shadcn enter/exit animation so the card settles fast. */
        className="w-auto border-0 bg-transparent p-0 shadow-none duration-100"
      >
        <TweetCard tweetId={tweetId} tweetUrl={tweetUrl} />
      </HoverCardContent>
    </HoverCard>
  );
}

function composeHandler<E>(
  theirs: ((e: E) => void) | undefined,
  ours: (e: E) => void,
): (e: E) => void {
  return (e) => {
    theirs?.(e);
    ours(e);
  };
}
