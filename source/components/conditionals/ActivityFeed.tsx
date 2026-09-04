'use client';

/**
 * TAB 1 · ACTIVITY — everything that has happened, newest first, banded by
 * the run it happened in.
 *
 * It replaces two shipped objects at once: the journey rail (a five-slot
 * ruler that answered "how far", on a page whose question is "what") and
 * the "What has fired" box (which answered the second half only). One
 * feed answers both, and it can say the things neither could — that the
 * plan was armed twice, why it paused, and what each fill moved.
 *
 * The plan-level events ride the SAME rows as the fills. There is no
 * second lane and no second type of row: "Approved", "Paused", "Expired"
 * and "Buy filled" are all one sentence with one clock, and only the two
 * that moved the wallet reach the figure column.
 */

import type { ReactElement } from 'react';
import { SolMark } from '@/components/agent/proposal/v2/marks';
import type { FeedGroup, FeedRow } from './event-feed';
import {
  FEED_INLINE,
  FEED_ROW,
  FEED_SENTENCE,
  FeedFigure,
  FeedGroupHeader,
  FeedMarkGlyph,
  FeedSection,
  FeedTime,
} from './feed-row';

function Sentence({ row }: { readonly row: FeedRow }): ReactElement {
  return (
    <span className={FEED_SENTENCE} data-testid="cd-feed-text">
      {row.lead}
      {row.figure === null ? null : (
        <>
          {' '}
          <b
            className={`${FEED_INLINE} text-[var(--ink-0)]`}
          >
            {row.figure}
          </b>
          {row.figureSol ? <SolMark /> : null}
        </>
      )}
      {row.trail === '' ? null : <>{' '}{row.trail}</>}
    </span>
  );
}

export function ActivityFeed({ groups }: { readonly groups: readonly FeedGroup[] }): ReactElement {
  if (groups.length === 0) {
    return (
      <FeedSection testId="cd-activity">
        <p className="px-[2px] py-[22px] text-[13.5px] leading-[1.5] text-[var(--ink-2)]">
          Nothing has happened yet. This page fills in as the plan runs.
        </p>
      </FeedSection>
    );
  }
  return (
    <FeedSection testId="cd-activity">
      {groups.map((group, index) => (
        <div
          key={group.key}
          className={index === 0 ? '' : 'mt-[30px]'}
          data-testid="cd-feed-group"
          data-group={group.key}
        >
          <FeedGroupHeader title={group.title} date={group.date} />
          {group.rows.map((row) => (
            <div
              key={row.key}
              className={FEED_ROW}
              data-testid="cd-feed-row"
              {...(row.hold ? { 'data-hold': 'true' } : {})}
            >
              <FeedMarkGlyph mark={row.mark} hold={row.hold} />
              <Sentence row={row} />
              <FeedFigure delta={row.delta} />
              <FeedTime at={row.at} />
            </div>
          ))}
        </div>
      ))}
    </FeedSection>
  );
}
