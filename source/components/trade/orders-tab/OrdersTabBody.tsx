'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { tokenTickerFromNavigationHint } from '@/components/listen/navigation';
import {
  cancelAdvancedOrder,
  patchAdvancedOrder,
  type AdvancedOrderActionResult,
  type AdvancedOrderChain,
  type AdvancedOrderTokenInfo,
  type AdvancedOrderView,
} from '@/lib/api/advanced-orders';
import { EVM_NATIVE_DECIMALS } from '@/lib/evm/money';
import { REAUTH_HUMAN_MESSAGE } from '../reauthMessage';
import {
  advancedStatusChip,
  decimalsForMint,
  formatCountdown,
  formatTokenBaseUnits,
  isOpenAdvancedStatus,
  knownSymbolForMint,
  parseIsoMs,
  progressFraction,
  shortMint,
  triggerConditionLabel,
  type AdvancedStatusTone,
} from './format';
import { EditOrderModal } from './EditOrderModal';
import type { AdvancedOrdersTabState } from './useAdvancedOrders';

/**
 * Orders tab body: every advanced (DCA/limit) order the user has, with
 * live progress, next-run countdown, status chips and pause/resume/
 * edit/cancel actions. Rows for the current page mint sort first (the
 * hook owns ordering); terminal rows collapse to a compact style.
 */

const ORDERS_GRID_STYLE: CSSProperties = {
  gridTemplateColumns:
    '56px minmax(140px,1.25fr) minmax(160px,1.4fr) 84px minmax(150px,1.2fr) minmax(104px,.9fr) 190px',
  columnGap: 14,
};

const TONE_VAR: Record<AdvancedStatusTone, string> = {
  up: 'var(--up)',
  hold: 'var(--hold)',
  down: 'var(--down)',
  muted: 'var(--ink-3)',
};

interface Props {
  state?: AdvancedOrdersTabState | null;
  /** Current page mint — pair symbols resolve against it. */
  pageMint: string;
  /** Current page token ticker (for pair display when a leg is the page mint). */
  pageTokenSymbol?: string;
  chain?: AdvancedOrderChain;
  nativeSymbol?: string;
  pageTokenDecimals?: number | null;
  quoteDecimals?: number | null;
}

/* No session on this build — the token resolves to nothing and every
   caller takes its own "no token" path. Same bargain as the trade box. */
const ALWAYS_UNAUTHENTICATED = async (): Promise<string | null> => null;

export function OrdersTabBody({
  state,
  pageMint,
  pageTokenSymbol,
  chain = 'solana',
  nativeSymbol,
  pageTokenDecimals = null,
  quoteDecimals = null,
}: Props) {
  const orders = state?.orders ?? [];
  // One 1s clock for every countdown cell, running only while something
  // actually ticks (active recurring next-run, or a gated-since elapsed).
  const hasCountdown = orders.some(
    (o) =>
      (o.kind === 'recurring' && o.status === 'active' && o.next_run_at !== null) ||
      (o.status === 'paused_price' && o.gated_since !== null),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasCountdown) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(id);
  }, [hasCountdown]);

  const emptyMessage = state?.reauth
    ? 'Sign in again to view your orders.'
    : state?.loading
      ? 'loading orders…'
      : 'No advanced orders yet — create one from the Adv. or Limit tab.';

  return (
    <>
      <div className="trow trow--head sticky top-0 z-10" style={ORDERS_GRID_STYLE}>
        <span>Type</span>
        <span>Pair</span>
        <span>Progress</span>
        <span>Next run</span>
        <span>Status</span>
        <span>Received</span>
        <span>Actions</span>
      </div>
      {state && state.error !== null && orders.length === 0 ? (
        <ErrorRetryRow error={state.error} onRetry={state.refetch} />
      ) : null}
      {state
        ? orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              nowMs={nowMs}
              pageMint={pageMint}
              pageTokenSymbol={pageTokenSymbol}
              chain={chain}
              nativeSymbol={nativeSymbol}
              pageTokenDecimals={pageTokenDecimals}
              quoteDecimals={quoteDecimals}
              applyServerOrder={state.applyServerOrder}
              refetch={state.refetch}
            />
          ))
        : null}
      {orders.length === 0 && (state?.error == null || state.reauth) ? (
        <EmptyOrdersRow message={emptyMessage} />
      ) : null}
    </>
  );
}

