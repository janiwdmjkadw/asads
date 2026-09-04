'use client';

import { useEffect, useRef } from 'react';
import {
  useTradeActivityStore,
  type TradeActivityItem,
  type TradeActivityPhase,
} from '@/lib/state/trade-activity-store';
import { playTradeSuccessSound } from '@/components/trade/tradeSound';
import { humanTradeErrorCopy } from '@/components/trade/tradeErrorCopy';
import { usePendingOrderReconciliation } from './usePendingOrderReconciliation';

// Top-of-screen toast stack for orders initiated on this tab.
//
// Lifecycle visualised here:
//   pending → submitted → confirmed                     (success)
//   pending → submitted → error                         (revert/drop)
//   pending → error                                     (api/ reject)
//
// `confirmed` is the terminal success phase — it means the tx landed on
// a slot on-chain. The downstream fill/balance sync is background DB
// bookkeeping the user never needs to see, so we stop here.
//
// Auto-dismiss: terminal phases (`confirmed` / `error`) clear after a
// short hold. `pending` / `submitted` linger until they reach a
// terminal phase or the user clicks dismiss.

const TERMINAL_HOLD_MS = 4_500;
const VISIBLE_TOASTS = 6;

export function TradeActivityToasts() {
  const toasts = useTradeActivityStore((s) => s.toasts);
  const dismiss = useTradeActivityStore((s) => s.dismiss);

  // Same success chime the trade page's TradeToasts plays: once per toast,
  // the moment it reaches `confirmed`. Quickbuy surfaces unlock the audio
  // at press time (unlockTradeSuccessSound in the submit handlers), so the
  // async confirmation here is allowed to play. Dedupe by toast id — SSE
  // replays and re-renders must not re-ring for the same order.
  const playedSuccessToastIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.phase !== 'confirmed') continue;
      if (playedSuccessToastIds.current.has(toast.id)) continue;
      playedSuccessToastIds.current.add(toast.id);
      playTradeSuccessSound();
    }
    // Session-long component: bound the dedupe set (ids are per-click).
    if (playedSuccessToastIds.current.size > 1_000) {
      playedSuccessToastIds.current = new Set([...playedSuccessToastIds.current].slice(-500));
    }
  }, [toasts]);

  if (!toasts.length) return null;
  // Only the last VISIBLE_TOASTS render visually, but the cold-load
  // reconciliation timers must run for EVERY pending order — a pending
  // toast pushed out of the visible window would otherwise never get its
  // one-shot fills lookup and could sit "sending…" forever.
  const hiddenPending = toasts
    .slice(0, -VISIBLE_TOASTS)
    .filter((toast) => toast.phase === 'pending');
  return (
    <div
      aria-live="polite"
      className="fixed pointer-events-none flex flex-col gap-2"
      style={{
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        alignItems: 'center',
      }}
    >
      {hiddenPending.map((toast) => (
        <HiddenPendingReconciler key={toast.id} toast={toast} />
      ))}
      {toasts.slice(-VISIBLE_TOASTS).map((toast) => (
        <TradeActivityToast key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
}

/** Invisible driver: keeps the pending-order reconciliation timers alive
 *  for toasts scrolled out of the visible stack. Renders nothing. */
function HiddenPendingReconciler({ toast }: { toast: TradeActivityItem }) {
  usePendingOrderReconciliation(toast);
  return null;
}

function TradeActivityToast({
  toast,
  onDismiss,
}: {
  toast: TradeActivityItem;
  onDismiss: (id: string) => void;
}) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  // Cold-load fallback: while the toast sits in `pending` without the
  // order SSE having attributed any event to it, fire a one-shot fills
  // reconciliation (~4s) and escalate the copy (~8s). Timers tear down
  // with the toast (dismiss / unmount / phase advance).
  usePendingOrderReconciliation(toast);

  const isTerminal = toast.phase === 'confirmed' || toast.phase === 'error';
  useEffect(() => {
    if (!isTerminal) return;
    const handle = setTimeout(() => onDismissRef.current(toast.id), TERMINAL_HOLD_MS);
    return () => clearTimeout(handle);
  }, [toast.id, toast.phase, isTerminal]);

  const tone = toast.evmFinality === 'reorged'
    ? 'var(--down)'
    : toneFor(toast.phase, toast.side);
  return (
    <div
      className="pointer-events-auto"
      style={{
        minWidth: 280,
        maxWidth: 380,
        padding: '8px 12px',
        borderRadius: 10,
        // Near-opaque solid, NO backdrop blur: these sit over the live
        // chart canvas, and a blurred backdrop forces the compositor to
        // re-blur every toast every frame the chart animates — with a
        // spam-click stack that visibly dragged the whole page. At 97%
        // opacity the blur was invisible anyway; solid paint is free.
        background: 'rgba(8,10,14,0.97)',
        border: '1px solid var(--hairline-2)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Phase indicator dot — pulses while in-flight, solid when terminal */}
        <span
          aria-hidden
          className={isTerminal ? '' : 'trade-activity-pulse'}
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: tone,
            boxShadow: `0 0 10px ${tone}`,
            flexShrink: 0,
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              color: 'var(--ink-0)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {titleFor(toast)}
          </div>
          <div
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {subtitleFor(toast)}
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onDismiss(toast.id)}
          style={{
            width: 20,
            height: 20,
            borderRadius: 999,
            border: '1px solid var(--hairline)',
            color: 'var(--ink-3)',
            background: 'rgba(255,255,255,0.03)',
            fontSize: 11,
            lineHeight: '18px',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          x
        </button>
      </div>
    </div>
  );
}

function titleFor(t: TradeActivityItem): string {
  // Automated (advanced-order) suborder fills: confirmed-only lifecycle,
  // amounts pre-rendered by the SSE provider ("0.98 SOL → 1.2M SYM").
  if (t.automated) {
    const verb = t.side === 'buy' ? 'buy' : 'sell';
    const base = `${t.automated.kindLabel} ${verb} confirmed`;
    return t.automated.amountsLabel ? `${base} — ${t.automated.amountsLabel}` : base;
  }
  const amt = t.solAmount === null ? '?' : formatSol(t.solAmount);
  const verb = t.side === 'buy' ? 'Buy' : 'Sell';
  switch (t.phase) {
    case 'pending':   return `${verb} ${t.ticker} • ${amt} ◎`;
    case 'submitted': return t.evmFinality === undefined
      ? `${verb} ${t.ticker} • submitted`
      : t.evmFinality === 'reorged'
        ? `${verb} ${t.ticker} • reorg detected`
        : `${verb} ${t.ticker} • included`;
    case 'confirmed': return `${verb} ${t.ticker} • confirmed`;
    case 'error':     return `${verb} ${t.ticker} • failed`;
  }
}

function subtitleFor(t: TradeActivityItem): string {
  if (t.phase === 'error') return humanTradeErrorCopy(t.error ?? 'order failed');
  if (t.signature) return shortSig(t.signature);
  if (t.phase === 'pending') return t.stalled ? 'still working — check positions' : 'sending…';
  if (t.phase === 'submitted') {
    if (t.evmFinality === 'reorged') return 'inclusion retracted — reconciling';
    if (t.evmFinality === 'finalizing') return 'included on-chain — finalizing';
    return 'on-chain';
  }
  if (t.phase === 'confirmed') return 'confirmed';
  return '';
}

function toneFor(phase: TradeActivityPhase, side: 'buy' | 'sell'): string {
  switch (phase) {
    case 'error':    return 'var(--down)';
    case 'confirmed':return 'var(--up)';
    case 'pending':
    case 'submitted':return side === 'buy' ? 'var(--accent-primary)' : 'var(--hold)';
  }
}

function formatSol(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1) return value % 1 === 0 ? value.toFixed(0) : value.toFixed(2);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function shortSig(sig: string): string {
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}
