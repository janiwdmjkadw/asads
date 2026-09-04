'use client';

import { useEffect } from 'react';
import { lookupOrderStatus } from '@/lib/api/orders';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import {
  useTradeActivityStore,
  type TradeActivityItem,
} from '@/lib/state/trade-activity-store';

// Cold-load pending-toast reconciliation.
//
// Toast progress normally rides the order SSE stream, which only
// connects after hydration + provider mount — several hundred ms to
// seconds on a cold cache. An order submitted in that window can run
// its whole lifecycle (accepted → … → filled) before the stream is
// listening, leaving the toast stuck on "sending…" forever.
//
// Two timers per pending toast, anchored to `createdAt`:
//
//   ~4s  one-shot status reconciliation — IF no SSE event has been
//        attributed to this order (no `orderKey`; covers both "stream
//        not connected" and "stream connected after the events fired"),
//        read `GET /api/v1/trade/fills` for the toast's mint/wallet and
//        look our clientOrderId up in the order-joined fill rows. A hit
//        resolves the toast through the store's existing terminal
//        transitions (confirmed / error).
//   ~8s  degraded escalation — still pending, still no SSE event, and
//        the fetch couldn't resolve it (no fill row exists for failed
//        or genuinely slow orders): flip the copy to "still working —
//        check positions". The toast was always dismissible.
//
// Caps: exactly ONE reconciliation fetch per toast (module-level set,
// survives toast-component remounts from stack reordering); both
// timers are cleaned up on dismiss/unmount/phase-advance via the
// effect teardown.
//
// A11: `submitted`-phase toasts get their own stall timer (~10s after
// the submit advance — confirms normally land <1s) driving the same
// bounded force-reconcile loop, because a terminal SSE frame lost in a
// reconnect gap otherwise strands the toast at "submitted" forever.
// The lookup itself falls back to GET /api/v1/trade/order-status (A10)
// when the fills join misses, so engine-FAILED orders resolve to their
// real error instead of "still working".

const RECONCILE_AFTER_MS = 4_000;
const STALL_AFTER_MS = 8_000;
// After the 8s stall escalation, keep retrying (the fill persister can
// lag the chain by seconds, and both one-shots can race it — that combo
// stranded "sending…" toasts forever). Bounded: one cheap fills lookup
// per RETRY_EVERY_MS per STUCK toast (rare), stopping at RETRY_UNTIL_MS
// or the moment anything (SSE frame, a retry hit) resolves the toast.
const RETRY_EVERY_MS = 3_000;
const RETRY_UNTIL_MS = 32_000;
// A11: SUBMITTED-phase toasts get the same treatment. The tx is on the
// wire and confirms normally land <1s, so a toast still `submitted`
// after this stall window almost certainly lost its terminal SSE frame
// (the browser↔api hop has no replay) — start reconciling then.
// Anchored to `updatedAt` (the moment the toast advanced to submitted).
const SUBMITTED_STALL_AFTER_MS = 10_000;
const SUBMITTED_RETRY_UNTIL_MS = 40_000;

/** Bounded one-shot guard, FIFO-evicted like the store's order maps. */
const RECONCILED_IDS_LIMIT = 500;
const reconciledIds = new Set<string>();

function claimReconcileSlot(clientOrderId: string): boolean {
  if (reconciledIds.has(clientOrderId)) return false;
  reconciledIds.add(clientOrderId);
  while (reconciledIds.size > RECONCILED_IDS_LIMIT) {
    const oldest = reconciledIds.values().next().value;
    if (oldest === undefined) break;
    reconciledIds.delete(oldest);
  }
  return true;
}

/**
 * True when the SSE stream is live AND has already attributed an event
 * to this order — the stream owns the toast's lifecycle, so the
 * fallback must stand down.
 */
function sseOwnsToast(toast: TradeActivityItem, streamConnected: boolean): boolean {
  return streamConnected && toast.orderKey !== undefined;
}

