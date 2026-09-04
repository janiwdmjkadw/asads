'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useListenRootPortal } from '../advanced/useListenRootPortal';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import {
  patchAdvancedOrder,
  type AdvancedOrderChain,
  type AdvancedOrderView,
  type AdvancedPriceBasis,
  type PatchAdvancedOrderRequest,
} from '@/lib/api/advanced-orders';
import { REAUTH_HUMAN_MESSAGE } from '../reauthMessage';
import { formatBps, formatLamportsAsSol } from '../SettingsReadout';
import {
  compareUsdDecimals,
  DURATION_UNITS,
  durationToSeconds,
  MAX_SUBORDERS,
  MIN_SUBORDERS,
  parseUsdDecimal,
  slippagePctToBps,
  toBaseUnits,
  type DurationUnit,
} from '../advanced/math';
import { BasisToggle, MiniInput, MiniSelect } from '../advanced/bits';
import { bestDurationFit } from './format';

/**
 * Orders-tab edit modal: PATCH { action: 'edit', ...changed fields }.
 * Editable per the PATCH contract — suborders/interval (recurring),
 * slippage, priority/bribe lamports, price range (recurring), trigger
 * value (limit). The api edits the INTERVAL directly (`interval_seconds`);
 * the "Every X unit" input converts to whole seconds client-side. Only
 * fields the user actually changed ride the wire; the server validates
 * the remaining-rounds constraint. Visual shell mirrors ConfirmOrderModal.
 */

type EditChanges = Extract<PatchAdvancedOrderRequest, { action: 'edit' }>;

const DURATION_UNIT_OPTIONS: ReadonlyArray<{ value: DurationUnit; label: string }> =
  DURATION_UNITS.map((u) => ({ value: u, label: u }));

const BASIS_OPTIONS: ReadonlyArray<{ value: AdvancedPriceBasis; label: string }> = [
  { value: 'price_usd', label: 'Price USD' },
  { value: 'market_cap_usd', label: 'MCap USD' },
];

/* No session on this build — the token resolves to nothing and every
   caller takes its own "no token" path. Same bargain as the trade box. */
const ALWAYS_UNAUTHENTICATED = async (): Promise<string | null> => null;

