/**
 * Block-explorer links for EVM transaction hashes.
 *
 * WHY THIS EXISTS AS A MAP RATHER THAN A WIRE FIELD. `the ingestion service` holds an
 * `explorer_base_url` per chain (the backend source, values at
 * `:530` and `:620`) but it is SERVER config and never crosses the wire — no
 * token card, order ack or stream frame carries it. So the terminal keeps its
 * own copy of the same two values.
 *
 * THE RULE THAT MATTERS: **an unknown chain gets NO link, never a guessed
 * one.** A fabricated explorer URL is worse than no link at all — it sends a
 * user who just spent real money to a 404, which reads as "my trade did not
 * happen". `explorerTxUrl` returns `null` and the caller renders the bare
 * hash, which is still everything the user needs to look the trade up
 * themselves.
 *
 * Deliberately separate from `components/conditionals/format.ts`'s
 * `explorerTxUrl` — that one is Solscan and takes a base58 signature. Sharing
 * a name across two chains' hash formats is how a BSC hash ends up appended
 * to a Solana explorer path.
 */

/**
 * Chain storage tag → explorer origin, mirroring the backend source.
 *
 * No trailing slash; `explorerTxUrl` adds the separator. Keyed by STORAGE TAG
 * (`robinhood_chain`), not by the URL slug (`robinhood`), because every EVM
 * money surface in this directory speaks storage tags and translating in one
 * more place is one more place to translate wrongly.
 */
/*
 * NULL-PROTOTYPE ON PURPOSE. With a plain object literal, `EXPLORER_BASE['constructor']`
 * resolves up the prototype chain to `Object` — a truthy value that is not
 * `undefined` — and the lookup below would happily build
 * `"function Object() { [native code] }/tx/0x…"` and render it as a link. The
 * chain tag reaching here is route-validated today, but this is the money
 * receipt on a live-money surface and it should not depend on that staying
 * true. Caught by `explorer.test.ts`'s prototype-key case.
 */
const EXPLORER_BASE: Readonly<Record<string, string>> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    bsc: 'https://bscscan.com',
    robinhood_chain: 'https://explorer.mainnet.chain.robinhood.com',
  },
);

/** A 0x-prefixed 32-byte transaction hash. */
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** A 0x-prefixed 20-byte account/contract address. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Explorer URL for a transaction, or `null` when we cannot build an honest one.
 *
 * Returns `null` for an unknown chain AND for a malformed hash. The hash check
 * is not redundant with the parser in `orderApi.ts`: this function is also
 * reachable from surfaces that read a hash out of a stream frame, and a link
 * built from a truncated hash is the failure described in the module header.
 */
export function explorerTxUrl(chain: string, txHash: string): string | null {
  const base = EXPLORER_BASE[chain];
  if (base === undefined) return null;
  if (!TX_HASH.test(txHash)) return null;
  return `${base}/tx/${txHash}`;
}

/**
 * Explorer URL for an ADDRESS (account or contract), or `null` when we cannot
 * build an honest one.
 *
 * Same rule as `explorerTxUrl`: an unknown chain and a malformed address both
 * get `null`, never a guessed link. The callers are the holder / top-trader /
 * contract rows, where a fabricated URL 404s under an address the user is
 * trying to verify.
 */
export function explorerAddressUrl(chain: string, address: string): string | null {
  const base = EXPLORER_BASE[chain];
  if (base === undefined) return null;
  if (!EVM_ADDRESS.test(address)) return null;
  return `${base}/address/${address}`;
}

/**
 * The explorer's human name, for link text. `null` when unknown — the caller
 * then says "transaction" rather than naming a site that may not exist.
 */
export function explorerName(chain: string): string | null {
  switch (chain) {
    case 'bsc':
      return 'BscScan';
    case 'robinhood_chain':
      return 'the Robinhood explorer';
    default:
      return null;
  }
}

/**
 * `0x1234…abcd` — a hash short enough to sit in a status line.
 *
 * Never truncates below the point where both ends are shown: a user compares
 * this against their wallet history, and a middle-elided hash with only a
 * prefix is not comparable.
 */
export function shortTxHash(txHash: string): string {
  if (!TX_HASH.test(txHash)) return txHash;
  return `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
}
