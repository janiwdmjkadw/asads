'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAgeTick } from '@/hooks/use-age-tick';
import {
  getTweetChimeMuted,
  primeAttentionSoundsOnGesture,
  setTweetChimeMuted,
} from '@/components/discover/attentionSounds';
import type { TweetDTO } from '@/lib/api/tweet';
import { normalizeHandle } from '@/lib/api/tracker';
import { AddTrackerField, type FieldStatus, type FieldSuggestion } from './AddTrackerField';
import { ChipRow, TrackedChip } from './TrackedChip';
import { useTrackableAccounts, useTrackedAccounts, useTrackerTweets } from './hooks';
import { EDGE, FEED_RHYTHM } from './panel-styles';
import { PanelEmpty, TrackerPanel } from './TrackerPanel';
import { TrackerToolbar } from './TrackerToolbar';
import { PanelList, PanelSection, PanelSetting, PanelSettingsButton } from './PanelSettingsButton';
import { TrackerTweet } from './TrackerTweet';

export interface TweetsPanelMeta {
  /** Tracked-account count (drives the host's count chip). */
  count: number;
  /** True while the feed holds at least one tweet. */
  live: boolean;
  /** True while hover-to-pause has the list frozen. */
  paused: boolean;
}

export function TweetsPanel({
  chromeless = false,
  toolbarVisible = true,
  onMetaChange,
}: {
  /**
   * Embedded mode for the Discover/Trade dock: the dock renders its own
   * glass header (title, count, live dot, pause chip, chime bell), so
   * the panel's internal header would stack a second title bar on top —
   * suppress it and report the header's data via `onMetaChange` instead.
   */
  chromeless?: boolean;
  /**
   * The dock reveals the manage toolbar (add-field, bulk buttons, chip
   * popout) only while the user is clicked INTO the panel; when hidden
   * the feed gets the full height. The Trackers page keeps it always on.
   */
  toolbarVisible?: boolean;
  /** Live header data for a `chromeless` host's own chrome. */
  onMetaChange?: (meta: TweetsPanelMeta) => void;
} = {}) {
  const trackable = useTrackableAccounts();
  const accounts = useTrackedAccounts();
  const { tweets, isLoading } = useTrackerTweets(accounts.handles);

  const trackedSet = useMemo(() => new Set(accounts.handles), [accounts.handles]);

  // Hover-to-pause: the feed both prepends AND re-sorts on every stream
  // event (hooks.ts merges query + stream by createdAtMs), so a tweet the
  // user is reading can slide out from under the cursor. While the pointer
  // is over the feed the rendered list is a frozen snapshot; pointer-leave
  // snaps back to live. Mouse only — a touch "enter" has no matching leave.
  const [pausedTweets, setPausedTweets] = useState<TweetDTO[] | null>(null);
  const paused = pausedTweets !== null;
  const displayTweets = pausedTweets ?? tweets;
  // Untracking the last handle unmounts the feed (and its pointer-leave)
  // while frozen — drop the stale snapshot so it cannot resurface.
  useEffect(() => {
    if (accounts.handles.length === 0) setPausedTweets(null);
  }, [accounts.handles.length]);

  // Mirror of the persisted tweet-chime mute (attentionSounds reads the
  // storage at play time; this state only drives the bell icon).
  const [chimeMuted, setChimeMuted] = useState(false);
  useEffect(() => {
    setChimeMuted(getTweetChimeMuted());
  }, []);
  // The chime must be able to ring wherever this panel mounts (Trackers
  // page, trade dock) — not only when the Discover page installed the
  // one-shot AudioContext unlock.
  useEffect(() => primeAttentionSoundsOnGesture(), []);

  // One adaptive clock for every memoized row (same pattern as
  // WalletActivityFeed): rows skip re-renders on new-tweet prepends; this
  // tick re-renders them so relative ages keep advancing — every second
  // while the newest tweet is seconds-old, every 30s otherwise.
  const ageTick = useAgeTick(tweets[0]?.createdAtMs ?? null, tweets.length > 0);

  // Chromeless hosts (the dock) own the header row; feed them the data
  // it displays. Effect-reported (not render-called) so the host's
  // setState never fires during this component's render.
  const count = accounts.handles.length;
  const live = tweets.length > 0;
  useEffect(() => {
    onMetaChange?.({ count, live, paused });
  }, [onMetaChange, count, live, paused]);

  function getStatus(raw: string): FieldStatus {
    if (!raw.trim()) {
      return { tone: 'idle', text: 'Type a handle to track, e.g. @elonmusk', canSubmit: false, value: null };
    }
    const handle = normalizeHandle(raw);
    if (!handle) {
      return { tone: 'error', text: 'Letters, numbers, and _ only (max 15)', canSubmit: false, value: null };
    }
    if (trackedSet.has(handle)) {
      return { tone: 'warn', text: `Already tracking @${handle}`, canSubmit: false, value: null };
    }
    // Empty set = not loaded yet / dev — don't block. Once loaded, only
    // handles we actually capture tweets for can be tracked.
    const available = trackable.handleSet.size === 0 || trackable.handleSet.has(handle);
    if (!available) {
      return { tone: 'warn', text: `@${handle} isn't in our tracked set yet`, canSubmit: false, value: null };
    }
    return { tone: 'ok', text: `Press Track to follow @${handle}`, canSubmit: true, value: handle };
  }

  function getSuggestions(raw: string): FieldSuggestion[] {
    const q = raw.trim().replace(/^@+/, '').toLowerCase();
    return trackable.accounts
      .filter((a) => !trackedSet.has(a.handle) && (q === '' || a.handle.startsWith(q)))
      .slice(0, 6)
      .map((a) => ({ key: a.handle, label: `@${a.handle}`, sub: a.tweets > 0 ? `${a.tweets}` : undefined }));
  }

  const toolbar = (
    <TrackerToolbar
      count={accounts.handles.length}
      noun="accounts"
      field={
        <AddTrackerField
          placeholder="Add @handle…"
          leading={<span className="text-[12px]">@</span>}
          getStatus={getStatus}
          getSuggestions={getSuggestions}
          onSubmit={async (value) => {
            try {
              await accounts.add(value);
              return null;
            } catch (e) {
              return (e as Error).message ?? 'Failed to track';
            }
          }}
        />
      }
    >
      <ChipRow>
        {accounts.handles.map((handle) => (
          <TrackedChip key={handle} label={`@${handle}`} onRemove={() => accounts.remove(handle)} />
        ))}
      </ChipRow>
    </TrackerToolbar>
  );

  return (
    <TrackerPanel
      title="Tweets"
      count={accounts.handles.length}
      hideHeader={chromeless}
      toolbar={toolbarVisible ? toolbar : undefined}
      /* The same gear the wallets panel wears, in the same place. The
         bell that used to live at the far right of this bar is inside
         it: a lone icon toggle for one preference, sitting apart from
         the panel's other chrome, was a settings menu with one item and
         no name on it. */
      afterCount={
        <PanelSettingsButton label="Accounts and feed settings" title="Accounts">
          <PanelSection>Feed</PanelSection>
          <div className="tk-switches">
          <PanelSetting
            checked={!chimeMuted}
            onChange={(next) => {
              setTweetChimeMuted(!next);
              setChimeMuted(!next);
            }}
          >
            New tweet sound
          </PanelSetting>
          </div>

          {/* The tracked handles, and the one verb they have. Adding is
              the field below; this is where you take one back out. */}
          {accounts.handles.length > 0 ? (
            <>
              <PanelSection>Tracked · {accounts.handles.length}</PanelSection>
              <PanelList
                items={accounts.handles.map((h) => ({ key: h, label: `@${h}` }))}
                onRemove={(h) => accounts.remove(h)}
                placeholder="Find an account…"
                noun="accounts"
              />
            </>
          ) : null}
        </PanelSettingsButton>
      }
      right={paused ? <PausedChip /> : null}
    >
      {accounts.handles.length === 0 ? (
        <PanelEmpty
          title="No accounts tracked"
          hint={
            toolbarVisible
              ? 'Add a handle above to start a live tweet feed. 0 accounts are tracked by default.'
              : 'Click into the panel to add handles and start a live tweet feed.'
          }
        />
      ) : isLoading && displayTweets.length === 0 ? (
        <div className={`${EDGE} ${FEED_RHYTHM} py-3`}>
          {[0, 1, 2].map((i) => (
            <TweetSkeleton key={i} />
          ))}
        </div>
      ) : displayTweets.length === 0 ? (
        <PanelEmpty title="Waiting for tweets" hint="No recent tweets from your tracked accounts yet." />
      ) : (
        /* The feed is one column, edge to edge: the rows carry their own
           inset and their own hairline, so the gutter and the 8px rhythm
           that used to space a stack of cards would only reintroduce the
           gaps the new row is built to close. */
        <div
          className="tw-feed"
          onPointerEnter={(e) => {
            if (e.pointerType === 'touch') return;
            setPausedTweets(tweets);
          }}
          onPointerLeave={() => setPausedTweets(null)}
        >
          {displayTweets.map((tweet) => (
            <TrackerTweet key={tweet.id} tweet={tweet} ageTick={ageTick} />
          ))}
        </div>
      )}
    </TrackerPanel>
  );
}

