'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Caption } from '@/components/listen/primitives';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import { useTradeStore } from '@/lib/state/trade-store';
import { formatUsdAmount } from '@/lib/format';
import {
  createAdvancedOrder,
  type AdvancedPriceBasis,
  type CreateAdvancedOrderRequest,
} from '@/lib/api/advanced-orders';
import type { MockToken } from '../mockTrade';
import { REAUTH_HUMAN_MESSAGE } from '../reauthMessage';
import { formatBps, formatLamportsAsSol } from '../SettingsReadout';
import {
  DEFAULT_SUBORDERS,
  DURATION_UNITS,
  durationToSeconds,
  formatBaseUnits,
  formatDurationShort,
  intervalSeconds,
  parseUsdDecimal,
  perSuborderBaseUnits,
  PLATFORM_FEE_BPS,
  slippagePctToBps,
  SOL_MINT,
  solMaxSpendableLamports,
  toBaseUnits,
  validateRecurringForm,
  type DurationUnit,
} from './math';
import {
  findOption,
  useSpotHoldings,
  withPageMintOption,
  type TokenOption,
} from './useSpotHoldings';
import { overlayOptionBalances, useLiveBalanceOverlay } from './useLiveBalanceOverlay';
import { useTradeCapabilities } from '../useTradeCapabilities';
import { optionToSelected, shortMintLabel, TokenPicker, type SelectedToken } from './TokenPicker';
import {
  BasisToggle,
  CardAmountInput,
  CardFootRow,
  CardHeader,
  FieldCard,
  FlipButton,
  Hl,
  MiniInput,
  MiniSelect,
  SentencePreview,
  StatusLine,
  SummaryRow,
  tradingReadyBlockedMessage,
  type StatusMessage,
} from './bits';
import { ConfirmOrderModal, type ConfirmRow } from './ConfirmOrderModal';

/**
 * Advanced (recurring/DCA) tab body. Allocate → To Buy pair with
 * any-to-any mints, duration + suborder sizing, per-suborder slippage,
 * optional price-range gating, live summary and a confirmation modal
 * that POSTs /api/v1/trade/advanced-orders (kind 'recurring').
 *
 * Sizing semantics: total allocation over duration with N suborders →
 * per-order = total/N, interval = duration/N. 10 SOL over 100s with 10
 * suborders = 1 SOL every 10 seconds.
 */

interface Props {
  token: MockToken;
  mint: string | null;
  /** Lamports per page-mint base unit (live). */
  priceLamportsPerBaseUnit: number;
}

const DURATION_UNIT_LABELS: ReadonlyArray<{ value: DurationUnit; label: string }> =
  DURATION_UNITS.map((u) => ({ value: u, label: u }));

const BASIS_OPTIONS: ReadonlyArray<{ value: AdvancedPriceBasis; label: string }> = [
  { value: 'price_usd', label: 'Price USD' },
  { value: 'market_cap_usd', label: 'MCap USD' },
];

