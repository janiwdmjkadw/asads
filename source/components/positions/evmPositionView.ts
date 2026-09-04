/**
 * `GET /api/v1/portfolio/evm` → rows the position strip can render.
 *
 * Pure, so every rule below is testable without a network or a DOM. The rules
 * are the whole file:
 *
 * 1. **An EVM position is never summed into a Solana total.** There is no
 *    total here at all, and that is deliberate: lamports and wei differ by
 *    ~1e9, native assets differ per chain, and one contaminated total is worse
 *    than a missing one. `usePositionsStream`'s Solana `PositionItem` and this
 *    `EvmPositionRow` are separate types for the same reason — they cannot be
 *    pushed into one array by accident.
 * 2. **Absent is never zero and never a fabricated number.** A balance the RPC
 *    could not read is `null` on the wire and renders as unknown-with-reason.
 *    A sub-unit balance renders as a bound (`<0.0001`), never `0`.
 * 3. **Decimals are used, not assumed.** `onchain_decimals` is read off the
 *    contract by the api and is `null` when the read failed. A `null` scale
 *    means the amount CANNOT be expressed in whole tokens, so the row shows
 *    base units and says so — it does not fall back to 18. (Every other EVM
 *    surface still assumes 18 because its wire carries no decimals at all;
 *    this one does, so it does not.)
 * 4. **The money leg is named, never assumed.** A Pons launch quoted in a
 *    Robinhood STOCK token (NVDA/SPY) has a cost basis denominated in that
 *    stock, not in ETH, and labelling it `ETH` misstates the figure by the
 *    whole NVDA/ETH rate. The caller passes what it knows about the market's
 *    quote asset; absent that knowledge the row says the denomination is
 *    unconfirmed rather than printing the chain's ticker.
 * 5. **No USD is invented.** The route serves none — not a null field, no
 *    field — and there is no rate on this surface to derive one from. Value
 *    and unrealized PnL are therefore structurally unavailable, with the
 *    reason attached, on every row.
 */

import type { QuoteDenomination } from '@/components/discover/chainBinding';
import { nativeSymbolForChain, tradePageHref } from '@/lib/evm/chains';
import { formatBigIntUnits, parseWire, parseWireSigned } from '@/lib/evm/money';
import type {
  EvmHolding,
  EvmPortfolioChain,
  EvmWalletPortfolio,
} from '@/lib/api/evm-positions';

/** An amount we can show, with the unit it is in — or the reason we cannot. */
export type EvmAmount =
  | {
      readonly kind: 'amount';
      /** Display text. Already truncated; may be a `<0.0001`-style bound. */
      readonly text: string;
      /** Unit label, or `null` when the unit itself is unconfirmed. */
      readonly unit: string | null;
      /** Extra disclosure to render beside it, or `null`. */
      readonly note: string | null;
    }
  | { readonly kind: 'unknown'; readonly reason: string };

/** Why a figure is absent. Rendered verbatim — never logged-only. */
export const EVM_VALUE_UNAVAILABLE =
  'Position value is unavailable because the API did not serve a measured USD projection.';

export const EVM_UNREALIZED_UNAVAILABLE =
  'Unrealized PnL is unavailable because the API did not serve a measured projection.';

const EVM_BALANCE_UNREAD =
  'On-chain balance was not read for this token, so the amount is unknown '
  + 'rather than zero.';

const EVM_SCALE_UNKNOWN =
  'This token’s decimals could not be read from its contract, so the amount is '
  + 'shown in raw base units. Scaling it by an assumed exponent could be wrong '
  + 'by a power of ten.';

const EVM_DENOMINATION_UNCONFIRMED =
  'The asset this position’s cost basis is denominated in has not been '
  + 'confirmed for this market. Some launches are quoted in a stock token '
  + '(NVDA, SPY) rather than the chain’s native asset, and the two are not '
  + 'comparable without that token’s rate.';

