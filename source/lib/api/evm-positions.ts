'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * `GET /api/v1/portfolio/evm?chain=<storage tag>` client — EVM positions and
 * cost basis.
 *
 * WHY THIS FILE EXISTS AT ALL. `lib/api/trade-positions.ts` and the whole
 * `components/positions/*` tree carry no chain parameter anywhere, so a user
 * who bought on BSC saw NOTHING afterwards: the strip asked for Solana
 * positions, got none for that token, and rendered an empty bar. The buy had
 * happened, the tokens were in the wallet, and the terminal's own position
 * surface silently disagreed.
 *
 * WHAT THIS ROUTE DOES AND DOES NOT SERVE (verified against
 * `api/src/routes/portfolio/evm.ts`):
 * - It is parameterized by CHAIN ONLY. No wallet, token or limit parameter —
 *   it enumerates every wallet the session owns on that chain.
 * - Every money value is a DECIMAL STRING of base units. Native is wei;
 *   holdings are token base units at `onchain_decimals`.
 * - Cost basis and realized PnL carry their exact persisted settlement asset
 *   and base-unit amount. Native-only compatibility fields are never used.
 * - USD value and unrealized PnL are rendered only from the API's audited
 *   atto-USD projections. Missing projections stay missing with a reason.
 * - `onchain_base_units: null` and `onchain_decimals: null` mean the RPC read
 *   did not happen or did not answer. They never mean zero. The api retired
 *   its 18-decimals assumption precisely so that `null` could carry that
 *   meaning, and re-introducing a default here would undo it.
 *
 * Result is a tagged union — never throws — matching the shape and defensive
 * posture of `trade-positions.ts`, so a malformed response degrades to
 * `shape_mismatch` rather than rendering garbage.
 */

/** The wave-1 chains this route accepts. `api/src/lib/chains.ts::EVM_CHAIN_TAGS`
 *  rejects slugs and every other tag with a 400, so the terminal only ever
 *  asks with one of these. */
export const EVM_PORTFOLIO_CHAINS = ['bsc', 'robinhood_chain'] as const;
export type EvmPortfolioChain = (typeof EVM_PORTFOLIO_CHAINS)[number];

export function isEvmPortfolioChain(value: string): value is EvmPortfolioChain {
  return (EVM_PORTFOLIO_CHAINS as readonly string[]).includes(value);
}

/** Whether a wallet's native balance could be read, and why not. */
export type EvmNativeStatus = 'ok' | 'unconfigured' | 'unavailable';

export type EvmQuoteAsset = 'native' | 'wrapped_native' | 'token';

export interface EvmHoldingQuote {
  readonly asset: EvmQuoteAsset;
  readonly token: string | null;
  readonly isNative: boolean;
  readonly decimals: number | null;
  readonly symbol: string | null;
}

export interface EvmHolding {
  /** Lowercase 0x token contract. */
  readonly token: string;
  /** On-chain balance in token base units, or `null` when unread. NEVER 0. */
  readonly onchainBaseUnits: string | null;
  /** Decimals read from the contract, or `null` when unread. NEVER defaulted. */
  readonly onchainDecimals: number | null;
  /** The ledger's own token figure (base units) from `portfolio.positions`. */
  readonly ledgerTokens: string;
  /** Exact persisted settlement asset and cost-basis amount. */
  readonly costBasisAsset: string;
  readonly costBasisBaseUnits: string;
  readonly costBasisProvenance: string;
  /** Realized PnL in the same settlement asset. SIGNED. */
  readonly realizedPnlBaseUnits: string;
  readonly quote: EvmHoldingQuote | null;
  readonly priceUsdAtto: string | null;
  readonly nativeUsdNano: string | null;
  readonly ledgerValueUsdAtto: string | null;
  readonly unrealizedPnlUsdAtto: string | null;
  readonly usdUnavailableReason: string | null;
  readonly pnlUnavailableReason: string | null;
  readonly fillCount: number;
  readonly venue: string;
  readonly lastFillAtMs: number | null;
}

export interface EvmWalletPortfolio {
  readonly walletAccountId: string;
  /** Lowercase 0x. */
  readonly walletPubkey: string;
  /** Native balance in wei, or `null` when unread. */
  readonly nativeWei: string | null;
  readonly nativeStatus: EvmNativeStatus;
  /** `BNB` on bsc, `ETH` on robinhood_chain — served, never guessed here. */
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  readonly holdingsTruncatedCount: number;
  readonly holdings: ReadonlyArray<EvmHolding>;
}