export function AdvancedTabBody({ token, mint, priceLamportsPerBaseUnit }: Props) {
  const { getToken } = useAuth();
  const { decision: tradingReadyDecision, requireTradingReady } = useRequireTradingReady({
    optimistic: true,
  });
  const selectedWalletAccountId = useSelectedWalletStore((s) => s.selectedWalletAccountId);
  // Multi-wallet selections silently collapse to the primary wallet on
  // this surface (the order is scoped to one wallet_account_id) — the
  // count drives an explicit disclosure line instead.
  const multiWalletCount = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds.length);
  const capability = useTradeCapabilities();
  const schedulerDown =
    capability !== null
    && (capability.apiEnabled === false
      || capability.schedulerEnabled === false
      || capability.chains.solana.recurring.enabled === false);
  // Fee context: the ACTIVE preset's buy-side values, captured on the
  // order at creation time (same source the Market tab ships per order).
  const presetSlippageBps = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.slippage_bps,
  );
  const priorityLamports = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.priority_lamports,
  );
  const bribeLamports = useTradeStore(
    (state) => state.tradePresets.presets[state.tradePresets.active_index].buy.bribe_lamports,
  );

  const holdings = useSpotHoldings(selectedWalletAccountId);
  const solUsd = token.solUsd ?? holdings.solPriceUsd;
  // Live USD price of one whole page-mint token: lamports/baseUnit ×
  // 1e6 baseUnits/token ÷ 1e9 lamports/SOL × SOL/USD.
  const pagePriceUsd =
    priceLamportsPerBaseUnit > 0 && solUsd != null && solUsd > 0
      ? priceLamportsPerBaseUnit * 1e-3 * solUsd
      : null;

  // Selections. Allocate defaults to SOL; To Buy defaults to the page
  // mint. Allocate is picker-only (decimals always known); To Buy also
  // accepts a pasted CA (decimals unknown — output side never needs them).
  const [allocate, setAllocate] = useState<SelectedToken>({
    mint: SOL_MINT,
    symbol: 'SOL',
    logo: null,
    decimals: 9,
  });
  const [toBuy, setToBuy] = useState<SelectedToken>({
    mint: mint ?? '',
    symbol: token.symbol,
    logo: token.imageUrl,
    decimals: 6,
  });

  // Sizing-critical mints ride the fast token-balance source over the
  // slow spot feed — see useLiveBalanceOverlay.
  const liveBalances = useLiveBalanceOverlay(selectedWalletAccountId, [
    mint,
    allocate.mint,
    toBuy.mint,
  ]);
  const options = useMemo<TokenOption[]>(() => {
    const base = [...holdings.options];
    const withPage =
      mint === null
        ? base
        : withPageMintOption(
            base,
            { mint, symbol: token.symbol, name: token.name, logo: token.imageUrl },
            pagePriceUsd,
          );
    // Non-zero live balances may only be laid onto options with reliable
    // decimals: spot rows (DAS-reported) and the page mint — this whole
    // surface is pump-6-dec committed (the price conversion above hardcodes
    // 1e6 base units/token), so the synthetic page-mint option's assumed 6
    // is exactly as trustworthy as every other figure on the tab. This is
    // what keeps buy-then-DCA working inside the 15s DAS window.
    const trusted = new Set(holdings.options.map((o) => o.mint));
    if (mint !== null) trusted.add(mint);
    return overlayOptionBalances(withPage, liveBalances, trusted);
  }, [holdings.options, mint, token.symbol, token.name, token.imageUrl, pagePriceUsd, liveBalances]);
  const [amount, setAmount] = useState('');
  const [durationValue, setDurationValue] = useState('1');
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('hours');
  const [subordersStr, setSubordersStr] = useState(String(DEFAULT_SUBORDERS));
  /** null = untouched → tracks the active preset; string = user override. */
  const [slippageOverride, setSlippageOverride] = useState<string | null>(null);
  const [basis, setBasis] = useState<AdvancedPriceBasis>('price_usd');
  const [floorStr, setFloorStr] = useState('');
  const [ceilStr, setCeilStr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const allocateOption = findOption(options, allocate.mint);
  const allocateDecimals = allocate.decimals ?? allocateOption?.decimals ?? 9;
  const balanceBaseUnits = useMemo<bigint | null>(() => {
    const raw = allocateOption?.balanceBaseUnits;
    if (raw == null) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }, [allocateOption?.balanceBaseUnits]);

  const amountBaseUnits = amount === '' ? null : toBaseUnits(amount, allocateDecimals);
  const amountUsd =
    amountBaseUnits !== null && allocateOption?.priceUsd != null
      ? Number(amount) * allocateOption.priceUsd
      : null;
  const durationSeconds = durationToSeconds(durationValue, durationUnit);
  const suborders = /^\d+$/.test(subordersStr) ? Number(subordersStr) : null;
  const slippagePctStr = slippageOverride ?? formatBps(presetSlippageBps);
  const slippageBps = slippagePctToBps(slippagePctStr);
  const floorUsd = floorStr === '' ? null : parseUsdDecimal(floorStr);
  const ceilUsd = ceilStr === '' ? null : parseUsdDecimal(ceilStr);
  const interval =
    durationSeconds !== null && suborders !== null
      ? intervalSeconds(durationSeconds, suborders)
      : null;
  const perOrder =
    amountBaseUnits !== null && suborders !== null
      ? perSuborderBaseUnits(amountBaseUnits, suborders)
      : null;

  const validationError = validateRecurringForm({
    amountBaseUnits,
    balanceBaseUnits,
    inputMint: allocate.mint,
    outputMint: toBuy.mint,
    suborders,
    durationSeconds,
    slippageBps,
    priceFloorUsd: floorStr === '' ? null : (floorUsd ?? 'invalid'),
    priceCeilingUsd: ceilStr === '' ? null : (ceilUsd ?? 'invalid'),
  });
  const rangeInputError =
    (floorStr !== '' && floorUsd === null) || (ceilStr !== '' && ceilUsd === null)
      ? 'Price range values must be positive decimals.'
      : null;
  const formError = rangeInputError ?? validationError;
  // Inline validation only once the user has started sizing the order.
  const showError = amount !== '' && formError !== null;

  const handleFlip = (): void => {
    const target = findOption(options, toBuy.mint);
    if (!target) {
      setStatusMessage({
        text: `You don't hold ${toBuy.symbol} — nothing to allocate from it.`,
        tone: 'error',
      });
      return;
    }
    const prevAllocate = allocate;
    setAllocate(optionToSelected(target));
    setToBuy(prevAllocate);
    setAmount('');
    setStatusMessage(null);
  };

  const handleMax = (): void => {
    if (balanceBaseUnits === null) {
      setStatusMessage({ text: 'Balance still loading — try again in a second.', tone: 'info' });
      return;
    }
    const max =
      allocate.mint === SOL_MINT ? solMaxSpendableLamports(balanceBaseUnits) : balanceBaseUnits;
    setAmount(formatBaseUnits(max, allocateDecimals));
    setStatusMessage(null);
  };

  const openConfirm = (): void => {
    if (formError !== null) {
      setStatusMessage({ text: formError, tone: 'error' });
      return;
    }
    if (!requireTradingReady()) {
      setStatusMessage({
        text: tradingReadyBlockedMessage(tradingReadyDecision.kind),
        tone: 'error',
      });
      return;
    }
    if (selectedWalletAccountId === null) {
      setStatusMessage({ text: 'Select a wallet before submitting.', tone: 'error' });
      return;
    }
    setStatusMessage(null);
    setConfirmOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (
      submitting ||
      amountBaseUnits === null ||
      suborders === null ||
      durationSeconds === null ||
      slippageBps === null ||
      selectedWalletAccountId === null
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const hasRange = floorUsd !== null || ceilUsd !== null;
      const body: CreateAdvancedOrderRequest = {
        chain: 'solana',
        client_order_id: `advc-${crypto.randomUUID()}`,
        kind: 'recurring',
        wallet_account_id: selectedWalletAccountId,
        input_mint: allocate.mint,
        output_mint: toBuy.mint,
        total_input_base_units: amountBaseUnits.toString(),
        suborders_total: suborders,
        duration_seconds: durationSeconds,
        slippage_bps: slippageBps,
        priority_lamports: lamportsString(priorityLamports),
        bribe_lamports: lamportsString(bribeLamports),
        ...(hasRange ? { price_basis: basis } : {}),
        ...(floorUsd !== null ? { price_floor_usd: floorUsd } : {}),
        ...(ceilUsd !== null ? { price_ceiling_usd: ceilUsd } : {}),
      };
      const authToken = await resolveOrderAuthToken(getToken);
      const result = await createAdvancedOrder(body, { authToken });
      if (result.kind === 'ok') {
        setConfirmOpen(false);
        setAmount('');
        setDurationValue('1');
        setDurationUnit('hours');
        setSubordersStr(String(DEFAULT_SUBORDERS));
        setFloorStr('');
        setCeilStr('');
        setStatusMessage({ text: 'DCA order created — track it in the Orders tab.', tone: 'info' });
      } else if (result.kind === 'reauth') {
        setConfirmOpen(false);
        setStatusMessage({ text: REAUTH_HUMAN_MESSAGE, tone: 'error' });
      } else if (result.kind === 'network_error') {
        setConfirmOpen(false);
        setStatusMessage({ text: `Error: ${result.reason}`, tone: 'error' });
      } else {
        setConfirmOpen(false);
        setStatusMessage({
          text: `Rejected: ${result.message || result.errorCode}`,
          tone: 'error',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const summaryRows = buildSummaryRows({
    amount,
    amountUsd,
    allocateSymbol: allocate.symbol,
    toBuySymbol: toBuy.symbol,
    perOrder,
    allocateDecimals,
    interval,
    suborders,
    durationSeconds,
    priorityLamports,
    bribeLamports,
  });

  const confirmRows: ConfirmRow[] = [
    ...summaryRows,
    { label: 'Slippage / suborder', value: `${slippagePctStr}%` },
    {
      label: 'Price range',
      value:
        floorUsd === null && ceilUsd === null
          ? 'None'
          : `${basis === 'price_usd' ? 'Price' : 'MCap'} ${floorUsd ?? '0'} – ${ceilUsd ?? '∞'} USD`,
    },
  ];

  // Capability gate: the create route hard-503s when the scheduler is
  // off — say so up front instead of letting the user fill the whole
  // form and learn at Confirm. Only an EXPLICIT false blocks (null =
  // capabilities still loading / unavailable — the server preflight
  // remains the backstop).
  if (schedulerDown) {
    return (
      <div className="px-1 py-3">
        <Caption>
          Advanced orders are temporarily unavailable — the order scheduler is offline. Existing
          orders are safe and can be reviewed or cancelled from the Orders tab.
        </Caption>
      </div>
    );
  }

  return (
    <>
      {multiWalletCount > 1 ? (
        <Caption>
          DCA orders run from your primary selected wallet only — the rest of the selection is not
          used.
        </Caption>
      ) : null}
      <FieldCard>
        <CardHeader
          label="Allocate"
          right={
            <TokenPicker
              ariaLabel="Allocate token"
              selected={allocate}
              options={options}
              onSelect={(o) => {
                setAllocate(optionToSelected(o));
                setAmount('');
                setStatusMessage(null);
              }}
            />
          }
        />
        <CardAmountInput value={amount} onChange={setAmount} placeholder="0.0" onMax={handleMax} />
        <CardFootRow
          left={`Balance: ${
            allocateOption?.balanceUi != null
              ? `${allocateOption.balanceUi} ${allocate.symbol}`
              : '—'
          }`}
          right={amountUsd !== null ? `≈ ${formatUsdAmount(amountUsd)}` : ''}
        />
      </FieldCard>

      <FlipButton onFlip={handleFlip} />

      <FieldCard>
        <CardHeader
          label="To Buy"
          right={
            <TokenPicker
              ariaLabel="To Buy token"
              selected={toBuy}
              options={options}
              allowPasteCa
              onPasteMint={(pasted) => {
                const known = findOption(options, pasted);
                setToBuy(
                  known
                    ? optionToSelected(known)
                    : {
                        mint: pasted,
                        symbol: shortMintLabel(pasted),
                        logo: null,
                        decimals: null,
                      },
                );
                setStatusMessage(null);
              }}
              onSelect={(o) => {
                setToBuy(optionToSelected(o));
                setStatusMessage(null);
              }}
            />
          }
        />
        <CardFootRow
          left={toBuy.mint === mint ? 'Current page token' : shortMintLabel(toBuy.mint)}
          right=""
        />
      </FieldCard>

      <div className="flex items-end gap-2">
        <MiniInput label="Over" value={durationValue} onChange={setDurationValue} />
        <div style={{ flex: '0 0 92px' }}>
          <MiniSelect
            ariaLabel="Duration unit"
            value={durationUnit}
            options={DURATION_UNIT_LABELS}
            onChange={setDurationUnit}
          />
        </div>
        <MiniInput label="Total Suborders" value={subordersStr} onChange={setSubordersStr} />
      </div>
      {interval !== null ? (
        <Caption size="sm" tone="ink-3">
          {`Every ${formatDurationShort(interval)} × ${suborders ?? '—'} orders`}
        </Caption>
      ) : null}

      <div className="flex items-end gap-2">
        <MiniInput
          label="Slippage / suborder"
          value={slippagePctStr}
          onChange={setSlippageOverride}
          suffix={
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>
              %
            </span>
          }
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Caption size="sm" tone="ink-3">
            Range basis
          </Caption>
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
      <Caption size="sm" tone="ink-3">
        Orders pause automatically outside this range and resume when back inside.
      </Caption>

      <div
        className="flex flex-col gap-1.5"
        style={{
          padding: '8px 10px',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--hairline)',
          background: 'var(--chip-bg)',
        }}
      >
        {summaryRows.map((row) => (
          <SummaryRow key={row.label} label={row.label} value={row.value} />
        ))}
      </div>

      {/* Live natural-language preview — re-phrases on every keystroke
          across amount / duration / unit / suborders / token pickers;
          renders only once the sentence has all its numbers. */}
      {perOrder !== null && interval !== null && suborders !== null && amount !== '' ? (
        <SentencePreview>
          {'Swap '}
          <Hl>{`${formatBaseUnits(perOrder.base, allocateDecimals, 6)} ${allocate.symbol}`}</Hl>
          {' to '}
          <Hl>{toBuy.symbol}</Hl>
          {' every '}
          <Hl>{formatDurationShort(interval)}</Hl>
          {' over '}
          <Hl>{`${suborders} round${suborders === 1 ? '' : 's'}`}</Hl>
          {' ('}
          <Hl>{`${amount} ${allocate.symbol}`}</Hl>
          {' total).'}
        </SentencePreview>
      ) : null}

      <button
        type="button"
        className="buy-cta"
        onClick={openConfirm}
        style={showError ? { opacity: 0.55 } : undefined}
      >
        <span>Start DCA</span>
      </button>
      {showError ? <div style={{ fontSize: 11, color: 'var(--down)' }}>{formError}</div> : null}
      {statusMessage ? <StatusLine status={statusMessage} /> : null}

      {confirmOpen ? (
        <ConfirmOrderModal
          title="Recurring Summary"
          rows={confirmRows}
          confirmLabel="Confirm"
          submitting={submitting}
          onConfirm={() => void submit()}
          onCancel={() => {
            if (!submitting) setConfirmOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** Integer-lamports preset value → bigint string for the wire. */
function lamportsString(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports <= 0) return '0';
  return BigInt(Math.trunc(lamports)).toString(10);
}

function buildSummaryRows(input: {
  amount: string;
  amountUsd: number | null;
  allocateSymbol: string;
  toBuySymbol: string;
  perOrder: { base: bigint; last: bigint } | null;
  allocateDecimals: number;
  interval: number | null;
  suborders: number | null;
  durationSeconds: number | null;
  priorityLamports: number;
  bribeLamports: number;
}): ConfirmRow[] {
  const {
    amount,
    amountUsd,
    allocateSymbol,
    toBuySymbol,
    perOrder,
    allocateDecimals,
    interval,
    suborders,
    durationSeconds,
    priorityLamports,
    bribeLamports,
  } = input;
  const totalLabel =
    amount !== ''
      ? `${amount} ${allocateSymbol}${amountUsd !== null ? ` (${formatUsdAmount(amountUsd)})` : ''}`
      : '—';
  const perOrderLabel = perOrder
    ? `${formatBaseUnits(perOrder.base, allocateDecimals, 6)} ${allocateSymbol}${
        perOrder.last !== perOrder.base
          ? ` (last ${formatBaseUnits(perOrder.last, allocateDecimals, 6)})`
          : ''
      }`
    : '—';
  const endLabel =
    durationSeconds !== null
      ? new Date(Date.now() + durationSeconds * 1_000).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
  return [
    { label: 'Sell total', value: totalLabel },
    { label: 'Per suborder', value: perOrderLabel },
    { label: 'To buy', value: toBuySymbol },
    { label: 'Interval', value: interval !== null ? formatDurationShort(interval) : '—' },
    { label: 'Orders', value: suborders !== null ? String(suborders) : '—' },
    { label: 'Est. end date', value: endLabel },
    { label: 'Priority fee', value: `${formatLamportsAsSol(priorityLamports)} SOL` },
    { label: 'MEV tip', value: `${formatLamportsAsSol(bribeLamports)} SOL` },
    {
      label: 'Platform fee',
      value: `${formatBps(PLATFORM_FEE_BPS)}% per filled suborder`,
    },
  ];
}