export function EditOrderModal({
  order,
  expectedChain,
  onClose,
  onSaved,
}: {
  order: AdvancedOrderView;
  expectedChain: AdvancedOrderChain;
  onClose: () => void;
  onSaved: (order: AdvancedOrderView) => void;
}) {
  const getToken = ALWAYS_UNAUTHENTICATED;
  const { anchorRef, portalTarget } = useListenRootPortal();
  const isRecurring = order.kind === 'recurring';
  const isEvm = expectedChain !== 'solana';
  // The api edits the INTERVAL (seconds between suborders) directly.
  const intervalFit = bestDurationFit(order.interval_seconds);

  const [subordersStr, setSubordersStr] = useState(String(order.suborders_total));
  const [intervalValue, setIntervalValue] = useState(intervalFit.value);
  const [intervalUnit, setIntervalUnit] = useState<DurationUnit>(intervalFit.unit);
  const [slippageStr, setSlippageStr] = useState(formatBps(order.slippage_bps));
  // Fee overrides prefill only when the api serves them; empty = unchanged.
  const [prioritySolStr, setPrioritySolStr] = useState(
    order.priority_lamports !== null ? formatLamportsAsSol(Number(order.priority_lamports)) : '',
  );
  const [bribeSolStr, setBribeSolStr] = useState(
    order.bribe_lamports !== null ? formatLamportsAsSol(Number(order.bribe_lamports)) : '',
  );
  const [basis, setBasis] = useState<AdvancedPriceBasis>(order.price_basis ?? 'price_usd');
  const [floorStr, setFloorStr] = useState(order.price_floor_usd ?? '');
  const [ceilStr, setCeilStr] = useState(order.price_ceiling_usd ?? '');
  const [triggerStr, setTriggerStr] = useState(order.trigger_value_usd ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildChanges = (): EditChanges | { error: string } => {
    const changes: EditChanges = { action: 'edit' };

    const slippageBps = slippagePctToBps(slippageStr);
    if (slippageBps === null) return { error: 'Slippage must be between 0 and 100%.' };
    if (slippageBps !== order.slippage_bps) changes.slippage_bps = slippageBps;

    if (!isEvm && prioritySolStr !== '') {
      const lamports = toBaseUnits(prioritySolStr, 9);
      if (lamports === null) return { error: 'Priority fee must be a plain SOL amount.' };
      const next = lamports.toString(10);
      if (next !== (order.priority_lamports ?? null)) changes.priority_lamports = next;
    }
    if (!isEvm && bribeSolStr !== '') {
      const lamports = toBaseUnits(bribeSolStr, 9);
      if (lamports === null) return { error: 'MEV tip must be a plain SOL amount.' };
      const next = lamports.toString(10);
      if (next !== (order.bribe_lamports ?? null)) changes.bribe_lamports = next;
    }

    if (isRecurring) {
      if (!/^\d+$/.test(subordersStr)) return { error: 'Suborders must be a whole number.' };
      const suborders = Number(subordersStr);
      if (suborders < MIN_SUBORDERS || suborders > MAX_SUBORDERS) {
        return { error: `Suborders must be between ${MIN_SUBORDERS} and ${MAX_SUBORDERS}.` };
      }
      if (suborders !== order.suborders_total) changes.suborders_total = suborders;

      const intervalSeconds = durationToSeconds(intervalValue, intervalUnit);
      if (intervalSeconds === null) return { error: 'Enter a positive interval.' };
      if (intervalSeconds !== order.interval_seconds) changes.interval_seconds = intervalSeconds;

      const floorUsd = floorStr === '' ? null : parseUsdDecimal(floorStr);
      const ceilUsd = ceilStr === '' ? null : parseUsdDecimal(ceilStr);
      if (floorStr !== '' && floorUsd === null) {
        return { error: 'Price range values must be positive decimals.' };
      }
      if (ceilStr !== '' && ceilUsd === null) {
        return { error: 'Price range values must be positive decimals.' };
      }
      if (floorUsd !== null && ceilUsd !== null && compareUsdDecimals(floorUsd, ceilUsd) >= 0) {
        return { error: 'Price range min must be below max.' };
      }
      if (floorUsd !== (order.price_floor_usd ?? null)) changes.price_floor_usd = floorUsd;
      if (ceilUsd !== (order.price_ceiling_usd ?? null)) changes.price_ceiling_usd = ceilUsd;
      const hasRange = floorUsd !== null || ceilUsd !== null;
      const nextBasis: AdvancedPriceBasis | null = hasRange ? basis : null;
      if (nextBasis !== (order.price_basis ?? null)) changes.price_basis = nextBasis;
    } else {
      const triggerUsd = triggerStr === '' ? null : parseUsdDecimal(triggerStr);
      if (triggerUsd === null) return { error: 'Enter a positive trigger value in USD.' };
      if (triggerUsd !== (order.trigger_value_usd ?? null)) changes.trigger_value_usd = triggerUsd;
    }

    return changes;
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    const changes = buildChanges();
    if ('error' in changes) {
      setError(changes.error);
      return;
    }
    if (Object.keys(changes).length === 1) {
      setError('No changes to save.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const authToken = await resolveOrderAuthToken(getToken);
      const result = await patchAdvancedOrder(order.id, changes, { authToken, expectedChain });
      if (result.kind === 'ok') {
        // A throwing cache-update must never hold the modal open with
        // stale error text — the save itself already succeeded.
        try {
          onSaved(result.order);
        } catch {
          // refetch on the next poll converges the table anyway
        }
        onClose();
      } else if (result.kind === 'reauth') {
        setError(REAUTH_HUMAN_MESSAGE);
      } else if (result.kind === 'network_error') {
        setError(`Error: ${result.reason}`);
      } else {
        setError(`Rejected: ${result.message || result.errorCode}`);
      }
    } catch (err) {
      // Anything escaping (auth-token mint, unexpected client throw)
      // must surface here — an escaped rejection previously left the
      // modal open showing the PREVIOUS attempt's error.
      setError(`Error: ${(err as Error).message ?? 'unexpected failure'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Portaled to the nearest `.listen-root`: rendered in place (inside
  // the TradesTable panel) the fixed overlay is trapped in the panel's
  // forced stacking context — see useListenRootPortal.
  const overlay = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${isRecurring ? 'DCA' : 'limit'} order`}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="flex w-full max-w-[360px] flex-col gap-3"
        style={{
          padding: 16,
          borderRadius: 'var(--r-2xl)',
          background: 'var(--section-bg)',
          border: '1px solid var(--section-border)',
          boxShadow: '0 24px 64px -16px rgba(0,0,0,0.9)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-0)' }}>
          {isRecurring ? 'Edit DCA order' : 'Edit limit order'}
        </div>

        {isRecurring ? (
          <div className="flex items-end gap-2">
            <MiniInput
              label="Total Suborders"
              value={subordersStr}
              onChange={setSubordersStr}
            />
            <MiniInput label="Every" value={intervalValue} onChange={setIntervalValue} />
            <div style={{ flex: '0 0 92px' }}>
              <MiniSelect
                ariaLabel="Interval unit"
                value={intervalUnit}
                options={DURATION_UNIT_OPTIONS}
                onChange={setIntervalUnit}
              />
            </div>
          </div>
        ) : (
          <MiniInput label="Trigger value $" value={triggerStr} onChange={setTriggerStr} />
        )}

        <div className="flex items-end gap-2">
          <MiniInput
            label="Slippage / order"
            value={slippageStr}
            onChange={setSlippageStr}
            suffix={
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>
                %
              </span>
            }
          />
          {!isEvm ? (
            <>
              <MiniInput label="Priority (SOL)" value={prioritySolStr} onChange={setPrioritySolStr} />
              <MiniInput label="MEV tip (SOL)" value={bribeSolStr} onChange={setBribeSolStr} />
            </>
          ) : null}
        </div>

        {isRecurring ? (
          <>
            <div className="flex items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Range basis</span>
                <BasisToggle value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <MiniInput
                label={basis === 'price_usd' ? 'Min price $' : 'Min mcap $'}
                value={floorStr}
                onChange={setFloorStr}
              />
              <MiniInput
                label={basis === 'price_usd' ? 'Max price $' : 'Max mcap $'}
                value={ceilStr}
                onChange={setCeilStr}
              />
            </div>
          </>
        ) : null}

        {error ? <div style={{ fontSize: 11, color: 'var(--down)' }}>{error}</div> : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="seg__btn flex-1"
            style={{ height: 34, fontSize: 12, justifyContent: 'center' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="buy-cta flex-1"
            style={{ height: 34, fontSize: 13, opacity: submitting ? 0.6 : 1 }}
          >
            <span>{submitting ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <span ref={anchorRef} hidden />
      {portalTarget ? createPortal(overlay, portalTarget) : null}
    </>
  );
}
