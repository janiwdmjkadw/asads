import type { WithdrawEvmInput, WithdrawEvmResult } from '@/lib/api/wallets';

export const PENDING_EVM_WITHDRAWAL_PREFIX = 'listen.evm.pending-withdrawal.v1:';
export const MAX_PENDING_EVM_WITHDRAWALS = 16;

type RecoveryReadStorage = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
type RecoveryWriteStorage = RecoveryReadStorage & Pick<Storage, 'setItem' | 'removeItem'>;

interface StoredWithdrawal extends WithdrawEvmInput {
  readonly storedAtMs: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseWithdrawal(value: unknown): StoredWithdrawal | null {
  const candidate = record(value);
  if (
    candidate === null ||
    typeof candidate['sourceWalletAccountId'] !== 'string' ||
    typeof candidate['chain'] !== 'string' ||
    typeof candidate['destinationAddress'] !== 'string' ||
    typeof candidate['nativeOutWei'] !== 'string' ||
    typeof candidate['clientTransferId'] !== 'string' ||
    typeof candidate['storedAtMs'] !== 'number' ||
    !Number.isFinite(candidate['storedAtMs'])
  )
    return null;
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(candidate['destinationAddress']) ||
    !/^[1-9]\d*$/.test(candidate['nativeOutWei']) ||
    candidate['sourceWalletAccountId'].length === 0 ||
    candidate['chain'].length === 0 ||
    candidate['clientTransferId'].length === 0
  )
    return null;
  return candidate as unknown as StoredWithdrawal;
}

function recoveryKey(request: Pick<WithdrawEvmInput, 'chain' | 'clientTransferId'>): string {
  return `${PENDING_EVM_WITHDRAWAL_PREFIX}${encodeURIComponent(request.chain)}:${encodeURIComponent(request.clientTransferId)}`;
}

function recoveryKeys(storage: RecoveryReadStorage): string[] {
  if (typeof storage.length !== 'number' || typeof storage.key !== 'function') return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PENDING_EVM_WITHDRAWAL_PREFIX)) keys.push(key);
  }
  return keys;
}

export function readPendingEvmWithdrawals(storage: RecoveryReadStorage): WithdrawEvmInput[] {
  const entries: StoredWithdrawal[] = [];
  for (const key of recoveryKeys(storage)) {
    try {
      const raw = storage.getItem(key);
      const parsed = raw === null ? null : parseWithdrawal(JSON.parse(raw));
      if (parsed !== null) entries.push(parsed);
    } catch {
      // One malformed entry must not hide another recoverable withdrawal.
    }
  }
  return entries
    .sort((left, right) => right.storedAtMs - left.storedAtMs)
    .slice(0, MAX_PENDING_EVM_WITHDRAWALS)
    .map((entry) => ({
      sourceWalletAccountId: entry.sourceWalletAccountId,
      chain: entry.chain,
      destinationAddress: entry.destinationAddress,
      nativeOutWei: entry.nativeOutWei,
      clientTransferId: entry.clientTransferId,
    }));
}

export function readPendingEvmWithdrawal(
  storage: RecoveryReadStorage,
  wallet: Readonly<Pick<WithdrawEvmInput, 'chain' | 'sourceWalletAccountId'>>,
): WithdrawEvmInput | null {
  return (
    readPendingEvmWithdrawals(storage).find(
      (request) =>
        request.chain === wallet.chain &&
        request.sourceWalletAccountId === wallet.sourceWalletAccountId,
    ) ?? null
  );
}

export function writePendingEvmWithdrawal(
  storage: RecoveryWriteStorage,
  request: WithdrawEvmInput,
): boolean {
  try {
    const ownKey = recoveryKey(request);
    storage.setItem(ownKey, JSON.stringify({ ...request, storedAtMs: Date.now() }));
    const entries = recoveryKeys(storage)
      .map((key) => {
        try {
          const raw = storage.getItem(key);
          const parsed = raw === null ? null : parseWithdrawal(JSON.parse(raw));
          return { key, storedAtMs: parsed?.storedAtMs ?? 0 };
        } catch {
          return { key, storedAtMs: 0 };
        }
      })
      .sort((left, right) => left.storedAtMs - right.storedAtMs || left.key.localeCompare(right.key));
    const excess = Math.max(0, entries.length - MAX_PENDING_EVM_WITHDRAWALS);
    for (const stale of entries.filter(({ key }) => key !== ownKey).slice(0, excess)) {
      storage.removeItem(stale.key);
    }
    return true;
  } catch {
    return false;
  }
}

export function clearPendingEvmWithdrawal(
  storage: Pick<Storage, 'removeItem'>,
  request: Pick<WithdrawEvmInput, 'chain' | 'clientTransferId'>,
): void {
  try {
    storage.removeItem(recoveryKey(request));
  } catch {
    // A known terminal result still wins even if browser storage is blocked.
  }
}

export function replayPendingEvmWithdrawal(
  request: WithdrawEvmInput,
  submit: (exactRequest: WithdrawEvmInput) => Promise<WithdrawEvmResult>,
): Promise<WithdrawEvmResult> {
  return submit(request);
}

export function withdrawalRecoveryDisposition(
  result: WithdrawEvmResult,
  checking: boolean,
): 'confirmed' | 'pending' | 'failed' {
  if (result.kind === 'pending_unconfirmed') return 'pending';
  if (result.kind === 'ok') {
    return result.withdrawal.status === 'confirmed' ? 'confirmed' : 'failed';
  }
  // Once a transfer is known ambiguous, a failed status request says nothing
  // about the transfer itself. Keep its exact request locked for another check.
  return checking ? 'pending' : 'failed';
}

export function withdrawalAmountText(nativeOutWei: string, decimals: number): string | null {
  if (!/^\d+$/.test(nativeOutWei) || !Number.isSafeInteger(decimals) || decimals < 0) return null;
  const padded = nativeOutWei.padStart(decimals + 1, '0');
  if (decimals === 0) return padded;
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}
