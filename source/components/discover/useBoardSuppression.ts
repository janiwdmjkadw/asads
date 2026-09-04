'use client';

import { useCallback, useEffect } from 'react';

import { useBlacklistStore } from '@/lib/state/blacklist-store';

/**
 * EVERYTHING THAT KEEPS A COIN OFF THE BOARD, IN ONE PREDICATE.
 *
 * There were three reasons a coin could be suppressed and they arrived at
 * different times: the hidden-mint set, the dev blacklist and the handle
 * blacklist. The mint check was written inline at six separate call sites
 * in `DiscoverPage`, which is six places to keep in step every time the
 * rule changes — and the rule just changed twice.
 *
 * One hook, one predicate, six call sites that read the same way.
 *
 * ── THE TWO HIDDEN-TOKEN PREFERENCES ─────────────────────────────────
 *
 * `showHiddenTokens` shows them anyway WITHOUT unhiding them: the set is
 * untouched, so turning it back off restores exactly what was hidden
 * before. It is a way to look, not a way to undo.
 *
 * `unhideOnMigration` lets a hidden coin back once it graduates, on the
 * grounds that most hides happen in the first minutes of a launch and
 * graduating is the event that makes that judgement stale. It reads
 * `coin.graduated`, which the feed sets on migration. The mint stays in
 * the set — the coin is simply not suppressed any more — so turning the
 * preference off puts it straight back out of sight.
 *
 * ── TYPED BY WHAT IT READS ───────────────────────────────────────────
 *
 * Four optional fields, not `MockCoin`. The alpha lane's rows are
 * `LiveAlphaCoin`, a different shape that carries the same identity
 * fields, and a predicate that only reads four of them has no business
 * demanding the whole card type of every caller.
 */
export interface SuppressibleCoin {
  readonly id?: string | null;
  readonly creator?: string | null;
  readonly handle?: string | null;
  readonly graduated?: boolean;
}

export interface BoardSuppression {
  /** True when this coin must not be rendered. */
  (coin: SuppressibleCoin): boolean;
}

export function useBoardSuppression(hiddenMints: ReadonlySet<string>): BoardSuppression {
  const devs = useBlacklistStore((s) => s.devs);
  const handles = useBlacklistStore((s) => s.handles);
  const showHiddenTokens = useBlacklistStore((s) => s.showHiddenTokens);
  const unhideOnMigration = useBlacklistStore((s) => s.unhideOnMigration);
  const hydrate = useBlacklistStore((s) => s.hydrate);

  // After mount, so the server render and the client's first render agree.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return useCallback(
    (coin: SuppressibleCoin) => {
      if (devs.length > 0 && coin.creator != null && devs.includes(coin.creator)) return true;

      if (handles.length > 0) {
        const handle = coin.handle?.trim().replace(/^@+/, '').toLowerCase();
        if (handle != null && handle.length > 0 && handles.includes(handle)) return true;
      }

      if (hiddenMints.size === 0 || showHiddenTokens) return false;
      if (coin.id == null || !hiddenMints.has(coin.id)) return false;
      return !(unhideOnMigration && coin.graduated === true);
    },
    [devs, handles, hiddenMints, showHiddenTokens, unhideOnMigration],
  );
}
