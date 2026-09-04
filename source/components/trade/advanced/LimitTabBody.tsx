'use client';

import { useEffect, useMemo, useState } from 'react';
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
  formatBaseUnits,
  parseUsdDecimal,
  PLATFORM_FEE_BPS,
  slippagePctToBps,
  SOL_MINT,
  solMaxSpendableLamports,
  toBaseUnits,
  validateLimitForm,
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
 * Limit tab body. Side-aware defaults: Buy spends SOL/USDC into the
 * page mint when price/mcap ≤ trigger; Sell disposes of page-mint
 * tokens when price/mcap ≥ trigger. Both legs remain overridable via
 * the same pickers as the Advanced tab. Submits kind 'limit' with
 * suborders_total 1 and duration_seconds 0.
 */

interface Props {
  token: MockToken;
  mint: string | null;
  priceLamportsPerBaseUnit: number;
  isBuy: boolean;
}

const BASIS_OPTIONS: ReadonlyArray<{ value: AdvancedPriceBasis; label: string }> = [
  { value: 'price_usd', label: 'Price USD' },
  { value: 'market_cap_usd', label: 'MCap USD' },
];

type ExpiryChoice = 'none' | '1h' | '1d' | '7d' | '30d';

const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryChoice; label: string }> = [
  { value: 'none', label: 'No expiry' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const EXPIRY_MS: Record<Exclude<ExpiryChoice, 'none'>, number> = {
  '1h': 3_600_000,
  '1d': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

export function LimitTabBody({ token, mint, priceLamportsPerBaseUnit, isBuy }: Props) {
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
      || capability.chains.solana.limit.enabled === false);
  // Fee context follows the panel side (buy preset for limit buys,
  // sell preset for limit sells) — captured on the order at create.
  const presetSlippageBps = useTradeStore((state) => {
    const preset = state.tradePresets.presets[state.tradePresets.active_index];
    return isBuy ? preset.buy.slippage_bps : preset.sell.slippage_bps;
  });
  const priorityLamports = useTradeStore((state) => {
    const preset = state.tradePresets.presets[state.tradePresets.active_index];
    return isBuy ? preset.buy.priority_lamports : preset.sell.priority_lamports;
  });
  const bribeLamports = useTradeStore((state) => {
    const preset = state.tradePresets.presets[state.tradePresets.active_index];
    return isBuy ? preset.buy.bribe_lamports : preset.sell.bribe_lamports;
  });

  const holdings = useSpotHoldings(selectedWalletAccountId);
  const solUsd = token.solUsd ?? holdings.solPriceUsd;
  const pagePriceUsd =
    priceLamportsPerBaseUnit > 0 && solUsd != null && solUsd > 0
      ? priceLamportsPerBaseUnit * 1e-3 * solUsd
      : null;

  const pageSelected: SelectedToken = useMemo(
    () => ({ mint: mint ?? '', symbol: token.symbol, logo: token.imageUrl, decimals: 6 }),
    [mint, token.symbol, token.imageUrl],
  );
  const solSelected: SelectedToken = useMemo(
    () => ({ mint: SOL_MINT, symbol: 'SOL', logo: null, decimals: 9 }),
    [],
  );

  // Pay = what leaves the wallet; Receive = what the trigger buys/keeps.
  const [pay, setPay] = useState<SelectedToken>(isBuy ? solSelected : pageSelected);
  const [receive, setReceive] = useState<SelectedToken>(isBuy ? pageSelected : solSelected);

  // Sizing-critical mints ride the fast token-balance source over the
  // slow spot feed — see useLiveBalanceOverlay.
  const liveBalances = useLiveBalanceOverlay(selectedWalletAccountId, [
    mint,
    pay.mint,
    receive.mint,
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
    // what keeps buy-then-sell-limit working inside the 15s DAS window.
    const trusted = new Set(holdings.options.map((o) => o.mint));
    if (mint !== null) trusted.add(mint);
    return overlayOptionBalances(withPage, liveBalances, trusted);
  }, [holdings.options, mint, token.symbol, token.name, token.imageUrl, pagePriceUsd, liveBalances]);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<AdvancedPriceBasis>('price_usd');
  const [triggerStr, setTriggerStr] = useState('');
  const [slippageOverride, setSlippageOverride] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>('none');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  // Side flip resets the pair to the side's defaults (Buy: SOL → page
  // mint under ≤; Sell: page mint → SOL under ≥).
  useEffect(() => {
    setPay(isBuy ? solSelected : pageSelected);
    setReceive(isBuy ? pageSelected : solSelected);
    setAmount('');
    setStatusMessage(null);
  }, [isBuy, pageSelected, solSelected]);

  const payOption = findOption(options, pay.mint);
  const payDecimals = pay.decimals ?? payOption?.decimals ?? 9;
  const balanceBaseUnits = useMemo<bigint | null>(() => {
    const raw = payOption?.balanceBaseUnits;
    if (raw == null) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }, [payOption?.balanceBaseUnits]);

  const amountBaseUnits = amount === '' ? null : toBaseUnits(amount, payDecimals);
  const amountUsd =
    amountBaseUnits !== null && payOption?.priceUsd != null
      ? Number(amount) * payOption.priceUsd
      : null;
  const slippagePctStr = slippageOverride ?? formatBps(presetSlippageBps);
  const slippageBps = slippagePctToBps(slippagePctStr);
  const triggerUsd = triggerStr === '' ? null : parseUsdDecimal(triggerStr);
  const triggerCmp = isBuy ? ('lte' as const) : ('gte' as const);

  const formError = validateLimitForm({
    amountBaseUnits,
    balanceBaseUnits,
    inputMint: pay.mint,
    outputMint: receive.mint,
    slippageBps,
    triggerValueUsd: triggerUsd,
  });
  const showError = amount !== '' && triggerStr !== '' && formError !== null;

  // Live reference next to the trigger input: the page mint's current
  // price or market cap in USD (whichever basis is active).
  const liveReference =
    basis === 'price_usd'
      ? pagePriceUsd !== null
        ? formatUsdAmount(pagePriceUsd)
        : null
      : token.marketCapUsd != null
        ? formatUsdAmount(token.marketCapUsd)
        : null;

  const handleMax = (): void => {
    if (balanceBaseUnits === null) {
      setStatusMessage({ text: 'Balance still loading — try again in a second.', tone: 'info' });
      return;
    }
    const max =
      pay.mint === SOL_MINT ? solMaxSpendableLamports(balanceBaseUnits) : balanceBaseUnits;
    setAmount(formatBaseUnits(max, payDecimals));
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
      slippageBps === null ||
      triggerUsd === null ||
      selectedWalletAccountId === null
    ) {
      return;
    }
    setSubmitting(true);
    try {
      const body: CreateAdvancedOrderRequest = {
        chain: 'solana',
        client_order_id: `advc-${crypto.randomUUID()}`,
        kind: 'limit',
        wallet_account_id: selectedWalletAccountId,
        input_mint: pay.mint,
        output_mint: receive.mint,
        total_input_base_units: amountBaseUnits.toString(),
        suborders_total: 1,
        duration_seconds: 0,
        slippage_bps: slippageBps,
        priority_lamports: lamportsString(priorityLamports),
        bribe_lamports: lamportsString(bribeLamports),
        price_basis: basis,
        trigger_cmp: triggerCmp,
        trigger_value_usd: triggerUsd,
        ...(expiry !== 'none' ? { expires_at_ms: Date.now() + EXPIRY_MS[expiry] } : {}),
      };
      const authToken = await resolveOrderAuthToken(getToken);
      const result = await createAdvancedOrder(body, { authToken });
      if (result.kind === 'ok') {
        setConfirmOpen(false);
        setAmount('');
        setTriggerStr('');
        setExpiry('none');
        setStatusMessage({
          text: 'Limit order created — track it in the Orders tab.',
          tone: 'info',
        });
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

  const cmpGlyph = triggerCmp === 'lte' ? '≤' : '≥';
  const basisLabel = basis === 'price_usd' ? 'price' : 'mcap';
  const expiryLabel = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.label ?? 'No expiry';

  const summaryRows: ConfirmRow[] = [
    {
      label: isBuy ? 'Spend' : 'Sell',
      value:
        amount !== ''
          ? `${amount} ${pay.symbol}${amountUsd !== null ? ` (${formatUsdAmount(amountUsd)})` : ''}`
          : '—',
    },
    { label: isBuy ? 'To buy' : 'Receive', value: receive.symbol },
    {
      label: 'Trigger',
      value: triggerUsd !== null ? `${basisLabel} ${cmpGlyph} $${triggerUsd}` : '—',
    },
    { label: 'Slippage', value: `${slippagePctStr}%` },
    { label: 'Expiry', value: expiryLabel },
    { label: 'Priority fee', value: `${formatLamportsAsSol(priorityLamports)} SOL` },
    { label: 'MEV tip', value: `${formatLamportsAsSol(bribeLamports)} SOL` },
    { label: 'Platform fee', value: `${formatBps(PLATFORM_FEE_BPS)}% on fill` },
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
          Limit orders are temporarily unavailable — the order scheduler is offline. Existing
          orders are safe and can be reviewed or cancelled from the Orders tab.
        </Caption>
      </div>
    );
  }

  return (
    <>
      {multiWalletCount > 1 ? (
        <Caption>
          Limit orders run from your primary selected wallet only — the rest of the selection is
          not used.
        </Caption>
      ) : null}
      <FieldCard>
        <CardHeader
          label={isBuy ? 'Spend' : 'Sell'}
          right={
            <TokenPicker
              ariaLabel="Pay token"
              selected={pay}
              options={options}
              onSelect={(o) => {
                setPay(optionToSelected(o));
                setAmount('');
                setStatusMessage(null);
              }}
            />
          }
        />
        <CardAmountInput value={amount} onChange={setAmount} placeholder="0.0" onMax={handleMax} />
        <CardFootRow
          left={`Balance: ${
            payOption?.balanceUi != null ? `${payOption.balanceUi} ${pay.symbol}` : '—'
          }`}
          right={amountUsd !== null ? `≈ ${formatUsdAmount(amountUsd)}` : ''}
        />
      </FieldCard>

      <FieldCard>
        <CardHeader
          label={isBuy ? 'To Buy' : 'Receive'}
          right={
            <TokenPicker
              ariaLabel="Receive token"
              selected={receive}
              options={options}
              allowPasteCa
              onPasteMint={(pasted) => {
                const known = findOption(options, pasted);
                setReceive(
                  known
                    ? optionToSelected(known)
                    : { mint: pasted, symbol: shortMintLabel(pasted), logo: null, decimals: null },
                );
                setStatusMessage(null);
              }}
              onSelect={(o) => {
                setReceive(optionToSelected(o));
                setStatusMessage(null);
              }}
            />
          }
        />
        <CardFootRow
          left={receive.mint === mint ? 'Current page token' : shortMintLabel(receive.mint)}
          right=""
        />
      </FieldCard>

      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Caption size="sm" tone="ink-3">
            Trigger basis
          </Caption>
          <BasisToggle value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
        </div>
        <MiniInput
          label={`${isBuy ? 'Buy when' : 'Sell when'} ${cmpGlyph} $`}
          value={triggerStr}
          onChange={setTriggerStr}
        />
      </div>
      {liveReference !== null ? (
        <Caption size="sm" tone="ink-3">
          {`Current ${basisLabel}: ${liveReference}`}
        </Caption>
      ) : null}

      <div className="flex items-end gap-2">
        <MiniInput
          label="Slippage"
          value={slippagePctStr}
          onChange={setSlippageOverride}
          suffix={
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-3)' }}>
              %
            </span>
          }
        />
        <div className="flex min-w-0 flex-1">
          <MiniSelect
            label="Expiry"
            ariaLabel="Order expiry"
            value={expiry}
            options={EXPIRY_OPTIONS}
            onChange={setExpiry}
          />
        </div>
      </div>

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

      {/* Live natural-language preview — updates with every keystroke. */}
      {amount !== '' && amountBaseUnits !== null && triggerUsd !== null ? (
        <SentencePreview>
          {isBuy ? (
            <>
              {'Buy '}
              <Hl>{receive.symbol}</Hl>
              {' with '}
              <Hl>{`${amount} ${pay.symbol}`}</Hl>
            </>
          ) : (
            <>
              {'Sell '}
              <Hl>{`${amount} ${pay.symbol}`}</Hl>
              {' to '}
              <Hl>{receive.symbol}</Hl>
            </>
          )}
          {` when ${basisLabel} is `}
          <Hl>{`${cmpGlyph} $${triggerUsd}`}</Hl>
          {expiry !== 'none' ? (
            <>
              {' (expires in '}
              <Hl>{expiryLabel.toLowerCase()}</Hl>
              {')'}
            </>
          ) : null}
          {'.'}
        </SentencePreview>
      ) : null}

      <button
        type="button"
        className={isBuy ? 'buy-cta' : 'sell-cta'}
        onClick={openConfirm}
        style={showError ? { opacity: 0.55 } : undefined}
      >
        <span>{`Place Limit ${isBuy ? 'Buy' : 'Sell'}`}</span>
      </button>
      {showError ? <div style={{ fontSize: 11, color: 'var(--down)' }}>{formError}</div> : null}
      {statusMessage ? <StatusLine status={statusMessage} /> : null}

      {confirmOpen ? (
        <ConfirmOrderModal
          title="Limit Summary"
          rows={summaryRows}
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
