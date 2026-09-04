'use client';

/**
 * `/conditionals` — THE LEDGER LANDING, and nothing else.
 *
 * The design-29 rebuild's landing half: the P0-A ledger, its four-segment
 * toggle, and the notices that explain a read this page could not make.
 * The DETAIL is `/conditionals/<id>` now — its own route, with its own back
 * navigation — because rendering it under the ledger left the landing's
 * serif title and toggle above a surface they do not navigate.
 *
 * So this owns exactly one thing: which view the toggle is on. Rows are
 * links; opening one is the router's job, not a piece of state here.
 *
 * BACK-COMPAT: `/conditionals?id=<id>` is the URL the activated card's
 * footer shipped with, and it may be bookmarked. It redirects to the route
 * that URL now means, rather than 404ing or silently landing on the ledger
 * with nothing opened.
 *
 * Isolation (04-frontend.md invariant 4): its queries live under their own
 * key space and it subscribes to no chart/feed store, so nothing it does
 * can re-render the live trading surfaces beside it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { agentWalletReadiness, cancelConditional } from '@/lib/conditionals';
import { useMe } from '@/lib/api/me';
import { useQueryClient } from '@tanstack/react-query';
import { ConditionalsLedger } from './ConditionalsLedger';
import { errorGuidance, walletGuidance, type Guidance, type GuidanceActionKind } from './guidance';
import { GuidanceNotice } from './GuidanceNotice';
import type { ClockContext } from './ledger-model';
import type { LedgerView } from './views';
import {
  CONDITIONALS_QUERY_KEY,
  useConditionalsList,
  useConditionalsListPush,
} from './useConditionals';

/** The deep-link parameter the activated card's footer used to write. */
const CONDITIONAL_ID_PARAM = 'id';

/**
 * The route a legacy `?id=` means today, or `null` when it means nothing.
 *
 * The card writes `?id=${encodeURIComponent(id ?? '')}`, so a proposal with
 * no conditional id yet produces a BARE `?id=` — which is no selection, not
 * a selection of `""`, and must not redirect to `/conditionals/`.
 */
export function legacyDetailHref(params: URLSearchParams | null): string | null {
  const id = params?.get(CONDITIONAL_ID_PARAM) ?? '';
  return id === '' ? null : `/conditionals/${encodeURIComponent(id)}`;
}

export function ConditionalsPanel({
  onGuidanceAction,
}: {
  /**
   * Wire the actions this app already owns: `open_wallet_setup` opens the
   * wallet setup flow, `refresh_authorization` re-authorizes the agent
   * wallet. `retry` is handled here. Unwired actions render as
   * instruction text, never as dead buttons.
   */
  onGuidanceAction?: ((action: GuidanceActionKind) => void) | undefined;
} = {}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<LedgerView>('active');

  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyHref = legacyDetailHref(searchParams);
  useEffect(() => {
    // `replace`, not `push`: the old URL is not a place to come back to.
    if (legacyHref !== null) router.replace(legacyHref);
  }, [legacyHref, router]);

  const list = useConditionalsList();
  // Push: any event on any of the user's plans refreshes the ledger, so a
  // fill appears here without waiting out the interval.
  useConditionalsListPush();
  const me = useMe();

  const nowMs = Date.now();
  /**
   * The viewer's own zone, resolved once. Every instant on the page is
   * local, and no row repeats the zone — a ledger that tags forty rows
   * with the same zone is spending forty tags on one fact.
   */
  const ctx = useMemo<ClockContext>(
    () => ({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nowMs }),
    [nowMs],
  );

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CONDITIONALS_QUERY_KEY });
  }, [queryClient]);

  /**
   * A row's Cancel: run it, then reread — the server record moved (or
   * proved it had already moved), and state is the server's, never a
   * patched local copy. The row itself renders the result.
   */
  const cancelRow = useCallback(
    async (conditionalId: string) => {
      const result = await cancelConditional(conditionalId);
      refetchAll();
      return result;
    },
    [refetchAll],
  );

  const handleGuidanceAction = useCallback(
    (action: GuidanceActionKind) => {
      if (action === 'retry') {
        refetchAll();
        return;
      }
      onGuidanceAction?.(action);
    },
    [onGuidanceAction, refetchAll],
  );

  const walletNotice: Guidance | null =
    me.data === undefined || me.data.reauth_required
      ? null
      : walletGuidance(agentWalletReadiness(me.data.provisioning.state));

  const listError =
    list.data !== undefined && !list.data.ok ? errorGuidance(list.data.error) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="conditionals-panel">
      {listError === null ? null : (
        <GuidanceNotice guidance={listError} onAction={handleGuidanceAction} />
      )}
      {walletNotice === null ? null : (
        <GuidanceNotice guidance={walletNotice} onAction={handleGuidanceAction} />
      )}

      {list.data !== undefined && list.data.ok ? (
        <ConditionalsLedger
          conditionals={list.data.value.conditionals}
          view={view}
          onViewChange={setView}
          ctx={ctx}
          onCancel={cancelRow}
        />
      ) : list.isPending ? (
        <p className="text-[11px] text-[var(--ink-3)]">Loading conditionals…</p>
      ) : null}
    </div>
  );
}