async function reconcile(
  clientOrderId: string,
  opts: { readonly force?: boolean } = {},
): Promise<void> {
  const state = useTradeActivityStore.getState();
  const toast = state.toasts.find((t) => t.id === clientOrderId);
  // A11: `submitted` toasts reconcile too — a terminal SSE frame lost in
  // a reconnect gap otherwise strands them forever (no replay exists on
  // the browser↔api hop).
  if (!toast || (toast.phase !== 'pending' && toast.phase !== 'submitted')) return;
  // `force` (the 8s last-chance path) skips the SSE-ownership stand-down:
  // an attributed `orderKey` only proves the stream saw `accepted` — the
  // terminal event can still be lost in an SSE reconnect gap (there is no
  // replay), which would otherwise leave the toast pending forever.
  if (!opts.force && sseOwnsToast(toast, state.streamConnected)) return;
  if (reconciledIds.has(clientOrderId)) return;

  // Server-seeded session: the token mirror is populated from the first
  // frame. A null token still works — `fetchAuthenticatedApi` sends the
  // session cookie, which the fills route accepts.
  const result = await lookupOrderStatus(
    {
      clientOrderId,
      mint: toast.mint,
      walletAccountId: toast.walletAccountId ?? null,
    },
    { authToken: getClerkSession().token },
  );
  // Claim the one-shot slot only on a DEFINITIVE answer. An inconclusive
  // lookup (fill row not yet persisted, network error) must leave the slot
  // open so the stall timer's second attempt — or a later remount — can
  // still resolve the toast; burning the slot here left "sending…" stuck
  // forever when the first lookup raced the fill persister.
  if (result.kind !== 'found') return;
  if (!claimReconcileSlot(clientOrderId)) return;

  const store = useTradeActivityStore.getState();
  if (
    result.orderState === 'failed' ||
    result.orderState === 'cancelled' ||
    result.orderState === 'expired' ||
    result.orderState === 'reverted'
  ) {
    // A10: the order-status fallback carries the engine's real
    // `last_error_kind` — surface it instead of a generic label.
    store.markError(clientOrderId, result.errorKind ?? result.orderState);
  } else {
    // filled / partial / fill_pending / confirmed — the fill landed
    // on-chain; `confirmed` is the terminal user-facing success phase.
    store.markConfirmed(clientOrderId, result.signature ?? undefined);
  }
}

/**
 * Per-toast driver, called from the toast renderer so timer lifetime is
 * tied to the toast's: dismiss or unmount tears both timers down.
 */
export function usePendingOrderReconciliation(toast: TradeActivityItem): void {
  const { id, phase, createdAt, updatedAt } = toast;
  useEffect(() => {
    if (phase === 'pending') {
      const now = Date.now();
      const reconcileHandle = setTimeout(
        () => { void reconcile(id); },
        Math.max(0, createdAt + RECONCILE_AFTER_MS - now),
      );
      let retryInterval: ReturnType<typeof setInterval> | null = null;
      const stallHandle = setTimeout(() => {
        const state = useTradeActivityStore.getState();
        const current = state.toasts.find((t) => t.id === id);
        if (!current || current.phase !== 'pending') return;
        // Sustained reconcile: fires for ANY still-pending toast, even
        // when an `orderKey` is attributed — SSE events can be lost in a
        // reconnect gap (no replay exists), so "the stream owns it" is not
        // proof the terminal event will ever arrive. The 4s attempt stays
        // gated; from 8s on we force-retry every few seconds (bounded)
        // because a single shot here kept racing the fill persister.
        void reconcile(id, { force: true });
        state.markStalled(id);
        retryInterval = setInterval(() => {
          if (Date.now() - createdAt > RETRY_UNTIL_MS) {
            if (retryInterval !== null) clearInterval(retryInterval);
            retryInterval = null;
            return;
          }
          const latest = useTradeActivityStore.getState().toasts.find((t) => t.id === id);
          if (!latest || latest.phase !== 'pending') {
            if (retryInterval !== null) clearInterval(retryInterval);
            retryInterval = null;
            return;
          }
          void reconcile(id, { force: true });
        }, RETRY_EVERY_MS);
      }, Math.max(0, createdAt + STALL_AFTER_MS - now));
      return () => {
        clearTimeout(reconcileHandle);
        clearTimeout(stallHandle);
        if (retryInterval !== null) clearInterval(retryInterval);
      };
    }
    // A11: `submitted` toasts previously had NO fallback at all — one
    // lost terminal SSE frame stranded them forever. Confirms normally
    // land <1s after submit, so a toast still `submitted` at +10s is
    // stalled: force-reconcile (fills lookup + the order-status
    // fallback) on the same bounded retry cadence as pending toasts.
    // Always forced — an attributed orderKey is exactly the case here
    // (the stream saw `submitted`) and proves nothing about the
    // terminal frame arriving.
    if (phase === 'submitted') {
      const submittedAt = updatedAt;
      let retryInterval: ReturnType<typeof setInterval> | null = null;
      const stallHandle = setTimeout(() => {
        const current = useTradeActivityStore.getState().toasts.find((t) => t.id === id);
        if (!current || current.phase !== 'submitted') return;
        void reconcile(id, { force: true });
        retryInterval = setInterval(() => {
          if (Date.now() - submittedAt > SUBMITTED_RETRY_UNTIL_MS) {
            if (retryInterval !== null) clearInterval(retryInterval);
            retryInterval = null;
            return;
          }
          const latest = useTradeActivityStore.getState().toasts.find((t) => t.id === id);
          if (!latest || latest.phase !== 'submitted') {
            if (retryInterval !== null) clearInterval(retryInterval);
            retryInterval = null;
            return;
          }
          void reconcile(id, { force: true });
        }, RETRY_EVERY_MS);
      }, Math.max(0, submittedAt + SUBMITTED_STALL_AFTER_MS - Date.now()));
      return () => {
        clearTimeout(stallHandle);
        if (retryInterval !== null) clearInterval(retryInterval);
      };
    }
    return;
  }, [id, phase, createdAt, updatedAt]);
}

/** Test-only: clears the one-shot guard between cases. */
export function _resetPendingOrderReconciliationForTests(): void {
  reconciledIds.clear();
}
