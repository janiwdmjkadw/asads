import {
  evmLaunchOption,
  evmLaunchOptionsForChain,
  type EvmLaunchpad,
  type EvmLaunchVariant,
} from './discoverAdapter';

export type EvmLaunchIdentityKey = `${EvmLaunchpad}:${EvmLaunchVariant}`;

const STORAGE_PREFIX = 'evm-discover-launch-selection:v1:';

export function evmLaunchIdentityKey(
  launchpad: EvmLaunchpad,
  launchVariant: EvmLaunchVariant,
): EvmLaunchIdentityKey {
  return `${launchpad}:${launchVariant}`;
}

export function allEvmLaunchIdentityKeys(chain: string): readonly EvmLaunchIdentityKey[] {
  return evmLaunchOptionsForChain(chain).map((option) => (
    evmLaunchIdentityKey(option.launchpad, option.launchVariant)
  ));
}

export function parseEvmLaunchSelection(
  chain: string,
  value: string | null,
): readonly EvmLaunchIdentityKey[] | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  // AN EMPTY SELECTION IS NOT A PERSISTABLE STATE. Restored on a later load it
  // hides every card on the chain behind a filter whose emptiness is offscreen
  // — three lanes reading 0, which is the same "absence rendered as a
  // measurement" the board's unavailable state exists to prevent. It fails
  // safe to "all", exactly as an unparseable value does.
  if (parsed.length === 0) return null;
  const selected: EvmLaunchIdentityKey[] = [];
  const seen = new Set<EvmLaunchIdentityKey>();
  for (const candidate of parsed) {
    if (typeof candidate !== 'string') return null;
    const separator = candidate.indexOf(':');
    if (separator <= 0 || separator === candidate.length - 1) return null;
    const launchpad = candidate.slice(0, separator) as EvmLaunchpad;
    const launchVariant = candidate.slice(separator + 1) as EvmLaunchVariant;
    if (evmLaunchOption(chain, launchpad, launchVariant) === null) return null;
    const key = evmLaunchIdentityKey(launchpad, launchVariant);
    if (seen.has(key)) return null;
    seen.add(key);
    selected.push(key);
  }
  return selected;
}

export function readEvmLaunchSelection(
  storage: Pick<Storage, 'getItem'> | null,
  chain: string,
): readonly EvmLaunchIdentityKey[] {
  const all = allEvmLaunchIdentityKeys(chain);
  if (storage === null) return all;
  let stored: string | null;
  try {
    stored = storage.getItem(`${STORAGE_PREFIX}${chain}`);
  } catch {
    return all;
  }
  const parsed = parseEvmLaunchSelection(chain, stored);
  return parsed ?? all;
}

export function writeEvmLaunchSelection(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  chain: string,
  selected: readonly EvmLaunchIdentityKey[],
): boolean {
  if (storage === null) return false;
  if (selected.length === 0) {
    // Clearing the key rather than storing `[]`: the empty selection is a
    // live UI state, not a stored one, and leaving the PREVIOUS subset behind
    // would resurrect it on the next load — a filter the user believes they
    // cleared, silently narrowing the board again.
    try {
      storage.removeItem(`${STORAGE_PREFIX}${chain}`);
      return true;
    } catch {
      return false;
    }
  }
  if (parseEvmLaunchSelection(chain, JSON.stringify(selected)) === null) return false;
  try {
    storage.setItem(`${STORAGE_PREFIX}${chain}`, JSON.stringify(selected));
    return true;
  } catch {
    return false;
  }
}
