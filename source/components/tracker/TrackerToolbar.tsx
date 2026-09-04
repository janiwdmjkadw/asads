'use client';

import type { ReactNode } from 'react';

/**
 * The row under a tracker panel's header: the add-field, and nothing
 * else.
 *
 * It used to carry a second row beneath the field with the column gear
 * and an "N tracked" popout on it. The gear moved up beside the panel's
 * own title, where panel-level controls belong, and the count row went
 * with it — leaving the field the whole width, which is what it wanted
 * at dock sizes anyway.
 *
 * The extra props stay in the signature because both panels still know
 * these things and will hand them to whatever carries the tracked list
 * next; nothing reads them while the row is gone.
 */
export function TrackerToolbar({
  field,
}: {
  /** The AddTrackerField element. */
  field: ReactNode;
  count?: number;
  /** Plural noun for labels, e.g. "wallets" / "accounts". */
  noun?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return <div className="min-w-0">{field}</div>;
}
