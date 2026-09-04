/**
 * REVISION SYNC, as words — is the evaluator on the version you edited?
 * (CONTRACT-3 §B.2.) Pure: the wire block in, the status-line word, its
 * hover and the Activity row out.
 *
 * Absent is not pending: an older api serves no `sync`, an unreachable
 * event plane serves `null`, and both derive to `null` here — the page
 * says nothing rather than guessing. Only a served `in_sync: false` draws.
 */

import type { ConditionalEvent, ConditionalSyncState } from '@/lib/conditionals';

export interface SyncHold {
  /** The status-line word, `--hold` toned. */
  readonly word: string;
  /** The hover: which version the evaluator is on, and which is coming. */
  readonly title: string;
  /** The Activity row's lead. */
  readonly lead: string;
}

/** `null` unless the server said the evaluator lags. */
export function syncHold(sync: ConditionalSyncState | null | undefined): SyncHold | null {
  if (sync === null || sync === undefined || sync.in_sync) return null;
  const armed = sync.armed_version === null ? 'no version yet' : `v${sync.armed_version}`;
  return {
    word: 'Edit pending',
    title: `The evaluator is still on ${armed}; v${sync.platform_version} is syncing`,
    lead: `Revision v${sync.platform_version}, waiting for the evaluator`,
  };
}

/**
 * The instant the Activity row sits at: the latest `revision_applied`
 * journal row (the edit it is waiting on), or `null` when the journal has
 * none — the caller falls back to its own clock.
 */
export function syncHoldAtMs(events: readonly ConditionalEvent[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (event.transition !== 'revision_applied') continue;
    const ms = Date.parse(event.created_at);
    if (!Number.isFinite(ms)) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}
