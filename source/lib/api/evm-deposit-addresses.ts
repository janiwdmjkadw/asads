'use client';

import { fetchAuthenticatedApi } from './trading';

export type EvmDepositChain = 'bsc' | 'robinhood_chain';

export interface EvmDepositTarget {
  readonly walletAccountId: string;
  readonly chain: EvmDepositChain;
  readonly chainId: number;
  readonly networkName: string;
  /** Server-validated EIP-55 display/copy form. */
  readonly address: string;
  readonly addressLowercase: string;
  readonly nativeSymbol: string;
  readonly nativeDecimals: number;
  readonly label: string | null;
  readonly isPrimary: boolean;
  readonly depositDetection: 'balance_poll';
}

export type EvmDepositTargetsResult =
  | { kind: 'ok'; targets: ReadonlyArray<EvmDepositTarget> }
  | { kind: 'reauth'; reason: 'no_session' | 'session_expired' | 'session_invalid' }
  | { kind: 'error'; status: number; errorCode: string; message: string }
  | { kind: 'network_error'; reason: string };

export interface ListEvmDepositTargetsOptions {
  readonly authToken?: string | null;
  readonly signal?: AbortSignal;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const LOWERCASE_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

const CHAIN_CONTRACT: Readonly<
  Record<
    EvmDepositChain,
    {
      readonly chainId: number;
      readonly networkName: string;
      readonly nativeSymbol: string;
      readonly nativeDecimals: number;
    }
  >
> = {
  bsc: {
    chainId: 56,
    networkName: 'BNB Smart Chain',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
  },
  robinhood_chain: {
    chainId: 4663,
    networkName: 'Robinhood Chain',
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isChain(value: unknown): value is EvmDepositChain {
  return value === 'bsc' || value === 'robinhood_chain';
}

export function parseEvmDepositTarget(raw: unknown): EvmDepositTarget | null {
  if (!isObject(raw)) return null;

  const walletAccountId = raw['wallet_account_id'];
  const chain = raw['chain'];
  const chainId = raw['chain_id'];
  const networkName = raw['network_name'];
  const address = raw['address'];
  const addressLowercase = raw['address_lowercase'];
  const nativeSymbol = raw['native_symbol'];
  const nativeDecimals = raw['native_decimals'];
  const label = raw['label'];
  const isPrimary = raw['is_primary'];
  const depositDetection = raw['deposit_detection'];

  if (
    typeof walletAccountId !== 'string' ||
    !UUID_PATTERN.test(walletAccountId) ||
    !isChain(chain) ||
    typeof chainId !== 'number' ||
    !Number.isInteger(chainId) ||
    typeof networkName !== 'string' ||
    typeof address !== 'string' ||
    !ADDRESS_PATTERN.test(address) ||
    typeof addressLowercase !== 'string' ||
    !LOWERCASE_ADDRESS_PATTERN.test(addressLowercase) ||
    address.toLowerCase() !== addressLowercase ||
    typeof nativeSymbol !== 'string' ||
    typeof nativeDecimals !== 'number' ||
    !Number.isInteger(nativeDecimals) ||
    !(typeof label === 'string' || label === null) ||
    typeof isPrimary !== 'boolean' ||
    depositDetection !== 'balance_poll'
  ) {
    return null;
  }

  const contract = CHAIN_CONTRACT[chain];
  if (
    chainId !== contract.chainId ||
    networkName !== contract.networkName ||
    nativeSymbol !== contract.nativeSymbol ||
    nativeDecimals !== contract.nativeDecimals
  ) {
    return null;
  }

  return {
    walletAccountId,
    chain,
    chainId,
    networkName,
    address,
    addressLowercase,
    nativeSymbol,
    nativeDecimals,
    label,
    isPrimary,
    depositDetection,
  };
}

export function evmDepositTargetKey(walletAccountId: string, chain: string): string {
  return `${chain}:${walletAccountId}`;
}

/**
 * Index only unambiguous targets. If the endpoint ever emits the same
 * account/chain tuple twice, neither row is eligible for display or copy.
 */
export function indexEvmDepositTargets(
  targets: ReadonlyArray<EvmDepositTarget>,
): ReadonlyMap<string, EvmDepositTarget> {
  const indexed = new Map<string, EvmDepositTarget>();
  const duplicates = new Set<string>();
  for (const target of targets) {
    const key = evmDepositTargetKey(target.walletAccountId, target.chain);
    if (indexed.has(key) || duplicates.has(key)) {
      indexed.delete(key);
      duplicates.add(key);
      continue;
    }
    indexed.set(key, target);
  }
  return indexed;
}

export function findEvmDepositTarget(
  indexed: ReadonlyMap<string, EvmDepositTarget>,
  walletAccountId: string,
  chain: string,
): EvmDepositTarget | null {
  return indexed.get(evmDepositTargetKey(walletAccountId, chain)) ?? null;
}

export async function listEvmDepositTargets(
  options: ListEvmDepositTargetsOptions = {},
): Promise<EvmDepositTargetsResult> {
  let response: Response;
  try {
    response = await fetchAuthenticatedApi(
      '/api/v1/wallets/evm-deposit-addresses',
      { method: 'GET' },
      { authToken: options.authToken, signal: options.signal },
    );
  } catch (error) {
    return {
      kind: 'network_error',
      reason: (error as Error).message ?? 'network_error',
    };
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (json['reauth_required'] === true) {
    const rawReason = json['reason'];
    const reason: 'no_session' | 'session_expired' | 'session_invalid' =
      rawReason === 'no_session' ||
      rawReason === 'session_expired' ||
      rawReason === 'session_invalid'
        ? rawReason
        : 'session_invalid';
    return { kind: 'reauth', reason };
  }

  if (response.ok && json['reauth_required'] === false) {
    const rawTargets = json['targets'];
    if (!Array.isArray(rawTargets)) {
      return {
        kind: 'error',
        status: response.status,
        errorCode: 'shape_mismatch',
        message: 'unexpected response shape',
      };
    }
    const targets = rawTargets
      .map(parseEvmDepositTarget)
      .filter((target): target is EvmDepositTarget => target !== null);
    return { kind: 'ok', targets };
  }

  const errorCode = json['error_code'];
  const message = json['message'];
  return {
    kind: 'error',
    status: response.status,
    errorCode: typeof errorCode === 'string' ? errorCode : 'unknown_error',
    message: typeof message === 'string' ? message : 'request failed',
  };
}
