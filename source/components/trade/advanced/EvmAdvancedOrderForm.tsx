'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';

import { resolveOrderAuthToken } from '@/lib/auth/orderAuthToken';
import { useRequireTradingReady } from '@/lib/auth/useRequireTradingReady';
import {
  createAdvancedOrder,
  type AdvancedOrderKind,
  type AdvancedPriceBasis,
  type CreateAdvancedOrderRequest,
} from '@/lib/api/advanced-orders';
import { baseUnitsToInputText } from '@/lib/evm/amount';
import { formatUnits } from '@/lib/evm/money';
import { REAUTH_HUMAN_MESSAGE } from '../reauthMessage';
import {
  BasisToggle,
  CardAmountInput,
  CardFootRow,
  CardHeader,
  FieldCard,
  MiniInput,
  MiniSelect,
  SentencePreview,
  StatusLine,
  tradingReadyBlockedMessage,
  type StatusMessage,
} from './bits';
import { ConfirmOrderModal, type ConfirmRow } from './ConfirmOrderModal';
import { compareUsdDecimals, parseUsdDecimal, toBaseUnits } from './math';

type EvmAdvancedChain = 'bsc' | 'robinhood_chain';
type ExpiryChoice = 'none' | '1h' | '1d' | '7d' | '30d';