function EmptyOrdersRow({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-[120px] flex-1 items-center justify-center px-4 text-center text-[11px]"
      style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)', lineHeight: '16px' }}
    >
      {message}
    </div>
  );
}

function ErrorRetryRow({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      className="flex min-h-[80px] flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px]"
      style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
    >
      <span>orders unavailable: {error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-[24px] items-center rounded-[var(--r-xs)] px-3 text-[10px]"
        style={{
          color: 'var(--ink-1)',
          background: 'var(--input-bg)',
          border: '1px solid var(--hairline)',
          fontFamily: 'var(--mono)',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );
}

function symbolFor(
  mint: string,
  tokenInfo: AdvancedOrderTokenInfo | null,
  pageMint: string,
  pageTokenSymbol: string | undefined,
  chain: AdvancedOrderChain,
  nativeSymbol: string | undefined,
): string {
  // Catalog enrichment off the list endpoint wins; then the SOL/USDC
  // sentinels, the page token's ticker, the navigation-hint cache, and
  // finally a truncated mint.
  const enriched = tokenInfo?.symbol?.trim();
  if (enriched && enriched.length > 0) return enriched;
  if (chain !== 'solana' && mint === 'native') return nativeSymbol ?? 'Native';
  const known = knownSymbolForMint(mint);
  if (known !== null) return known;
  if (mint === pageMint && pageTokenSymbol && pageTokenSymbol.trim().length > 0) {
    return pageTokenSymbol;
  }
  return tokenTickerFromNavigationHint(mint) ?? shortMint(mint);
}

function decimalsForOrderAsset(
  order: AdvancedOrderView,
  mint: string,
  tokenInfo: AdvancedOrderTokenInfo | null,
  pageMint: string,
  pageTokenDecimals: number | null,
  quoteDecimals: number | null,
): number | null {
  if (tokenInfo !== null) return tokenInfo.decimals;
  if (order.chain === 'solana') return decimalsForMint(mint, order.chain);
  if (mint === pageMint) return pageTokenDecimals;
  // The named constant, not an inline 18: `lib/evm/money.ts` is where the
  // claim "BNB and ETH are both 18 and no wave-1 chain differs" is written
  // down, and a second copy here is a scale that stops tracking it the day a
  // chain with a different native scale is served.
  if (mint === order.quote_asset) {
    return mint === 'native' ? EVM_NATIVE_DECIMALS : quoteDecimals;
  }
  return null;
}

function Chip({ label, tone, title }: { label: string; tone: string; title?: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
      style={{
        color: tone,
        background: `color-mix(in srgb, ${tone} 12%, var(--surface-1))`,
        border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)`,
      }}
      title={title ?? label}
    >
      {label}
    </span>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <span
      aria-hidden
      className="block w-full max-w-[140px] overflow-hidden rounded-full"
      style={{ height: 3, background: 'color-mix(in srgb, var(--ink-3) 25%, transparent)' }}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.round(fraction * 100)}%`,
          background: 'var(--accent-primary)',
        }}
      />
    </span>
  );
}

type RowAction = 'pause' | 'resume' | 'cancel';

function OrderRow({
  order,
  nowMs,
  pageMint,
  pageTokenSymbol,
  chain,
  nativeSymbol,
  pageTokenDecimals,
  quoteDecimals,
  applyServerOrder,
  refetch,
}: {
  order: AdvancedOrderView;
  nowMs: number;
  pageMint: string;
  pageTokenSymbol: string | undefined;
  chain: AdvancedOrderChain;
  nativeSymbol: string | undefined;
  pageTokenDecimals: number | null;
  quoteDecimals: number | null;
  applyServerOrder: (order: AdvancedOrderView) => void;
  refetch: () => void;
}) {
  const getToken = ALWAYS_UNAUTHENTICATED;
  const [busy, setBusy] = useState<RowAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const open = isOpenAdvancedStatus(order.status);
  const inSymbol = symbolFor(
    order.input_mint,
    order.input_token,
    pageMint,
    pageTokenSymbol,
    chain,
    nativeSymbol,
  );
  const outSymbol = symbolFor(
    order.output_mint,
    order.output_token,
    pageMint,
    pageTokenSymbol,
    chain,
    nativeSymbol,
  );
  const chip = advancedStatusChip(order.status);
  const kindLabel = order.kind === 'recurring' ? 'DCA' : 'LIMIT';
  const kindTone = order.kind === 'recurring' ? 'var(--accent-primary)' : 'var(--hold)';

  const nextRunMs = parseIsoMs(order.next_run_at);
  const showCountdown =
    order.kind === 'recurring' && order.status === 'active' && nextRunMs !== null;

  const receivedUnits = order.output_received_base_units;
  const outputDecimals = decimalsForOrderAsset(
    order,
    order.output_mint,
    order.output_token,
    pageMint,
    pageTokenDecimals,
    quoteDecimals,
  );
  const received =
    outputDecimals !== null && /^\d+$/.test(receivedUnits) && receivedUnits !== '0'
      ? `${formatTokenBaseUnits(receivedUnits, outputDecimals)} ${outSymbol}`
      : '—';
  const inputDecimals = decimalsForOrderAsset(
    order,
    order.input_mint,
    order.input_token,
    pageMint,
    pageTokenDecimals,
    quoteDecimals,
  );
  const spent =
    inputDecimals === null
      ? 'amount unavailable'
      : `${formatTokenBaseUnits(order.input_spent_base_units, inputDecimals)}/${formatTokenBaseUnits(order.total_input_base_units, inputDecimals)} ${inSymbol}`;

  const runAction = async (
    action: RowAction,
    call: (authToken: string | null) => Promise<AdvancedOrderActionResult>,
  ): Promise<void> => {
    if (busy !== null) return;
    setBusy(action);
    setActionError(null);
    try {
      const authToken = await resolveOrderAuthToken(getToken);
      const result = await call(authToken);
      if (result.kind === 'ok') {
        // Optimistic: the PATCH/cancel response IS the updated row —
        // paint it now, then refetch to converge with the worker.
        applyServerOrder(result.order);
        refetch();
      } else if (result.kind === 'reauth') {
        setActionError(REAUTH_HUMAN_MESSAGE);
      } else if (result.kind === 'network_error') {
        setActionError(result.reason);
      } else {
        setActionError(result.message || result.errorCode);
      }
    } finally {
      setBusy(null);
      setConfirmingCancel(false);
    }
  };

  // Terminal rows: compact single-line summary, no actions, sorted last
  // (the hook owns ordering).
  if (!open) {
    return (
      <div
        className="trow"
        style={{ ...ORDERS_GRID_STYLE, height: 34, opacity: 0.55 }}
        title={order.status_detail ?? undefined}
      >
        <Chip label={kindLabel} tone={kindTone} />
        <span className="truncate" style={{ color: 'var(--ink-2)' }}>
          {inSymbol} → {outSymbol}
        </span>
        <span className="truncate" style={{ color: 'var(--ink-3)' }}>
          {order.kind === 'recurring'
            ? `${order.suborders_executed}/${order.suborders_total} rounds`
            : `${triggerConditionLabel(order)}${order.status === 'completed' ? ' · Filled' : ''}`}
        </span>
        <span style={{ color: 'var(--ink-4)' }}>—</span>
        <span>
          <Chip label={chip.label} tone={TONE_VAR[chip.tone]} title={order.status_detail ?? chip.label} />
        </span>
        <span className="truncate" style={{ color: 'var(--ink-2)' }}>
          {received}
        </span>
        <span style={{ color: 'var(--ink-4)' }}>—</span>
      </div>
    );
  }

  return (
    <>
      <div
        className="trow"
        style={{
          ...ORDERS_GRID_STYLE,
          height: 'auto',
          minHeight: 52,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <span>
          <Chip label={kindLabel} tone={kindTone} />
        </span>
        <span
          className="inline-flex min-w-0 flex-col leading-tight"
          title={`${order.input_mint} → ${order.output_mint}`}
        >
          <span className="truncate" style={{ color: 'var(--ink-0)', fontWeight: 600 }}>
            {inSymbol} → {outSymbol}
          </span>
          <span className="truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>
            {shortMint(order.output_mint)}
          </span>
        </span>
        {order.kind === 'recurring' ? (
          <span className="inline-flex min-w-0 flex-col gap-1 leading-tight">
            <span style={{ color: 'var(--ink-1)' }}>
              {order.suborders_executed}/{order.suborders_total} rounds
            </span>
            <span className="truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>
              {spent}
            </span>
            <ProgressBar
              fraction={progressFraction(order.suborders_executed, order.suborders_total)}
            />
          </span>
        ) : (
          <span className="inline-flex min-w-0 flex-col leading-tight">
            <span className="truncate" style={{ color: 'var(--ink-1)' }}>
              {triggerConditionLabel(order)}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
              Waiting
            </span>
          </span>
        )}
        <span
          className="tabular-nums"
          style={{ color: showCountdown ? 'var(--ink-1)' : 'var(--ink-4)', fontFamily: 'var(--mono)' }}
        >
          {showCountdown ? formatCountdown((nextRunMs ?? 0) - nowMs) : '—'}
        </span>
        <span className="inline-flex min-w-0 flex-col gap-0.5 leading-tight">
          <span>
            <Chip
              label={chip.label}
              tone={TONE_VAR[chip.tone]}
              title={order.status_detail ?? chip.label}
            />
          </span>
          {order.status === 'paused_auth' ? (
            <span className="text-[10px]" style={{ color: 'var(--down)' }}>
              Re-authorize trading to resume
            </span>
          ) : null}
          {order.status === 'paused_price' && parseIsoMs(order.gated_since) !== null ? (
            <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
              out of range for {formatCountdown(nowMs - (parseIsoMs(order.gated_since) ?? nowMs))}
              {' · resumes automatically'}
            </span>
          ) : null}
        </span>
        <span className="truncate" style={{ color: 'var(--ink-1)' }}>
          {received}
        </span>
        <span className="relative inline-flex min-w-0 flex-col gap-1">
          <span className="inline-flex items-center gap-1.5">
            {order.status === 'active' ? (
              <RowButton
                label={busy === 'pause' ? '…' : 'Pause'}
                disabled={busy !== null}
                onClick={() =>
                  void runAction('pause', (authToken) =>
                    patchAdvancedOrder(order.id, { action: 'pause' }, { authToken, expectedChain: chain }),
                  )
                }
              />
            ) : (
              <RowButton
                label={busy === 'resume' ? '…' : 'Resume'}
                disabled={busy !== null}
                onClick={() =>
                  void runAction('resume', (authToken) =>
                    patchAdvancedOrder(order.id, { action: 'resume' }, { authToken, expectedChain: chain }),
                  )
                }
              />
            )}
            <RowButton
              label="Edit"
              disabled={busy !== null}
              onClick={() => setEditOpen(true)}
            />
            <RowButton
              label={busy === 'cancel' ? '…' : 'Cancel'}
              tone="var(--down)"
              disabled={busy !== null}
              onClick={() => setConfirmingCancel((v) => !v)}
            />
          </span>
          {confirmingCancel ? (
            <span
              className="absolute right-0 top-[26px] z-30 inline-flex items-center gap-2 rounded-[var(--r-sm)] px-2.5 py-1.5"
              style={{
                background: 'var(--section-bg)',
                border: '1px solid var(--hairline-2)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 10, color: 'var(--ink-2)' }}>Cancel this order?</span>
              <RowButton
                label="Yes, cancel"
                tone="var(--down)"
                disabled={busy !== null}
                onClick={() =>
                  void runAction('cancel', (authToken) =>
                    cancelAdvancedOrder(order.id, { authToken, expectedChain: chain }),
                  )
                }
              />
              <RowButton
                label="Keep"
                disabled={busy !== null}
                onClick={() => setConfirmingCancel(false)}
              />
            </span>
          ) : null}
          {actionError !== null ? (
            <span className="truncate text-[10px]" style={{ color: 'var(--down)' }} title={actionError}>
              {actionError}
            </span>
          ) : null}
        </span>
      </div>
      {editOpen ? (
        <EditOrderModal
          order={order}
          expectedChain={chain}
          onClose={() => setEditOpen(false)}
          onSaved={(saved) => {
            applyServerOrder(saved);
            refetch();
          }}
        />
      ) : null}
    </>
  );
}

function RowButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-[22px] shrink-0 items-center rounded-[var(--r-xs)] px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        color: tone ?? 'var(--ink-1)',
        background: 'var(--input-bg)',
        border: `1px solid ${tone ? `color-mix(in srgb, ${tone} 45%, var(--hairline))` : 'var(--hairline)'}`,
        fontFamily: 'var(--mono)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}
