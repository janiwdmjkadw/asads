/**
 * Turn mints and `$TICKER`s in the agent's prose into links to /trade/[mint].
 *
 * The agent answers with addresses and tickers constantly ("SAVAGE did $5.66M
 * in 12h"), and every one of them is a place the user wants to go. Rather
 * than teach the model to emit markdown links — which it would do
 * inconsistently, and which would let a tool result inject arbitrary link
 * targets — the client links them itself, from data it already has.
 *
 * Two rules keep this safe:
 *
 *   1. A MINT is self-describing: base58, 32-44 chars. It links to itself,
 *      so the destination cannot be spoofed by anything the model wrote.
 *   2. A `$TICKER` is NOT self-describing — many coins share a symbol. It
 *      links ONLY when a tool result in this conversation resolved that
 *      symbol to exactly one mint. An ambiguous or unknown ticker stays
 *      plain text rather than guessing a destination.
 *
 * Code spans and fenced blocks are left alone (an address in a code block is
 * being shown as data), and existing markdown links are never re-wrapped.
 */

import { storageTagForSlug, tradePageHref } from '@/lib/evm/chains';

/** Solana base58, the same width every tool arg validates. */
const MINT_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
/** A 20-byte EVM contract address. */
const EVM_ADDRESS_RE = /\b0[xX][0-9a-fA-F]{40}\b/g;
/** `$SYMBOL` — letters, digits, underscore; 1-16 chars after the sigil. */
const TICKER_RE = /\$([A-Za-z][A-Za-z0-9_]{0,15})\b/g;

/**
 * Trade-page href for an address the agent mentioned.
 *
 * Delegates to the one builder in `lib/evm/chains.ts` so agent prose and every
 * other clickable surface cannot disagree about where a token lives. `chain`
 * absent means Solana, byte-identical to what this function always returned.
 */
export function tradeHref(mint: string, chain?: string | null): string {
  return tradePageHref(mint, chain);
}

const TRADE_HREF_PREFIX = '/trade/';
/** The whole href segment must BE a mint — no path, query or fragment. */
const MINT_ONLY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Mint out of a `tradeHref` — the inverse used by the mention chip to
 * find the token art for a link it is about to render. Deliberately
 * strict: only a bare `/trade/<base58>` resolves, so a model-written
 * link like `[look](/trade/x?ref=y)` never becomes a chip and never
 * feeds an arbitrary string into an image url.
 */
export function mintFromTradeHref(href: string): string | null {
  if (!href.startsWith(TRADE_HREF_PREFIX)) return null;
  const raw = href.slice(TRADE_HREF_PREFIX.length);
  let mint: string;
  try {
    mint = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return MINT_ONLY_RE.test(mint) ? mint : null;
}

/**
 * Split markdown into segments that may be linkified and segments that must
 * be preserved verbatim: fenced code blocks, inline code, and existing links
 * (both the label and the target).
 */
function protectedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const patterns = [
    /```[\s\S]*?(?:```|$)/g, // fenced block (unterminated while streaming)
    /`[^`\n]*`/g, // inline code
    /\[[^\]]*\]\([^)]*\)/g, // existing markdown link
    /<[^>]+>/g, // raw html/autolink
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function isProtected(ranges: readonly (readonly [number, number])[], start: number, end: number): boolean {
  return ranges.some(([lo, hi]) => start < hi && end > lo);
}

/**
 * Sentinel href for wallet links. Wallets have no page route — the platform
 * opens them in the wallet-profile modal (`openWalletProfile`) — so the
 * anchor carries this fragment and the markdown container's click delegate
 * intercepts it. A fragment href never navigates on its own, so even without
 * the delegate the worst case is a no-op, never a wrong destination.
 */
export const WALLET_HREF_PREFIX = '#wallet=';

export function walletHref(address: string): string {
  return `${WALLET_HREF_PREFIX}${encodeURIComponent(address)}`;
}

export function walletFromHref(href: string): string | null {
  if (!href.startsWith(WALLET_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(WALLET_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

export interface LinkifyOptions {
  /** symbol (upper-cased) -> mint, from tool results in this conversation. */
  readonly symbolToMint?: ReadonlyMap<string, string>;
  /** Addresses this conversation's tool results typed as WALLETS. */
  readonly walletIds?: ReadonlySet<string>;
  /** Addresses this conversation's tool results typed as MINTS. */
  readonly mintIds?: ReadonlySet<string>;
  /**
   * lowercased 0x address -> chain storage tag, from tool results in this
   * conversation.
   *
   * An EVM address is NOT self-describing the way a Solana mint is: the same
   * 20 bytes are a different token on BSC, Base and Robinhood Chain, and often
   * a token on none of them. So — exactly like a `$TICKER` — a bare 0x string
   * stays PLAIN TEXT unless something in this conversation resolved which
   * chain it is on. Guessing a chain here would produce a confident link to a
   * page about a different asset, which is worse than no link.
   */
  readonly chainByAddress?: ReadonlyMap<string, string>;
}

/**
 * An inline code span that IS one address, exactly: `` `5sxk…HWb` ``.
 * Models habitually backtick an address "for copyability", which renders
 * it as untouchable code — a dead box the owner clicked expecting the
 * wallet dossier (2026-08-24). The backticks come off and the address
 * joins the normal classify-and-link path. Anything more than the bare
 * address inside the span stays code, and fenced blocks are never read.
 */
const CODE_WRAPPED_ADDRESS_RE = /`([1-9A-HJ-NP-Za-km-z]{32,44}|0[xX][0-9a-fA-F]{40})`/g;

function unwrapCodeAddresses(text: string): string {
  if (!text.includes('`')) return text;
  const fences: Array<readonly [number, number]> = [];
  for (const m of text.matchAll(/```[\s\S]*?(?:```|$)/g)) {
    fences.push([m.index, m.index + m[0].length]);
  }
  let out = '';
  let cursor = 0;
  for (const m of text.matchAll(CODE_WRAPPED_ADDRESS_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (fences.some(([a, b]) => start < b && end > a)) continue;
    out += text.slice(cursor, start) + m[1];
    cursor = end;
  }
  return out + text.slice(cursor);
}

