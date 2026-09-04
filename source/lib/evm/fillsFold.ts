/**
 * Folding the user's own fills into a position strip — BigInt only.
 *
 * The inputs are the rows `GET /api/v1/evm/trade/fills` already serves:
 * `tokenDeltaBaseUnits` and `nativeDeltaWei`, both SIGNED decimal strings
 * from our own execution ledger. Direction comes from each delta's own sign,
 * not from the `side` label — the ledger's sign convention is the money
 * fact, and a row whose label disagreed with its sign would otherwise be
 * folded twice-wrong silently.
 *
 * Doctrine:
 * - **A refusal is counted, never silent.** One unreadable token delta makes
 *   the whole token fold `unreadable` — a Bought/Sold/Holding strip missing
 *   one fill is a fabricated position, not a partial one. The native leg
 *   fails independently: its refusal withholds only the native figure.
 * - **A window is not a history.** The endpoint serves the newest N fills
 *   with no pagination, so when the page is full the older fills may exist
 *   and `holding` (a lifetime net) is not computable from it. The CALLER
 *   knows the request limit and owns that gate; this fold only sums what it
 *   was given.
 */

import { parseWireSigned } from './money';

export interface FillsTokenTotals {
  /** Token base units received across buys (positive deltas). */
  boughtBaseUnits: bigint;
  /** Token base units sent across sells (negative deltas, as a magnitude). */
  soldBaseUnits: bigint;
  /** `bought - sold` over the folded fills. Signed. */
  netBaseUnits: bigint;
}

export type FillsTokenFold =
  | { kind: 'ok'; totals: FillsTokenTotals }
  | { kind: 'unreadable' };

/** Sum of `nativeDeltaWei`, signed — or an explicit refusal. */
export type FillsNativeFold = { kind: 'ok'; netWei: bigint } | { kind: 'unreadable' };

export interface FillsFold {
  token: FillsTokenFold;
  native: FillsNativeFold;
  fillCount: number;
}

export function foldFills(
  fills: ReadonlyArray<{ tokenDeltaBaseUnits: string; nativeDeltaWei: string }>,
): FillsFold {
  let bought = 0n;
  let sold = 0n;
  let tokenUnreadable = false;
  let netWei = 0n;
  let nativeUnreadable = false;
  for (const fill of fills) {
    const tokens = parseWireSigned(fill.tokenDeltaBaseUnits);
    if (tokens === null) {
      tokenUnreadable = true;
    } else if (tokens >= 0n) {
      bought += tokens;
    } else {
      sold += -tokens;
    }
    const native = parseWireSigned(fill.nativeDeltaWei);
    if (native === null) {
      nativeUnreadable = true;
    } else {
      netWei += native;
    }
  }
  return {
    token: tokenUnreadable
      ? { kind: 'unreadable' }
      : {
          kind: 'ok',
          totals: {
            boughtBaseUnits: bought,
            soldBaseUnits: sold,
            netBaseUnits: bought - sold,
          },
        },
    native: nativeUnreadable ? { kind: 'unreadable' } : { kind: 'ok', netWei },
    fillCount: fills.length,
  };
}
