'use client';

import { fetchAuthenticatedApi } from './trading';

/**
 * Fetch client for `GET /api/v1/wallets/evm-balances` (WP-105/WP-202).
 *
 * Balance rows keep the storage-form wallet address for wallet selection and
 * other non-deposit consumers. Deposit display/copy authority comes only from
 * `evm-deposit-addresses.ts`.
 *
 * The contract's sharp edges, preserved rather than smoothed:
 * - **`wei` is a decimal string or `null`.** Never a number (18-decimal
 *   balances pass `Number.MAX_SAFE_INTEGER` at 0.01 native units) and never
 *   `"0"` for unknown. `null` + `status` says WHICH kind of unknown:
 *   `unconfigured` (no RPC for that chain) or `unavailable` (the read
 *   failed). Collapsing either to 0 tells a user their funded wallet is
 *   empty.
 * - **Per-chain degradation is per ROW.** One chain's RPC being down must
 *   not blank the other chain's real balances, so a row is judged on its own
 *   `status` and never on a page-level flag.
 * - **`native_decimals` comes from the wire here**, unlike the ingestion
 *   read API. Use it; do not assume 18.
 */

export const EVM_BALANCE_STATUSES = ['ok', 'unconfigured', 'unavailable'] as const;
export type EvmBalanceStatus = (typeof EVM_BALANCE_STATUSES)[number];
const EVM_WALLET_CHAINS = ['bsc', 'robinhood_chain'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/;
const MAX_U256 = (1n << 256n) - 1n;
const MAX_USD_RATE_DIGITS = 80;

/**
 * Cross-surface invalidation for the non-React-Query EVM wallet readers.
 *
 * Creating a wallet invalidates the Solana `/me` queries, but the EVM wallet
 * panel and a previously visited persistent EVM trade pane own independent
 * request state. Without an explicit signal both keep the pre-create wallet
 * list until a reload, making the newly created companion wallets look
 * missing and leaving the trade selector unusable.
 */
export const EVM_WALLETS_CHANGED_EVENT = 'listen:evm-wallets-changed';

export function announceEvmWalletsChanged(
  target: Pick<EventTarget, 'dispatchEvent'> = globalThis,
): void {
  target.dispatchEvent(new Event(EVM_WALLETS_CHANGED_EVENT));
}

/** Bounded post-create reconciliation: immediate, then exponential backoff. */
export const EVM_WALLET_RECONCILE_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000, 8_000] as const;

export interface EvmWalletBalance {
  readonly wallet_account_id: string;
  /** Lowercase 0x address — the storage form, not deposit authority. */
  readonly wallet_pubkey: string;
  readonly chain: string;
  /** Decimal wei, or `null` when it could not be read. NEVER "0" for that. */
  readonly wei: string | null;
  readonly status: EvmBalanceStatus;
  readonly native_symbol: string;
  readonly native_decimals: number;
  readonly native_usd_nano: string | null;
  readonly native_usd_publish_time_sec: number | null;
  readonly usd_unavailable_reason?: string;
  readonly wallet_status: string;
  readonly is_enabled: boolean;
  readonly is_archived: boolean;
  readonly trade_eligible: boolean;
}