/**
 * Rewrite `text` so mints and known tickers become markdown links. Pure and
 * idempotent: already-linked text is protected, so re-running is a no-op.
 */
export function linkifyAgentText(rawText: string, options: LinkifyOptions = {}): string {
  if (rawText.length === 0) return rawText;
  const text = unwrapCodeAddresses(rawText);
  const ranges = protectedRanges(text);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (const m of text.matchAll(MINT_RE)) {
    if (m.index === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (isProtected(ranges, start, end)) continue;
    // A bare base58 string is ambiguous between a mint and a wallet — the
    // alphabet is identical. Tool results in this conversation disambiguate:
    // an address they typed as a wallet opens the wallet profile, one they
    // typed as a mint routes to /trade. Unclassified addresses keep the
    // historical /trade default (mints dominate agent prose).
    const isWallet =
      options.walletIds?.has(m[0]) === true && options.mintIds?.has(m[0]) !== true;
    const href = isWallet ? walletHref(m[0]) : tradeHref(m[0]);
    edits.push({ start, end, replacement: `[${m[0]}](${href})` });
  }

  const chainByAddress = options.chainByAddress;
  if (chainByAddress !== undefined && chainByAddress.size > 0) {
    for (const m of text.matchAll(EVM_ADDRESS_RE)) {
      if (m.index === undefined) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (isProtected(ranges, start, end)) continue;
      if (edits.some((e) => start < e.end && end > e.start)) continue;
      // Case-insensitive lookup: the agent may echo an EIP-55 checksummed
      // address while the tool result carried the lowercase canonical form.
      const chain = chainByAddress.get(m[0].toLowerCase());
      if (chain === undefined) continue; // unresolved chain -> plain text
      edits.push({
        start,
        end,
        replacement: `[${m[0]}](${tradeHref(m[0].toLowerCase(), chain)})`,
      });
    }
  }

  const symbolToMint = options.symbolToMint;
  if (symbolToMint !== undefined && symbolToMint.size > 0) {
    for (const m of text.matchAll(TICKER_RE)) {
      if (m.index === undefined) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (isProtected(ranges, start, end)) continue;
      // Overlap guard: a mint already claimed these characters.
      if (edits.some((e) => start < e.end && end > e.start)) continue;
      const mint = symbolToMint.get((m[1] ?? '').toUpperCase());
      if (mint === undefined) continue; // unknown or ambiguous -> plain text
      edits.push({ start, end, replacement: `[${m[0]}](${tradeHref(mint)})` });
    }
  }

  if (edits.length === 0) return text;
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    out += text.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + text.slice(cursor);
}

/** Tool-result keys whose string value is a WALLET address. */
const WALLET_KEYS = new Set([
  'wallet',
  'address',
  'trader',
  'creator',
  'funder',
  // get_token_safety's dev identity rides the bare key `dev` — unlisted, the
  // dev wallet fell to the /trade default and dressed as a token (owner,
  // 2026-08-24: "it think the dev address is a token address").
  'dev',
  'dev_wallet',
  'primary_wallet',
  'wallet_pubkey',
]);
/** Tool-result keys whose ARRAY entries are wallet addresses. */
const WALLET_LIST_KEYS = new Set([
  'wallet_sample',
  'sample_wallets',
  'wallets',
  // get_token_safety's classified cohorts.
  'snipers',
  'bundlers',
]);

/** Keys whose sibling `chain` makes their 0x value a TOKEN on that chain. */
const EVM_TOKEN_KEYS = new Set(['address', 'token', 'contract', 'token_address']);

export interface LinkEntities {
  /** symbol (upper-cased) -> mint, unambiguous in this conversation. */
  readonly symbolToMint: Map<string, string>;
  readonly mintIds: Set<string>;
  readonly walletIds: Set<string>;
  /** lowercased 0x token address -> chain storage tag, unambiguous in this
   *  conversation. An address claimed by two chains is DROPPED, for the same
   *  reason a symbol claimed by two mints is. */
  readonly chainByAddress: Map<string, string>;
}

/**
 * Build the link-entity context from tool results seen in this conversation:
 * which base58 ids are mints, which are wallets, and which symbols resolve
 * to exactly one mint.
 *
 * A symbol claimed by MORE THAN ONE mint is dropped, not arbitrated: two
 * coins called SAVAGE are exactly the case where guessing sends the user to
 * the wrong token, and a plain-text ticker is the honest outcome. An id
 * claimed as both mint and wallet resolves as a mint at link time.
 */
export function collectLinkEntities(parts: readonly unknown[]): LinkEntities {
  const seen = new Map<string, Set<string>>();
  const mintIds = new Set<string>();
  const walletIds = new Set<string>();
  const chainClaims = new Map<string, Set<string>>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    /* A 0x address only becomes linkable when the SAME record names a chain.
       That co-location is the evidence — an address from one tool result and a
       chain from another are not a pair, and pairing them is how a BSC link to
       a Base token gets minted. */
    const chainTag =
      typeof record.chain === 'string' ? evmStorageTag(record.chain) : null;
    if (chainTag !== null) {
      for (const key of EVM_TOKEN_KEYS) {
        const candidate = record[key];
        if (typeof candidate !== 'string') continue;
        if (!/^0[xX][0-9a-fA-F]{40}$/.test(candidate)) continue;
        const lower = candidate.toLowerCase();
        const claims = chainClaims.get(lower) ?? new Set<string>();
        claims.add(chainTag);
        chainClaims.set(lower, claims);
      }
    }
    const mint = record.mint;
    const symbol = record.symbol ?? record.ticker;
    if (typeof mint === 'string' && typeof symbol === 'string' && symbol.length > 0) {
      const key = symbol.toUpperCase();
      const set = seen.get(key) ?? new Set<string>();
      set.add(mint);
      seen.set(key, set);
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'mint' && typeof nested === 'string') mintIds.add(nested);
      else if (WALLET_KEYS.has(key) && typeof nested === 'string') walletIds.add(nested);
      else if (WALLET_LIST_KEYS.has(key) && Array.isArray(nested)) {
        for (const entry of nested) if (typeof entry === 'string') walletIds.add(entry);
      }
      walk(nested, depth + 1);
    }
  };
  for (const part of parts) walk(part, 0);

  const symbolToMint = new Map<string, string>();
  for (const [symbol, mints] of seen) {
    const only = [...mints];
    if (only.length === 1 && only[0] !== undefined) symbolToMint.set(symbol, only[0]);
  }
  const chainByAddress = new Map<string, string>();
  for (const [address, chains] of chainClaims) {
    const only = [...chains];
    if (only.length === 1 && only[0] !== undefined) chainByAddress.set(address, only[0]);
  }
  return { symbolToMint, mintIds, walletIds, chainByAddress };
}

/**
 * Storage tag for a chain string a tool result carried, or `null`.
 *
 * Accepts both vocabularies (`robinhood` and `robinhood_chain`) because tool
 * results are not consistent about which they emit, and rejects `solana`/`sol`
 * — a Solana token is matched by `MINT_RE`, not by the 0x branch, and letting
 * it through here would build `/trade/sol/<base58>` for something whose
 * canonical route is `/trade/<base58>`.
 */
function evmStorageTag(raw: string): string | null {
  const tag = storageTagForSlug(raw.trim().toLowerCase()) ?? raw.trim().toLowerCase();
  switch (tag) {
    case 'bsc':
    case 'base':
    case 'ethereum':
    case 'robinhood_chain':
      return tag;
    default:
      return null;
  }
}

/** Back-compat wrapper: the symbol map alone. */
export function collectSymbolMints(parts: readonly unknown[]): Map<string, string> {
  return collectLinkEntities(parts).symbolToMint;
}