/** One EVM open position, ready for a pill. */
export interface EvmPositionRow {
  /** Chain-qualified key. `bsc:0x…` — a bare address collides across chains. */
  readonly id: string;
  readonly chain: EvmPortfolioChain;
  /** Lowercase 0x token contract. */
  readonly token: string;
  /** Trade-page destination, chain-qualified. */
  readonly href: string;
  /** Which wallet holds it. */
  readonly walletAccountId: string;
  /** Lowercase 0x wallet address served for that account. */
  readonly walletAddress: string;
  /** Short display label for the token — an address until identity lands. */
  readonly label: string;
  /** How much of the token is held. */
  readonly amount: EvmAmount;
  /** What was paid, in the market's money leg. */
  readonly costBasis: EvmAmount;
  /** Realized PnL, signed, in the market's money leg. */
  readonly realizedPnl: EvmAmount;
  /** Measured atto-USD projection, or an explicit reason it is unavailable. */
  readonly value: EvmAmount;
  /** Measured atto-USD unrealized PnL, or an explicit unavailable reason. */
  readonly unrealizedPnl: EvmAmount;
  readonly fillCount: number;
  readonly lastFillAtMs: number | null;
}

/** `0x1234…abcd`. */
export function shortenAddress(address: string): string {
  return address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

/**
 * The token amount, scaled by MEASURED decimals or not scaled at all.
 *
 * The three outcomes are genuinely different and the row must not blur them:
 * a balance we read and can scale, a balance we read but cannot express in
 * whole tokens, and a balance we never read. Only the last is "unknown"; the
 * middle one is a real measurement in an awkward unit, and hiding it would
 * lose information the user has a right to.
 */
export function evmHoldingAmount(holding: EvmHolding): EvmAmount {
  const raw = holding.onchainBaseUnits;
  if (raw === null) return { kind: 'unknown', reason: EVM_BALANCE_UNREAD };
  const value = parseWire(raw);
  if (value === null) return { kind: 'unknown', reason: EVM_BALANCE_UNREAD };
  if (holding.onchainDecimals === null) {
    return {
      kind: 'amount',
      text: formatBigIntUnits(value, 0, 0),
      unit: 'base units',
      note: EVM_SCALE_UNKNOWN,
    };
  }
  return {
    kind: 'amount',
    // 4 fraction digits, truncated, with the sub-unit bound: a dust balance
    // renders `<0.0001`, never `0`.
    text: formatBigIntUnits(value, holding.onchainDecimals, 4),
    unit: null,
    note: null,
  };
}

/**
 * Label and disclosure for the money leg of a position.
 *
 * `quote` is what the CALLER knows about this market — typically from the
 * discover/trade wire's `quoteAsset` / `quoteIsNative`. Passing nothing is the
 * honest default and produces an unconfirmed denomination, because the
 * portfolio route itself carries no quote-asset field: it reports the chain's
 * `native_symbol`, which describes the wallet's NATIVE balance and says
 * nothing about what a given market's money leg is.
 */
export function evmMoneyUnit(
  chain: EvmPortfolioChain,
  quote?: QuoteDenomination,
): { unit: string | null; note: string | null } {
  if (quote === undefined) {
    return { unit: null, note: EVM_DENOMINATION_UNCONFIRMED };
  }
  if (quote.isNative) {
    return { unit: nativeSymbolForChain(chain), note: null };
  }
  return {
    unit: quote.unitSymbol,
    note:
      `This position is denominated in ${quote.unitSymbol ?? 'another token'}, `
      + 'not in the chain’s native asset. It is not comparable to a '
      + 'native-quoted position without that token’s rate.',
  };
}

function moneyAmount(
  raw: string,
  holding: EvmHolding,
  wallet: EvmWalletPortfolio,
  signed: boolean,
): EvmAmount {
  const value = signed ? parseWireSigned(raw) : parseWire(raw);
  if (value === null) {
    return { kind: 'unknown', reason: 'This figure was not served in a readable form.' };
  }
  let decimals: number | null;
  let unit: string;
  let note: string | null = null;
  if (holding.costBasisAsset === 'native') {
    decimals = wallet.nativeDecimals;
    unit = wallet.nativeSymbol;
  } else if (holding.quote?.token === holding.costBasisAsset) {
    decimals = holding.quote.decimals;
    unit = holding.quote.symbol ?? shortenAddress(holding.costBasisAsset);
    note = `This position is denominated in ${unit}, not the chain's native asset.`;
  } else {
    decimals = null;
    unit = shortenAddress(holding.costBasisAsset);
    note = EVM_DENOMINATION_UNCONFIRMED;
  }
  if (decimals === null) {
    return {
      kind: 'amount',
      text: formatBigIntUnits(value, 0, 0),
      unit: `${unit} base units`,
      note: `${note ?? ''} ${EVM_SCALE_UNKNOWN}`.trim(),
    };
  }
  return {
    kind: 'amount',
    text: formatBigIntUnits(value, decimals, 6),
    unit,
    note,
  };
}

/**
 * The api's USD fixed-point scale: `*_usd_atto` fields are ATTO-dollars, i.e.
 * 10^-18 USD.
 *
 * NOT the chain's native decimals, which are also 18 and are
 * `EVM_NATIVE_DECIMALS`. Two unrelated 18s in one file is how a later edit
 * "unifies" them and starts rendering dollars at whatever a future chain's
 * coin uses; naming this one keeps the coincidence from reading as a shared
 * fact. The atto scale is fixed by the wire (`ledger_value_usd_atto`,
 * `unrealized_pnl_usd_atto`) and does not vary by chain at all.
 */
const USD_ATTO_DECIMALS = 18;

function usdAmount(
  raw: string | null,
  reason: string | null,
  fallback: string,
  signed: boolean,
): EvmAmount {
  const value = raw === null ? null : signed ? parseWireSigned(raw) : parseWire(raw);
  if (value === null) return { kind: 'unknown', reason: reason ?? fallback };
  return {
    kind: 'amount',
    text: formatBigIntUnits(value, USD_ATTO_DECIMALS, 6),
    unit: 'USD',
    note: null,
  };
}

export interface EvmPositionsInput {
  readonly chain: EvmPortfolioChain;
  readonly wallets: ReadonlyArray<EvmWalletPortfolio>;
}

/**
 * Flatten the route's wallet-major response into position rows.
 *
 * NOT aggregated across wallets, unlike the Solana strip. Aggregating requires
 * summing base-unit balances across holdings, and two wallets' rows for one
 * token can disagree about `onchain_decimals` (one read succeeded, the other
 * did not) — summing those is adding numbers on two different scales. A
 * per-wallet row is the truthful unit of this route, so that is what it emits.
 *
 * Rows with a genuinely zero ledger position AND a zero on-chain balance are
 * dropped: that is a closed position, not an unknown one, and the strip shows
 * open positions. A row whose balance is UNKNOWN is kept — dropping it would
 * be treating unknown as zero, one level up from the wire.
 */
export function toEvmPositionRows(input: EvmPositionsInput): EvmPositionRow[] {
  const rows: EvmPositionRow[] = [];
  for (const wallet of input.wallets) {
    for (const holding of wallet.holdings) {
      const onchain = parseWire(holding.onchainBaseUnits);
      const ledger = parseWire(holding.ledgerTokens);
      const closed = onchain === 0n && (ledger === null || ledger === 0n);
      if (closed) continue;
      rows.push({
        id: `${input.chain}:${holding.token}:${wallet.walletAccountId}`,
        chain: input.chain,
        token: holding.token,
        href: tradePageHref(holding.token, input.chain),
        walletAccountId: wallet.walletAccountId,
        walletAddress: wallet.walletPubkey,
        label: shortenAddress(holding.token),
        amount: evmHoldingAmount(holding),
        costBasis: moneyAmount(holding.costBasisBaseUnits, holding, wallet, false),
        realizedPnl: moneyAmount(holding.realizedPnlBaseUnits, holding, wallet, true),
        value: usdAmount(
          holding.ledgerValueUsdAtto,
          holding.usdUnavailableReason,
          EVM_VALUE_UNAVAILABLE,
          false,
        ),
        unrealizedPnl: usdAmount(
          holding.unrealizedPnlUsdAtto,
          holding.pnlUnavailableReason,
          EVM_UNREALIZED_UNAVAILABLE,
          true,
        ),
        fillCount: holding.fillCount,
        lastFillAtMs: holding.lastFillAtMs,
      });
    }
  }
  return rows;
}

/** Display text for an amount: `1.234 BNB`, `4200 base units`, or the value
 *  alone when the unit is unconfirmed. Never returns `'0'` for a non-zero
 *  quantity — that bound is applied by `formatBigIntUnits` upstream. */
export function evmAmountText(amount: EvmAmount): string | null {
  if (amount.kind !== 'amount') return null;
  return amount.unit === null ? amount.text : `${amount.text} ${amount.unit}`;
}