export interface EvmPortfolioSuccess {
  readonly kind: 'ok';
  readonly chain: EvmPortfolioChain;
  readonly holdingsTruncatedCount: number;
  readonly wallets: ReadonlyArray<EvmWalletPortfolio>;
}

export type EvmPortfolioResult =
  | EvmPortfolioSuccess
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string }
  | { kind: 'shape_mismatch'; reason: string };

export interface FetchEvmPortfolioOptions {
  signal?: AbortSignal;
  authToken?: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Digits, optionally signed. The api serves decimal strings, never numbers. */
const SIGNED_DECIMAL = /^-?\d+$/;
const UNSIGNED_DECIMAL = /^\d+$/;

/**
 * A base-unit string, or `null`.
 *
 * `''` and `'   '` are rejected rather than coerced: `BigInt('')` is `0n`, and
 * a zero balance for a wallet that actually holds tokens is the exact false
 * claim this whole surface is built to avoid.
 */
function decimalOrNull(raw: unknown, signed = false): string | null {
  if (typeof raw !== 'string') return null;
  return (signed ? SIGNED_DECIMAL : UNSIGNED_DECIMAL).test(raw) ? raw : null;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function addressOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && EVM_ADDRESS.test(raw) ? raw.toLowerCase() : null;
}

function optionalDecimal(
  raw: unknown,
  signed = false,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (raw === undefined) return { ok: true, value: null };
  const value = decimalOrNull(raw, signed);
  return value === null ? { ok: false } : { ok: true, value };
}

function optionalReason(
  raw: unknown,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  if (raw === undefined) return { ok: true, value: null };
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64
    ? { ok: true, value: raw }
    : { ok: false };
}

function parseQuote(
  raw: Record<string, unknown>,
): { readonly ok: true; readonly value: EvmHoldingQuote | null } | { readonly ok: false } {
  const asset = raw['quoteAsset'];
  const native = raw['quoteIsNative'];
  const tokenRaw = raw['quoteToken'];
  const decimalsRaw = raw['quoteDecimals'];
  const symbolRaw = raw['quoteSymbol'];
  if (
    asset === undefined
    && native === undefined
    && tokenRaw === undefined
    && decimalsRaw === undefined
    && symbolRaw === undefined
  ) {
    return { ok: true, value: null };
  }
  if (
    (asset !== 'native' && asset !== 'wrapped_native' && asset !== 'token')
    || typeof native !== 'boolean'
  ) {
    return { ok: false };
  }
  const token = addressOrNull(tokenRaw);
  if (
    (asset === 'native' && (native !== true || tokenRaw !== undefined))
    || (asset === 'wrapped_native' && (native !== true || token === null))
    || (asset === 'token' && (native !== false || token === null))
  ) {
    return { ok: false };
  }
  const decimals = decimalsRaw === undefined
    ? null
    : typeof decimalsRaw === 'number'
      && Number.isInteger(decimalsRaw)
      && decimalsRaw >= 0
      && decimalsRaw <= 36
      ? decimalsRaw
      : undefined;
  if (decimals === undefined) return { ok: false };
  const symbol = symbolRaw === undefined
    ? null
    : typeof symbolRaw === 'string' && symbolRaw.length > 0 && symbolRaw.length <= 32
      ? symbolRaw
      : undefined;
  if (symbol === undefined) return { ok: false };
  return {
    ok: true,
    value: { asset, token, isNative: native, decimals, symbol },
  };
}

function parseHolding(raw: unknown): EvmHolding | null {
  if (!isObject(raw)) return null;
  const token = addressOrNull(raw['token']);
  const ledgerTokens = decimalOrNull(raw['ledger_tokens']);
  const basisAssetRaw = raw['cost_basis_asset'];
  const costBasisAsset = basisAssetRaw === 'native' ? 'native' : addressOrNull(basisAssetRaw);
  const costBasisBaseUnits = decimalOrNull(raw['cost_basis_base_units']);
  const realizedPnlBaseUnits = decimalOrNull(raw['realized_pnl_base_units'], true);
  const provenance = raw['cost_basis_provenance'];
  const fillCount = raw['fill_count'];
  const venue = raw['venue'];
  if (
    token === null
    || ledgerTokens === null
    || costBasisAsset === null
    || costBasisBaseUnits === null
    || realizedPnlBaseUnits === null
    || typeof provenance !== 'string' || provenance.length === 0
    || typeof fillCount !== 'number' || !Number.isInteger(fillCount) || fillCount < 0
    || typeof venue !== 'string' || venue.length === 0
  ) {
    return null;
  }

  const nativeBasis = decimalOrNull(raw['cost_basis_wei']);
  const nativeRealized = decimalOrNull(raw['realized_pnl_wei'], true);
  if (
    (costBasisAsset === 'native'
      && (nativeBasis !== costBasisBaseUnits || nativeRealized !== realizedPnlBaseUnits))
    || (costBasisAsset !== 'native'
      && (raw['cost_basis_wei'] !== null || raw['realized_pnl_wei'] !== null))
  ) {
    return null;
  }

  const quote = parseQuote(raw);
  const priceUsdAtto = optionalDecimal(raw['price_usd_atto']);
  const nativeUsdNano = optionalDecimal(raw['native_usd_nano']);
  const ledgerValueUsdAtto = optionalDecimal(raw['ledger_value_usd_atto']);
  const unrealizedPnlUsdAtto = optionalDecimal(raw['unrealized_pnl_usd_atto'], true);
  const usdUnavailableReason = optionalReason(raw['usd_unavailable_reason']);
  const pnlUnavailableReason = optionalReason(raw['pnl_unavailable_reason']);
  if (
    !quote.ok
    || !priceUsdAtto.ok
    || !nativeUsdNano.ok
    || !ledgerValueUsdAtto.ok
    || !unrealizedPnlUsdAtto.ok
    || !usdUnavailableReason.ok
    || !pnlUnavailableReason.ok
  ) {
    return null;
  }
  if (
    (ledgerValueUsdAtto.value === null) === (usdUnavailableReason.value === null)
    || (unrealizedPnlUsdAtto.value !== null && ledgerValueUsdAtto.value === null)
    || (unrealizedPnlUsdAtto.value === null
      && ledgerValueUsdAtto.value !== null
      && pnlUnavailableReason.value === null)
    || (unrealizedPnlUsdAtto.value !== null && pnlUnavailableReason.value !== null)
  ) {
    return null;
  }

  const decimals = raw['onchain_decimals'];
  const lastFill = raw['last_fill_at_ms'];
  if (
    decimals !== null
    && (
      typeof decimals !== 'number'
      || !Number.isInteger(decimals)
      || decimals < 0
      || decimals > 36
    )
  ) {
    return null;
  }
  if (
    lastFill !== null
    && (
      typeof lastFill !== 'number'
      || !Number.isSafeInteger(lastFill)
      || lastFill < 0
    )
  ) {
    return null;
  }
  const onchainRaw = raw['onchain_base_units'];
  const onchainBaseUnits = onchainRaw === null ? null : decimalOrNull(onchainRaw);
  if (onchainRaw !== null && onchainBaseUnits === null) return null;
  return {
    token,
    onchainBaseUnits,
    onchainDecimals: decimals,
    ledgerTokens,
    costBasisAsset,
    costBasisBaseUnits,
    costBasisProvenance: provenance,
    realizedPnlBaseUnits,
    quote: quote.value,
    priceUsdAtto: priceUsdAtto.value,
    nativeUsdNano: nativeUsdNano.value,
    ledgerValueUsdAtto: ledgerValueUsdAtto.value,
    unrealizedPnlUsdAtto: unrealizedPnlUsdAtto.value,
    usdUnavailableReason: usdUnavailableReason.value,
    pnlUnavailableReason: pnlUnavailableReason.value,
    fillCount,
    venue,
    lastFillAtMs: lastFill,
  };
}

function parseWallet(raw: unknown): EvmWalletPortfolio | null {
  if (!isObject(raw)) return null;
  const walletAccountId = raw['wallet_account_id'];
  const walletPubkey = addressOrNull(raw['wallet_pubkey']);
  const nativeStatusRaw = raw['native_status'];
  const nativeSymbol = raw['native_symbol'];
  const nativeDecimals = raw['native_decimals'];
  const holdingsTruncatedCount = raw['holdings_truncated_count'];
  if (
    typeof walletAccountId !== 'string' || walletAccountId.length === 0
    || walletPubkey === null
    || typeof nativeSymbol !== 'string' || nativeSymbol.length === 0
    || typeof nativeDecimals !== 'number'
    || !Number.isInteger(nativeDecimals)
    || nativeDecimals < 0
    || nativeDecimals > 36
    || typeof holdingsTruncatedCount !== 'number'
    || !Number.isSafeInteger(holdingsTruncatedCount)
    || holdingsTruncatedCount < 0
  ) {
    return null;
  }
  if (
    nativeStatusRaw !== 'ok'
    && nativeStatusRaw !== 'unconfigured'
    && nativeStatusRaw !== 'unavailable'
  ) {
    return null;
  }
  const nativeStatus: EvmNativeStatus = nativeStatusRaw;
  const nativeRaw = raw['native_wei'];
  const nativeWei = nativeRaw === null ? null : decimalOrNull(nativeRaw);
  if (
    (nativeRaw !== null && nativeWei === null)
    || (nativeStatus === 'ok' && nativeWei === null)
    || (nativeStatus !== 'ok' && nativeWei !== null)
  ) {
    return null;
  }
  const holdingsRaw = raw['holdings'];
  if (!Array.isArray(holdingsRaw)) return null;
  const holdings: EvmHolding[] = [];
  const tokens = new Set<string>();
  for (const entry of holdingsRaw) {
    const parsed = parseHolding(entry);
    if (parsed === null || tokens.has(parsed.token)) return null;
    tokens.add(parsed.token);
    holdings.push(parsed);
  }
  return {
    walletAccountId,
    walletPubkey,
    nativeWei,
    nativeStatus,
    nativeSymbol,
    nativeDecimals,
    holdingsTruncatedCount,
    holdings,
  };
}

/**
 * Pure parser. Exported so the branch table is exercised without `fetch`.
 *
 * Note the reauth branch is checked FIRST and is served at HTTP **200** by
 * this route — testing the status code before the body would classify a
 * signed-out user as a successful empty portfolio, i.e. "you hold nothing"
 * instead of "sign in".
 */
export function parseEvmPortfolioResponse(
  json: Record<string, unknown>,
  httpStatus: number,
): EvmPortfolioResult {
  if (json['reauth_required'] === true) {
    const raw = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      raw === 'no_session' || raw === 'session_expired' || raw === 'session_invalid'
        ? raw
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }
  const errorCodeRaw = json['error_code'];
  if (typeof errorCodeRaw === 'string') {
    const message = typeof json['message'] === 'string' ? json['message'] : 'request failed';
    return { kind: 'error', status: httpStatus, errorCode: errorCodeRaw, message };
  }
  if (httpStatus >= 200 && httpStatus < 300 && json['reauth_required'] === false) {
    const chainRaw = json['chain'];
    if (typeof chainRaw !== 'string' || !isEvmPortfolioChain(chainRaw)) {
      return { kind: 'shape_mismatch', reason: 'chain_missing_or_unknown' };
    }
    const walletsRaw = json['wallets'];
    const holdingsTruncatedCount = json['holdings_truncated_count'];
    if (
      !Array.isArray(walletsRaw)
      || typeof holdingsTruncatedCount !== 'number'
      || !Number.isSafeInteger(holdingsTruncatedCount)
      || holdingsTruncatedCount < 0
    ) {
      return { kind: 'shape_mismatch', reason: 'wallets_not_array' };
    }
    const wallets: EvmWalletPortfolio[] = [];
    const walletIds = new Set<string>();
    const addresses = new Set<string>();
    for (const entry of walletsRaw) {
      const parsed = parseWallet(entry);
      if (
        parsed === null
        || walletIds.has(parsed.walletAccountId)
        || addresses.has(parsed.walletPubkey)
      ) {
        return { kind: 'shape_mismatch', reason: 'wallet_or_holding_invalid' };
      }
      walletIds.add(parsed.walletAccountId);
      addresses.add(parsed.walletPubkey);
      wallets.push(parsed);
    }
    const walletTruncatedCount = wallets.reduce(
      (sum, wallet) => sum + wallet.holdingsTruncatedCount,
      0,
    );
    if (walletTruncatedCount !== holdingsTruncatedCount) {
      return { kind: 'shape_mismatch', reason: 'truncation_count_inconsistent' };
    }
    return { kind: 'ok', chain: chainRaw, holdingsTruncatedCount, wallets };
  }
  return { kind: 'shape_mismatch', reason: 'unexpected_response_shape' };
}

export async function fetchEvmPortfolio(
  chain: EvmPortfolioChain,
  options: FetchEvmPortfolioOptions = {},
): Promise<EvmPortfolioResult> {
  const url = `/api/v1/portfolio/evm?chain=${encodeURIComponent(chain)}`;
  let res: Response;
  try {
    res = await fetchAuthenticatedApi(
      url,
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (err) {
    return {
      kind: 'network_error',
      reason: (err as Error).message ?? 'network_error',
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseEvmPortfolioResponse(json, res.status);
}