const EXPIRY_MS: Record<Exclude<ExpiryChoice, 'none'>, number> = {
  '1h': 3_600_000,
  '1d': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

const BASIS_OPTIONS: ReadonlyArray<{ value: AdvancedPriceBasis; label: string }> = [
  { value: 'price_usd', label: 'Price USD' },
  { value: 'market_cap_usd', label: 'MCap USD' },
];

const EXPIRY_OPTIONS: ReadonlyArray<{ value: ExpiryChoice; label: string }> = [
  { value: 'none', label: 'No expiry' },
  { value: '1h', label: '1 hour' },
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export interface EvmAdvancedOrderFormProps {
  chain: EvmAdvancedChain;
  kind: AdvancedOrderKind;
  side: 'buy' | 'sell';
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number | null;
  quoteAsset: string;
  quoteSymbol: string;
  quoteDecimals: number | null;
  walletAccountId: string | null;
  walletCount: number;
  inputBalanceBaseUnits: string | null;
  /**
   * Why this token cannot be ordered at all, or `null`.
   *
   * REQUIRED, and never defaulted: this is `EvmTradePanel`'s own
   * `blockedReason`, the sentence its Market tab already refuses on
   * (`four_meme_tax_token_unsupported`, `quote_not_native`, `migrating`, an
   * unmeasured scale, no wallet on this chain, …). The Advanced tab used to
   * render without consulting it, so a token the Market tab flatly refuses to
   * trade could still be given a limit or DCA order from the tab beside it —
   * an order the worker would then hold and retry against a market that never
   * becomes orderable. A blocked market is blocked for every order type.
   *
   * It is a REFUSAL TO SUBMIT, not a hidden form: the fields stay readable and
   * the reason is stated, which is what the Market tab does with the same
   * sentence.
   */
  blockedReason: string | null;
  defaultSlippageBps: number;
  onCreated?: () => void;
}

function safePositiveInteger(value: string, max: number): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

/** Everything the submit gate reads. Named so the ladder can be tested. */
export interface EvmAdvancedFormErrorInput {
  /** The MARKET-level refusal, or `null` — see the prop of the same name. */
  readonly blockedReason: string | null;
  readonly kind: AdvancedOrderKind;
  readonly walletCount: number;
  readonly walletAccountId: string | null;
  /** Display label for the input leg, for the decimal-scale sentence. */
  readonly inputSymbol: string;
  readonly inputDecimals: number | null;
  readonly amountBaseUnits: bigint | null;
  /** Balance of the input asset, or `null` when it was never read. */
  readonly balance: bigint | null;
  readonly slippageBps: number | null;
  readonly triggerUsd: string | null;
  readonly durationSeconds: number | null;
  readonly subordersTotal: number | null;
  /** Raw price-range text AND its parse, so "typed but unreadable" stays
   *  distinguishable from "left empty" (only the first is an error). */
  readonly floorText: string;
  readonly floorUsd: string | null;
  readonly ceilingText: string;
  readonly ceilingUsd: string | null;
}

/**
 * The one gate between this form and a live advanced order — `null` means
 * submittable.
 *
 * Pure and exported so the ORDER of the ladder is testable: there is no DOM
 * test infra here, and the ordering is the part that carries money safety.
 * `blockedReason` leads, because everything under it is something the user can
 * fix by typing and it is not — a token the engine refuses is refused whether
 * the order fires now or in an hour.
 */
export function evmAdvancedFormError(input: EvmAdvancedFormErrorInput): string | null {
  if (input.blockedReason !== null) return input.blockedReason;
  if (input.walletCount !== 1) return 'Select exactly one wallet for an advanced order.';
  if (input.walletAccountId === null) return 'Select a wallet before submitting.';
  if (input.inputDecimals === null) {
    return `The ${input.inputSymbol} decimal scale is unavailable.`;
  }
  if (input.amountBaseUnits === null || input.amountBaseUnits <= 0n) {
    return 'Enter a positive amount.';
  }
  if (input.balance !== null && input.amountBaseUnits > input.balance) {
    return 'Amount exceeds wallet balance.';
  }
  if (input.slippageBps === null) return 'Slippage must be 1-10000 bps.';
  if (input.kind === 'limit') {
    if (input.triggerUsd === null) return 'Enter a positive trigger value.';
    return null;
  }
  if (input.durationSeconds === null) return 'Enter a positive duration in seconds.';
  if (input.subordersTotal === null || input.subordersTotal > input.durationSeconds) {
    return 'Suborders must be a whole number no greater than the duration in seconds.';
  }
  if (
    (input.floorText !== '' && input.floorUsd === null)
    || (input.ceilingText !== '' && input.ceilingUsd === null)
  ) {
    return 'Price range values must be positive decimals.';
  }
  if (
    input.floorUsd !== null
    && input.ceilingUsd !== null
    && compareUsdDecimals(input.floorUsd, input.ceilingUsd) >= 0
  ) {
    return 'Price range min must be below max.';
  }
  return null;
}

export function EvmAdvancedOrderForm({
  chain,
  kind,
  side,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  quoteAsset,
  quoteSymbol,
  quoteDecimals,
  walletAccountId,
  walletCount,
  inputBalanceBaseUnits,
  blockedReason,
  defaultSlippageBps,
  onCreated,
}: EvmAdvancedOrderFormProps) {
  const { getToken } = useAuth();
  const { decision: tradingReadyDecision, requireTradingReady } = useRequireTradingReady({
    optimistic: true,
  });
  const inputAsset = side === 'buy' ? quoteAsset : tokenAddress;
  const outputAsset = side === 'buy' ? tokenAddress : quoteAsset;
  const inputSymbol = side === 'buy' ? quoteSymbol : tokenSymbol;
  const outputSymbol = side === 'buy' ? tokenSymbol : quoteSymbol;
  const inputDecimals = side === 'buy' ? quoteDecimals : tokenDecimals;
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(String(defaultSlippageBps));
  const [basis, setBasis] = useState<AdvancedPriceBasis>('price_usd');
  const [trigger, setTrigger] = useState('');
  const [expiry, setExpiry] = useState<ExpiryChoice>('none');
  const [duration, setDuration] = useState('3600');
  const [suborders, setSuborders] = useState('10');
  const [floor, setFloor] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const amountBaseUnits =
    inputDecimals === null || amount === '' ? null : toBaseUnits(amount, inputDecimals);
  const slippageBps = safePositiveInteger(slippage, 10_000);
  const triggerUsd = trigger === '' ? null : parseUsdDecimal(trigger);
  const floorUsd = floor === '' ? null : parseUsdDecimal(floor);
  const ceilingUsd = ceiling === '' ? null : parseUsdDecimal(ceiling);
  const durationSeconds = safePositiveInteger(duration, 365 * 24 * 3_600);
  const subordersTotal = safePositiveInteger(suborders, 10_000);
  const balance = useMemo(() => {
    if (inputBalanceBaseUnits === null || !/^\d+$/.test(inputBalanceBaseUnits)) return null;
    try {
      return BigInt(inputBalanceBaseUnits);
    } catch {
      return null;
    }
  }, [inputBalanceBaseUnits]);

  const formError = evmAdvancedFormError({
    blockedReason,
    kind,
    walletCount,
    walletAccountId,
    inputSymbol,
    inputDecimals,
    amountBaseUnits,
    balance,
    slippageBps,
    triggerUsd,
    durationSeconds,
    subordersTotal,
    floorText: floor,
    floorUsd,
    ceilingText: ceiling,
    ceilingUsd,
  });

  const openConfirm = (): void => {
    if (formError !== null) {
      setStatus({ text: formError, tone: 'error' });
      return;
    }
    if (!requireTradingReady()) {
      setStatus({ text: tradingReadyBlockedMessage(tradingReadyDecision.kind), tone: 'error' });
      return;
    }
    setStatus(null);
    setConfirmOpen(true);
  };

  const submit = async (): Promise<void> => {
    if (
      submitting ||
      formError !== null ||
      walletAccountId === null ||
      amountBaseUnits === null ||
      slippageBps === null
    ) {
      return;
    }
    const common = {
      chain,
      client_order_id: `advc-${crypto.randomUUID()}`,
      wallet_account_id: walletAccountId,
      input_mint: inputAsset,
      output_mint: outputAsset,
      quote_asset: quoteAsset,
      total_input_base_units: amountBaseUnits.toString(),
      slippage_bps: slippageBps,
      priority_lamports: '0',
      bribe_lamports: '0',
    } as const;
    const body: CreateAdvancedOrderRequest =
      kind === 'limit'
        ? {
            ...common,
            kind: 'limit',
            suborders_total: 1,
            duration_seconds: 0,
            price_basis: basis,
            trigger_cmp: side === 'buy' ? 'lte' : 'gte',
            trigger_value_usd: triggerUsd!,
            ...(expiry === 'none' ? {} : { expires_at_ms: Date.now() + EXPIRY_MS[expiry] }),
          }
        : {
            ...common,
            kind: 'recurring',
            suborders_total: subordersTotal!,
            duration_seconds: durationSeconds!,
            ...(floorUsd !== null || ceilingUsd !== null ? { price_basis: basis } : {}),
            ...(floorUsd !== null ? { price_floor_usd: floorUsd } : {}),
            ...(ceilingUsd !== null ? { price_ceiling_usd: ceilingUsd } : {}),
          };
    setSubmitting(true);
    try {
      const result = await createAdvancedOrder(body, {
        authToken: await resolveOrderAuthToken(getToken),
      });
      setConfirmOpen(false);
      if (result.kind === 'ok') {
        setAmount('');
        setStatus({ text: 'Advanced order created — track it in the Orders tab.', tone: 'info' });
        onCreated?.();
      } else if (result.kind === 'reauth') {
        setStatus({ text: REAUTH_HUMAN_MESSAGE, tone: 'error' });
      } else if (result.kind === 'network_error') {
        setStatus({ text: `Error: ${result.reason}`, tone: 'error' });
      } else {
        setStatus({ text: `Rejected: ${result.message || result.errorCode}`, tone: 'error' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const balanceText =
    inputDecimals === null ? null : formatUnits(inputBalanceBaseUnits, inputDecimals, 8);
  const confirmRows: ConfirmRow[] = [
    { label: side === 'buy' ? 'Spend' : 'Sell', value: `${amount || '—'} ${inputSymbol}` },
    { label: 'Receive', value: outputSymbol },
    { label: 'Wallets', value: String(walletCount) },
    { label: 'Slippage', value: `${slippage} bps` },
    ...(kind === 'limit'
      ? [{ label: 'Trigger', value: `${side === 'buy' ? '≤' : '≥'} $${triggerUsd ?? '—'}` }]
      : [
          {
            label: 'Schedule',
            value: `${subordersTotal ?? '—'} orders / ${durationSeconds ?? '—'}s`,
          },
        ]),
  ];

  return (
    <div
      className="scroll-hide flex min-h-0 flex-col gap-3 overflow-y-auto"
      data-testid={`evm-advanced-${kind}`}
    >
      <FieldCard>
        <CardHeader
          label={side === 'buy' ? 'Spend' : 'Sell'}
          right={<strong>{inputSymbol}</strong>}
        />
        <CardAmountInput
          value={amount}
          onChange={(next) => {
            setAmount(next);
            setStatus(null);
          }}
          placeholder="0.0"
          onMax={
            balance !== null && inputDecimals !== null
              ? () => setAmount(baseUnitsToInputText(balance, inputDecimals))
              : undefined
          }
        />
        <CardFootRow
          left={`Balance: ${balanceText === null ? 'unavailable' : `${balanceText} ${inputSymbol}`}`}
          right={`To ${outputSymbol}`}
        />
      </FieldCard>

      {kind === 'limit' ? (
        <FieldCard>
          <BasisToggle value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
          <MiniInput label="Trigger value $" value={trigger} onChange={setTrigger} />
          <MiniSelect
            label="Expiry"
            ariaLabel="Limit order expiry"
            value={expiry}
            options={EXPIRY_OPTIONS}
            onChange={setExpiry}
          />
        </FieldCard>
      ) : (
        <FieldCard>
          <div className="flex items-end gap-2">
            <MiniInput label="Duration (seconds)" value={duration} onChange={setDuration} />
            <MiniInput label="Suborders" value={suborders} onChange={setSuborders} />
          </div>
          <BasisToggle value={basis} options={BASIS_OPTIONS} onChange={setBasis} />
          <div className="flex items-end gap-2">
            <MiniInput label="Min $ (optional)" value={floor} onChange={setFloor} />
            <MiniInput label="Max $ (optional)" value={ceiling} onChange={setCeiling} />
          </div>
        </FieldCard>
      )}

      <FieldCard>
        <MiniInput label="Max slippage (bps)" value={slippage} onChange={setSlippage} />
        <SentencePreview>
          {kind === 'limit'
            ? `${side === 'buy' ? 'Buy' : 'Sell'} ${tokenSymbol} when ${basis === 'price_usd' ? 'price' : 'market cap'} is ${side === 'buy' ? 'at or below' : 'at or above'} the trigger.`
            : `Split ${amount || 'the allocation'} ${inputSymbol} into ${subordersTotal ?? '—'} orders over ${durationSeconds ?? '—'} seconds.`}
        </SentencePreview>
      </FieldCard>

      {/* ONE SLOT, and the blocked case does not wait for an amount. The
          `amount !== ''` gate exists so an untouched form is not scolded for
          being empty — but a market-level refusal is true before a keystroke,
          and withholding it until the user has typed an order they cannot
          place is the warning arriving after the work. */}
      {formError !== null && (blockedReason !== null || amount !== '') ? (
        <StatusLine status={{ text: formError, tone: 'error' }} />
      ) : null}
      <button
        type="button"
        className="buy-cta"
        disabled={formError !== null}
        data-testid={`evm-advanced-${kind}-submit`}
        onClick={openConfirm}
      >
        <span>{kind === 'limit' ? 'Review limit order' : 'Review recurring order'}</span>
      </button>
      {status !== null ? <StatusLine status={status} /> : null}
      <p className="text-[10px] text-muted-foreground">
        The execution worker re-reads live price, route, allowance, balance, and reversible finality
        before every EVM suborder.
      </p>
      {confirmOpen ? (
        <ConfirmOrderModal
          title={kind === 'limit' ? 'Confirm limit order' : 'Confirm recurring order'}
          rows={confirmRows}
          confirmLabel="Create order"
          submitting={submitting}
          onConfirm={() => void submit()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
