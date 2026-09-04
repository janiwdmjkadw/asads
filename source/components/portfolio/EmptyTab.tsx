'use client';

import { Caption } from '@/components/listen/primitives';

/**
 * Slice "Portfolio page wallets tab": placeholder body for the
 * Spot / Perpetuals tabs until their own implementations land.
 */
export function EmptyTab(props: {
  readonly title: string;
  readonly caption: string;
}): React.ReactElement {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2">
      <span
        style={{
          color: 'var(--ink-0)',
          fontSize: 22,
          letterSpacing: '-0.01em',
          fontFamily: 'var(--display)',
        }}
      >
        {props.title}
      </span>
      <Caption tone="ink-3">{props.caption}</Caption>
    </div>
  );
}
