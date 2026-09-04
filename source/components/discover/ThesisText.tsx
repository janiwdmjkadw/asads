'use client';

import { useMemo, type CSSProperties } from 'react';
import { splitThesisTweetLinks } from '@/lib/api/alpha-calls-shared';

/**
 * Thesis body with x.com links swapped IN PLACE for clickable red TWEET
 * chips (x.com is the only link host a thesis may carry — see
 * checkThesis / the api's validateThesis). Used by the alpha card
 * description and the trade-chart thesis popover so the two surfaces
 * render one thesis identically. Chips stop propagation: theses live on
 * clickable cards and the chart overlay, and a chip click must open the
 * tweet, never navigate the card.
 */
export function ThesisText({ text }: { text: string }) {
  const segments = useMemo(() => splitThesisTweetLinks(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open tweet: ${segment.value}`}
            title={segment.value}
            className="inline-flex items-center align-middle rounded px-[5px] mx-[2px] whitespace-nowrap"
            style={TWEET_CHIP_STYLE}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            TWEET
          </a>
        ),
      )}
    </>
  );
}

/* Red per spec — matches the app's down/danger red family rather than a
   raw #f00 so it sits inside the existing palette. Non-italic mono caps
   so the chip reads as a button even inside the italic thesis body. */
const TWEET_CHIP_STYLE: CSSProperties = {
  height: 15,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.1em',
  lineHeight: 1,
  fontFamily: 'var(--mono)',
  fontStyle: 'normal',
  color: '#ff6b81',
  background: 'color-mix(in srgb, #fb5374 14%, transparent)',
  border: '1px solid color-mix(in srgb, #fb5374 45%, transparent)',
  textDecoration: 'none',
};