/*
 * TRACK ALL and UNTRACK ALL were here, beside the add-field.
 *
 * Neither is a thing anyone wants: tracking every handle the capture has
 * ever seen is not a feed, it is noise with a subscription, and dropping
 * all of them at once is a two-step confirm guarding an action whose
 * only safe use is a mistake. Removing a handle is what the tracked
 * popout beside them is for, one at a time, which is how anyone actually
 * curates a list.
 */

function PausedChip() {
  return (
    <span
      /* A quiet state, told quietly. It was a bordered, washed, bold
         uppercase badge in the accent — three devices to say the feed
         is asleep, which is not news worth that much ink. */
      className="inline-flex h-[18px] items-center rounded-full px-2"
      style={{
        color: 'var(--ink-3)',
        background: 'color-mix(in srgb, var(--ink-0) 7%, transparent)',
        border: '1px solid var(--hairline)',
        fontFamily: 'var(--sans)',
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      Paused
    </span>
  );
}


function TweetSkeleton() {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-3"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--hairline)' }}
      aria-hidden
    >
      <div className="flex items-center gap-2.5">
        <div className="size-10 rounded-full" style={{ background: 'var(--surface-3)' }} />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-3 w-1/2 rounded" style={{ background: 'var(--surface-3)' }} />
          <div className="h-2.5 w-1/3 rounded" style={{ background: 'var(--surface-2)' }} />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-2.5 rounded"
          style={{ background: 'var(--surface-2)', width: i === 2 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}