export type EvmWalletBalancesResult =
  | { kind: 'ok'; balances: ReadonlyArray<EvmWalletBalance> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export type EvmWalletRepairResult =
  | {
      kind: 'ok';
      status: 'repaired' | 'already_complete' | 'failed';
      scanned: number;
      repaired: number;
      failed: number;
      errorCode: string | null;
    }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | {
      kind: 'error';
      status: number;
      errorCode: string;
      message: string;
      retryAfterMs: number | null;
    }
  | { kind: 'network_error'; reason: string };

function walletIdentity(row: EvmWalletBalance): string {
  return `${row.chain}:${row.wallet_account_id}`;
}

function walletIdentities(result: EvmWalletBalancesResult | null): Set<string> | null {
  return result?.kind === 'ok'
    ? new Set(result.balances.map(walletIdentity))
    : null;
}

async function waitForReconcileDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Re-read after wallet creation until a companion EVM row appears.
 *
 * The create endpoint commits the Solana wallet before it starts EVM
 * provisioning, so one immediate invalidation is only an observation of the
 * race. The baseline is the last rendered EVM set. If there was no usable
 * baseline, the first successful read establishes one and the loop remains
 * bounded rather than claiming its pre-existing rows are the new companions.
 */
export async function reconcileEvmWalletsAfterCreation(options: {
  readonly previous: EvmWalletBalancesResult | null;
  readonly load: () => Promise<EvmWalletBalancesResult>;
  readonly signal?: AbortSignal;
  readonly delaysMs?: readonly number[];
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<EvmWalletBalancesResult | null> {
  let baseline = walletIdentities(options.previous);
  let latest: EvmWalletBalancesResult | null = options.previous;
  const wait = options.wait ?? waitForReconcileDelay;
  const isAborted = () => options.signal?.aborted ?? false;
  for (const delayMs of options.delaysMs ?? EVM_WALLET_RECONCILE_DELAYS_MS) {
    await wait(delayMs, options.signal);
    if (isAborted()) return null;
    latest = await options.load();
    if (isAborted()) return null;
    const current = walletIdentities(latest);
    if (current === null) continue;
    if (baseline === null) {
      baseline = current;
      continue;
    }
    const knownBaseline = baseline;
    if ([...current].some((identity) => !knownBaseline.has(identity))) return latest;
  }
  return latest;
}

export interface ListEvmBalancesOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStatus(value: unknown): value is EvmBalanceStatus {
  return (
    typeof value === 'string' && (EVM_BALANCE_STATUSES as readonly string[]).includes(value)
  );
}

function isCanonicalU256(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_UINT.test(value)) return false;
  try {
    return BigInt(value) <= MAX_U256;
  } catch {
    return false;
  }
}

function isSupportedChain(value: unknown): value is (typeof EVM_WALLET_CHAINS)[number] {
  return typeof value === 'string' && (EVM_WALLET_CHAINS as readonly string[]).includes(value);
}

function reauthReason(value: unknown): 'no_session' | 'session_expired' | 'session_invalid' {
  return value === 'no_session' || value === 'session_expired' || value === 'session_invalid'
    ? value
    : 'session_invalid';
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseEvmWalletRepairResponse(status: number, raw: unknown): EvmWalletRepairResult {
  if (!isObject(raw)) {
    return {
      kind: 'error',
      status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
      retryAfterMs: null,
    };
  }
  if (raw['reauth_required'] === true) {
    return { kind: 'reauth', reason: reauthReason(raw['reason']) };
  }
  const repair = raw['repair'];
  if (raw['reauth_required'] === false && isObject(repair)) {
    const repairStatus = repair['status'];
    const scanned = repair['scanned'];
    const repaired = repair['repaired'];
    const failed = repair['failed'];
    const errorCode = repair['error_code'];
    if (
      status >= 200 &&
      status < 300 &&
      isSafeNonnegativeInteger(scanned) &&
      isSafeNonnegativeInteger(repaired) &&
      isSafeNonnegativeInteger(failed) &&
      scanned === repaired + failed &&
      ((repairStatus === 'repaired' && repaired > 0 && failed === 0 && errorCode === undefined) ||
        (repairStatus === 'already_complete' &&
          scanned === 0 &&
          repaired === 0 &&
          failed === 0 &&
          errorCode === undefined) ||
        (repairStatus === 'failed' && failed > 0 && typeof errorCode === 'string'))
    ) {
      return {
        kind: 'ok',
        status: repairStatus,
        scanned,
        repaired,
        failed,
        errorCode: typeof errorCode === 'string' ? errorCode : null,
      };
    }
  }
  const errorCode = raw['error_code'];
  const message = raw['message'];
  const retryAfterMs = raw['retry_after_ms'];
  return {
    kind: 'error',
    status,
    errorCode: typeof errorCode === 'string' ? errorCode : 'shape_mismatch',
    message: typeof message === 'string' ? message : 'unexpected response shape',
    retryAfterMs:
      typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0
        ? retryAfterMs
        : null,
  };
}

export function parseEvmBalance(raw: unknown): EvmWalletBalance | null {
  if (!isObject(raw)) return null;
  const walletAccountId = raw['wallet_account_id'];
  const walletPubkey = raw['wallet_pubkey'];
  const chain = raw['chain'];
  const wei = raw['wei'];
  const status = raw['status'];
  const nativeSymbol = raw['native_symbol'];
  const nativeDecimals = raw['native_decimals'];
  const nativeUsdNano = raw['native_usd_nano'];
  const nativeUsdPublishTimeSec = raw['native_usd_publish_time_sec'];
  const usdUnavailableReason = raw['usd_unavailable_reason'];
  const walletStatus = raw['wallet_status'];
  const isEnabled = raw['is_enabled'];
  const isArchived = raw['is_archived'];
  const tradeEligible = raw['trade_eligible'];
  if (
    typeof walletAccountId !== 'string' ||
    !UUID.test(walletAccountId) ||
    typeof walletPubkey !== 'string' ||
    !EVM_ADDRESS.test(walletPubkey) ||
    !isSupportedChain(chain) ||
    !(isCanonicalU256(wei) || wei === null) ||
    !isStatus(status) ||
    typeof nativeSymbol !== 'string' ||
    typeof walletStatus !== 'string' ||
    walletStatus.length === 0 ||
    walletStatus.length > 64 ||
    typeof isEnabled !== 'boolean' ||
    typeof isArchived !== 'boolean' ||
    typeof tradeEligible !== 'boolean' ||
    // A SCALE, not just a number. `money.ts` does `10n ** BigInt(decimals)`,
    // which THROWS `RangeError` on a negative exponent — a malformed row
    // would have crashed the wallets tab during render instead of being
    // dropped. 36 is well past any real ERC-20 and keeps the exponent bounded.
    nativeDecimals !== 18 ||
    (chain === 'bsc' ? nativeSymbol !== 'BNB' : nativeSymbol !== 'ETH') ||
    (status === 'ok' ? wei === null : wei !== null) ||
    tradeEligible !== (walletStatus === 'active' && isEnabled && !isArchived) ||
    !(
      (typeof nativeUsdNano === 'string'
        && nativeUsdNano.length <= MAX_USD_RATE_DIGITS
        && /^[1-9][0-9]*$/.test(nativeUsdNano)
        && typeof nativeUsdPublishTimeSec === 'number'
        && Number.isSafeInteger(nativeUsdPublishTimeSec)
        && nativeUsdPublishTimeSec > 0
        && usdUnavailableReason === undefined)
      || (nativeUsdNano === null
        && nativeUsdPublishTimeSec === null
        && typeof usdUnavailableReason === 'string'
        && usdUnavailableReason.length > 0
        && usdUnavailableReason.length <= 128)
    )
  ) {
    return null;
  }
  return {
    wallet_account_id: walletAccountId,
    wallet_pubkey: walletPubkey.toLowerCase(),
    chain,
    wei,
    status,
    native_symbol: nativeSymbol,
    native_decimals: nativeDecimals,
    native_usd_nano: nativeUsdNano,
    native_usd_publish_time_sec: nativeUsdPublishTimeSec,
    ...(typeof usdUnavailableReason === 'string'
      ? { usd_unavailable_reason: usdUnavailableReason }
      : {}),
    wallet_status: walletStatus,
    is_enabled: isEnabled,
    is_archived: isArchived,
    trade_eligible: tradeEligible,
  };
}

export function parseEvmWalletBalancesResponse(
  status: number,
  raw: unknown,
): EvmWalletBalancesResult {
  if (!isObject(raw)) {
    return {
      kind: 'error',
      status,
      errorCode: 'shape_mismatch',
      message: 'unexpected response shape',
    };
  }
  if (raw['reauth_required'] === true) {
    return { kind: 'reauth', reason: reauthReason(raw['reason']) };
  }
  if (status >= 200 && status < 300 && raw['reauth_required'] === false) {
    const balancesRaw = raw['balances'];
    if (!Array.isArray(balancesRaw)) {
      return {
        kind: 'error',
        status,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
      };
    }
    const balances: EvmWalletBalance[] = [];
    const accountIds = new Set<string>();
    const chainAddresses = new Set<string>();
    for (const entry of balancesRaw) {
      const parsed = parseEvmBalance(entry);
      if (parsed === null) {
        return {
          kind: 'error',
          status,
          errorCode: 'shape_mismatch',
          message: 'unexpected response shape',
        };
      }
      const chainAddress = `${parsed.chain}:${parsed.wallet_pubkey}`;
      if (accountIds.has(parsed.wallet_account_id) || chainAddresses.has(chainAddress)) {
        return {
          kind: 'error',
          status,
          errorCode: 'shape_mismatch',
          message: 'unexpected response shape',
        };
      }
      accountIds.add(parsed.wallet_account_id);
      chainAddresses.add(chainAddress);
      balances.push(parsed);
    }
    return { kind: 'ok', balances };
  }
  const errorCode = raw['error_code'];
  const message = raw['message'];
  return {
    kind: 'error',
    status,
    errorCode: typeof errorCode === 'string' ? errorCode : 'unknown_error',
    message: typeof message === 'string' ? message : 'request failed',
  };
}

export async function listEvmWalletBalances(
  options: ListEvmBalancesOptions = {},
): Promise<EvmWalletBalancesResult> {
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      '/api/v1/wallets/evm-balances',
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (error) {
    return {
      kind: 'network_error',
      reason: (error as Error).message ?? 'network_error',
    };
  }
  const json = await response.json().catch(() => null);
  return parseEvmWalletBalancesResponse(response.status, json);
}

export async function repairEvmWallets(
  options: ListEvmBalancesOptions = {},
): Promise<EvmWalletRepairResult> {
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      '/api/v1/wallets/evm-repair',
      { method: 'POST' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (error) {
    return {
      kind: 'network_error',
      reason: (error as Error).message ?? 'network_error',
    };
  }
  const json = await response.json().catch(() => null);
  return parseEvmWalletRepairResponse(response.status, json);
}
