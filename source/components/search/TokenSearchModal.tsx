'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { cva } from 'class-variance-authority';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Copy, Search } from '@/components/listen/icons/Icons';
import { navigateToToken, navigateToTerminalHref } from '@/components/listen/navigation';
import { tradePageHref } from '@/lib/evm/chains';
import {
  evmLiveUnavailableText,
  evmSearchChainLabel,
  evmSearchLabel,
  evmSearchUrl,
  parseEvmSearchResponse,
  type EvmSearchItem,
} from '@/lib/evm/searchApi';
import { MetaRow, type MetaRowCoin } from '@/components/discover/CardMetaRows';
import { normalizeSocialUrl, normalizeWebsiteUrl } from '@/components/trade/snapshotAdapter';
import {
  BondingBorder,
  PumpBadge,
  bondingProgressBucket,
  bondingProgressFromReserves,
} from '@/components/discover/bonding';
import type { CoinMode } from '@/components/discover/mockCoins';
import { ingestionApiUrl, ingestionTokenImageUrl } from '@/lib/api/ingestion';
import {
  fetchSearchTimed,
  markSearchDebounceFired,
  markSearchKeystroke,
  markSearchRenderCommit,
} from '@/components/search/searchTiming';
import {
  pauseFeedForModal,
  resumeFeedAfterModal,
} from '@/components/discover/feedNavigationPause';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import { warmMints } from '@/lib/api/warm-mints';
import { compactAge, compactUsd } from '@/lib/format';
import { queryKeys } from '@/lib/query/keys';
import { TOKEN_IMAGE_PLACEHOLDER } from '@/lib/token-image';
import './token-search-rows.css';

/** Search response card — the `/search` endpoint reuses the discover wire
 *  shape (camelCase `DiscoverCard`), so only the fields the rows render are
 *  typed here. */
interface SearchCard {
  mint: string;
  name: string;
  symbol: string;
  ageMs: number;
  createdAtMs: number;
  imageUrl?: string | null;
  imageThumbUrl?: string | null;
  imageCdnUrl?: string | null;
  imageSourceUrl?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  website?: string | null;
  txns: number;
  volumeUsd: number;
  marketCapUsd?: number | null;
  /** String-encoded curve reserve — drives the bonding-progress border. */
  realTokenBaseUnits?: string | null;
  graduated?: boolean;
  quoteMint?: string | null;
  isMayhem?: boolean;
  isCashback?: boolean;
  agentMode?: boolean;
}

/** Per-mint search extras served alongside `items` (1h volume, curve
 *  liquidity, ATH market cap, all-time fees paid) — the server's `stats`
 *  side map. */
interface SearchTokenStats {
  vol1hUsd?: number;
  liquidityUsd?: number;
  athMarketCapUsd?: number;
  feesPaidUsd?: number;
}

interface SearchEnvelope {
  items: SearchCard[];
  stats?: Record<string, SearchTokenStats>;
}

/** Server-side orderings. `relevance` = default ranking (omitted on the
 *  wire); the rest map to `/search?sort=…`. */
type SearchSortId = 'relevance' | 'mc' | 'vol1h' | 'og';

/** Near-zero: with the in-memory index + per-mint/edge caches the backend
 *  tolerates per-keystroke requests, in-flight fetches are aborted on the
 *  next keystroke, and beacons showed the 50ms timer really costing
 *  50-200ms (busy main thread fires it late). Just enough to coalesce
 *  same-frame input events (e.g. paste + autocomplete). */
const SEARCH_DEBOUNCE_MS = 15;
const MIN_QUERY_CHARS = 1;
const RESULT_LIMIT = 20;
const WARM_TOP_RESULTS = 10;
/** Token image edge (px) — the row height driver. */
const ROW_IMAGE_PX = 56;
/** Syntactically-plausible Solana mint (base58, 32-44 chars). */
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A 20-byte EVM address. Case-insensitive: EIP-55 checksum casing is a
 *  display vocabulary, and the read API keys tokens on lowercase hex. */
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Chains the terminal serves EVM trade pages for. A 0x address exists on
 *  EVERY EVM chain, so pasting one cannot be resolved to a single token —
 *  the search offers one row per served chain rather than guessing, which
 *  would open the wrong token under the right address (plan §4.5). */
const EVM_SEARCH_CHAINS = [
  { tag: 'bsc', label: 'BSC' },
  { tag: 'robinhood_chain', label: 'Robinhood' },
] as const;

export function TokenSearchModal({
  open,
  onOpenChange,
  initialQuery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill (e.g. "Search for TICKER" from a card popover); searches immediately. */
  initialQuery?: string;
}) {
  const evmEnabled = useEvmEnabled();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  // Sort/filter toggles persist across opens within the session — a trader
  // who works in OG mode shouldn't re-toggle it on every search.
  const [sort, setSort] = useState<SearchSortId>('relevance');
  const [graduatedOnly, setGraduatedOnly] = useState(false);
  /*
   * The launchpad filter. One at a time rather than a set: a token comes
   * from exactly one launchpad, so "Pump AND Bonk" is every token, which
   * is what no filter already means.
   */
  const [source, setSource] = useState<'pump' | 'bonk' | null>(null);
  const [dexPaidOnly, setDexPaidOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      markSearchDebounceFired();
      setDebounced(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmed = debounced.trim();
  const enabled = open && trimmed.length >= MIN_QUERY_CHARS;
  const { data, isFetching } = useQuery({
    /* The key has to carry every filter, or switching one serves the
       previous one's cached results. */
    queryKey: [...queryKeys.token.search(trimmed, sort, graduatedOnly), source, dexPaidOnly],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: trimmed, limit: String(RESULT_LIMIT) });
      if (sort !== 'relevance') params.set('sort', sort);
      if (graduatedOnly) params.set('graduated', 'true');
      if (source) params.set('source', source);
      if (dexPaidOnly) params.set('dexPaid', 'true');
      return fetchSearchTimed<SearchEnvelope>(
        ingestionApiUrl(`/api/search?${params.toString()}`),
        trimmed,
        signal,
      );
    },
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => (enabled ? (data?.items ?? []) : []), [enabled, data]);
  const stats = data?.stats;

  /* THE EVM INDEX, asked in parallel with the Solana one.
     Two queries rather than one merged endpoint because they are two indexes
     with two failure modes: the Solana `/api/search` is the live ingestion
     catalog, `/api/v1/evm/search` is a the database catalog joined against each
     chain's discover lane. Merging them server-side would make one's outage
     the other's outage, and this modal is the primary way into a token. A
     failed EVM search therefore yields no EVM rows and leaves the Solana
     results untouched. */
  const { data: evmData, isFetching: evmIsFetching, isError: evmIsError } = useQuery({
    queryKey: ['evm', 'search', trimmed],
    queryFn: async ({ signal }) => {
      const res = await fetch(evmSearchUrl(trimmed, RESULT_LIMIT), {
        signal,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`evm_search_http_${res.status}`);
      const parsed = parseEvmSearchResponse(await res.json().catch(() => null));
      if (parsed === null) throw new Error('evm_search_shape_mismatch');
      return parsed;
    },
    /* `evm-client-surface` off ⇒ the EVM index is never queried at all. The
       derived values below re-check the flag rather than relying on that,
       because react-query serves a CACHED result for this key even when the
       query is disabled — a session that had the flag on would otherwise keep
       painting EVM rows after it was turned off. */
    enabled: enabled && evmEnabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const evmItems = useMemo(
    () => (enabled && evmEnabled ? (evmData?.items ?? []) : []),
    [enabled, evmEnabled, evmData],
  );
  const searchPending = isFetching || evmIsFetching;
  const evmIncomplete =
    evmEnabled && (evmData?.partial === true || evmData?.truncated === true);

  // Log data→painted per result set (commit-time mark; see searchTiming).
  useEffect(() => {
    if (items.length > 0) markSearchRenderCommit(trimmed);
  }, [items, trimmed]);

  // Pasted/typed contract address with no catalog hit: synthesize a direct
  // "open" row — the trade page's identity-hydration + genesis-backfill flow
  // takes over for fully unknown mints. Uses the LIVE query (not the
  // debounced one) so a paste navigates without waiting out the debounce.
  const liveTrimmed = query.trim();
  const directMint =
    MINT_RE.test(liveTrimmed) && !items.some((item) => item.mint === liveTrimmed)
      ? liveTrimmed
      : null;

  // A pasted 0x address is a token on an EVM chain, and the Solana `/search`
  // index will never contain it — before this, typing one produced an empty
  // modal with no explanation. It cannot be resolved to ONE token (the same
  // address exists on every EVM chain), so every served chain gets a row.
  // Flag off ⇒ no synthesized "Open on BSC/Robinhood" rows either. A pasted 0x
  // address then falls through to the same nothing-found modal it produced
  // before the EVM surface existed.
  const evmAddress =
    evmEnabled && EVM_ADDRESS_RE.test(liveTrimmed) ? liveTrimmed.toLowerCase() : null;

  type Row =
    | { kind: 'direct'; mint: string }
    | { kind: 'evm'; chain: string; label: string; address: string }
    | { kind: 'evm-card'; item: EvmSearchItem }
    | { kind: 'card'; card: SearchCard };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (directMint) out.push({ kind: 'direct', mint: directMint });
    /* A RESOLVED row beats a synthesized one. When the EVM index actually
       knows this address on a chain it returns a row carrying the token's name
       and symbol; the synthesized "Open on BSC" row exists only for the case
       where nothing knows it — real for a token created seconds ago, and it
       must stay reachable. Emitting both shows one token twice under two
       different labels. */
    const resolved = new Set(evmItems.map((item) => item.id));
    for (const item of evmItems) out.push({ kind: 'evm-card', item });
    if (evmAddress !== null) {
      for (const { tag, label } of EVM_SEARCH_CHAINS) {
        if (resolved.has(tag + ':' + evmAddress)) continue;
        out.push({ kind: 'evm', chain: tag, label, address: evmAddress });
      }
    }
    for (const card of items) out.push({ kind: 'card', card });
    return out;
  }, [directMint, evmAddress, evmItems, items]);

  // Prewarm the top results server-side so a click lands on a warm snapshot.
  useEffect(() => {
    if (items.length > 0) {
      warmMints(items.slice(0, WARM_TOP_RESULTS).map((item) => item.mint));
    }
  }, [items]);

  // While the modal covers the board, pause discover's SSE frame
  // application — perf beacons measured it blocking the main thread
  // 66-234ms per delta, starving the keystroke→results path. Lossless:
  // frames are stashed and the latest applies on close (see
  // feedNavigationPause). No-op on pages without live feeds.
  useEffect(() => {
    if (!open) return;
    pauseFeedForModal();
    return () => resumeFeedAfterModal();
  }, [open]);

  // Reset per open / per result set (sort + graduated deliberately persist).
  useEffect(() => {
    if (open) {
      // Prefill lands in BOTH query + debounced so results fetch without
      // waiting out the debounce window.
      const prefill = initialQuery ?? '';
      setQuery(prefill);
      setDebounced(prefill);
      setActiveIndex(0);
      // Radix focuses the content wrapper after mount; queue the input focus behind it.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only per open
  }, [open]);
  useEffect(() => setActiveIndex(0), [rows.length, trimmed]);

  function openRow(row: Row | undefined): void {
    if (!row) return;
    if (row.kind === 'direct') {
      navigateToToken(row.mint);
    } else if (row.kind === 'evm') {
      // NOT `navigateToToken`: that path writes Solana token-hint memory and
      // prewarms a mint, and this is a 0x address on another chain. The
      // trade route validates the slug and the address shape itself.
      //
      // THE ONE HREF BUILDER, not a hand-assembled twin of it. The bytes are
      // identical today (`row.chain` is a storage tag, `row.address` is a
      // lowercased 0x hex string that `encodeURIComponent` leaves alone) —
      // and a second builder that agrees today is exactly what
      // `lib/evm/chains.ts` exists to prevent, because the resolved row
      // beside this one (`evm-card`) already goes through `tradePageHref`
      // and only one of the two would follow it if the shape ever moved.
      navigateToTerminalHref(tradePageHref(row.address, row.chain));
    } else if (row.kind === 'evm-card') {
      // The href was built by the one chain-aware builder at parse time, so
      // this cannot drift from what the card and the position strip emit.
      navigateToTerminalHref(row.item.href);
    } else {
      const { card } = row;
      navigateToToken(card.mint, {
        name: card.name,
        symbol: card.symbol,
        imageUrl: rowImage(card),
        twitterUrl: card.twitter ?? null,
        telegramUrl: card.telegram ?? null,
        websiteUrl: card.website ?? null,
        quoteMint: card.quoteMint ?? null,
        sourceSection: null,
      });
    }
    onOpenChange(false);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openRow(rows[activeIndex]);
    }
  }

  // Keep the active row scrolled into view during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  /** One sort owns the results at a time; clicking the active toggle
   *  returns to relevance ranking. */
  function toggleSort(id: Exclude<SearchSortId, 'relevance'>): void {
    setSort((current) => (current === id ? 'relevance' : id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="token-search-modal w-[calc(100vw-2rem)] max-w-3xl gap-0 overflow-hidden rounded-2xl p-0"
        onKeyDown={onKeyDown}
      >
        <TooltipProvider delayDuration={150} skipDelayDuration={300}>
          <DialogTitle className="sr-only">Search tokens</DialogTitle>

          {/*
            * THE FIELD IS FIRST.
            *
            * It used to be second, under a strip of five filter chips,
            * so the overlay handed you five ways to narrow a list before
            * it handed you the box you opened it to type into. The thing
            * being asked for goes at the top.
            */}
          <div className="tsm-field">
            <Search style={{ width: 17, height: 17, flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                markSearchKeystroke();
                setQuery(event.target.value);
              }}
              placeholder="Search tokens, tickers, contracts"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent font-sans leading-none outline-none focus:outline-none"
              data-testid="token-search-input"
            />
            {searchPending ? <span className="tsm-pending">Searching</span> : null}
            <span className="tsm-esc">Esc</span>
          </div>

          {/*
            * ONE CONTROL ROW.
            *
            * Narrowing the list and ordering it are the same job, and
            * they were on two separate bands with a shouted RESULTS and
            * SORT BY between them, which cost 41px of a panel whose
            * subject is the rows underneath.
            *
            * Left: where a token came from, then what state it is in.
            * Pump and Bonk are mutually exclusive, since a token has one
            * launchpad and picking both would mean every token, which is
            * what picking neither already means.
            *
            * Right: the order. It used to be three unlabelled glyphs, a
            * trophy and two charts, which is a legend a person has to
            * learn to use a search box. They are the three words.
            */}
          <div className="tsm-bar">
            <ToggleChip
              shape="pill"
              label="Pump"
              title="Tokens launched on Pump"
              active={source === 'pump'}
              onToggle={() => setSource((v) => (v === 'pump' ? null : 'pump'))}
            />
            <ToggleChip
              shape="pill"
              label="Bonk"
              title="Tokens launched on Bonk"
              active={source === 'bonk'}
              onToggle={() => setSource((v) => (v === 'bonk' ? null : 'bonk'))}
            />
            <span aria-hidden className="tsm-div" />
            <ToggleChip
              shape="pill"
              label="Graduated"
              active={graduatedOnly}
              onToggle={() => setGraduatedOnly((value) => !value)}
            />
            <ToggleChip
              shape="pill"
              label="Dex Paid"
              title="Listing paid for on a DEX"
              active={dexPaidOnly}
              onToggle={() => setDexPaidOnly((value) => !value)}
            />
            <ToggleChip
              shape="pill"
              label="OG Mode"
              title="Oldest first"
              active={sort === 'og'}
              onToggle={() => toggleSort('og')}
            />

            <div className="tsm-sort" role="group" aria-label="Sort results">
              {/* Relevance is the resting state, not a toggle: the others
                  return to it when clicked while active, so this one sets
                  it directly. */}
              <SortWord label="Top" active={sort === 'relevance'} onToggle={() => setSort('relevance')} />
              <SortWord label="Cap" title="Market cap" active={sort === 'mc'} onToggle={() => toggleSort('mc')} />
              <SortWord label="Volume" title="1h volume" active={sort === 'vol1h'} onToggle={() => toggleSort('vol1h')} />
            </div>
          </div>

          {/* FIXED height (not max-height): the modal keeps its full size
              with zero results too, so it never jumps around mid-typing. */}
          <div
            ref={listRef}
            className="h-[440px] divide-y divide-[var(--hairline)] overflow-y-auto"
          >
            {enabled && evmEnabled && (evmIsError || evmIncomplete) ? (
              <div className="border-b border-[var(--hairline)] px-4 py-2 text-[11px] text-amber-500" role="status">
                {evmIsError
                  ? 'EVM search is unavailable; Solana results remain available.'
                  : evmData?.truncated
                    ? 'EVM results are truncated. Refine your search for a complete match.'
                    : 'Some EVM chains could not be searched; results are partial.'}
              </div>
            ) : null}
            {rows.length === 0 ? (
              <div
                className="flex h-full items-center justify-center px-4 text-[13px]"
                style={{ color: 'var(--ink-3)' }}
              >
                {trimmed.length < MIN_QUERY_CHARS
                  ? 'Search by name, ticker, or contract address'
                  : searchPending
                    ? 'Searching…'
                    : 'No tokens found'}
              </div>
            ) : (
              rows.map((row, index) => (
                <SearchRow
                  key={
                    row.kind === 'direct'
                      ? `direct:${row.mint}`
                      : row.kind === 'evm'
                        ? `evm:${row.chain}:${row.address}`
                        : row.kind === 'evm-card'
                          ? `evm-card:${row.item.id}`
                          : row.card.mint
                  }
                  row={row}
                  stats={row.kind === 'card' ? stats?.[row.card.mint] : undefined}
                  index={index}
                  active={index === activeIndex}
                  onHover={() => setActiveIndex(index)}
                  onSelect={() => openRow(row)}
                />
              ))
            )}
          </div>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ---- toggle chips (filter pills + sort squares) ---------------------- */

const toggleChipVariants = cva('text-[11px] font-medium transition-colors', {
  variants: {
    shape: {
      pill: 'rounded-full px-3 py-1',
      square: 'rounded px-2 py-0.5',
    },
  },
});

/**
 * ONE SORT, AS THE WORD FOR IT.
 *
 * It was a trophy and two charts at 15px, which asks a person to learn
 * three glyphs before they can order a list of five results. Three words
 * in a track say the same thing and can be read the first time.
 */
function SortWord({
  label,
  title,
  active,
  onToggle,
}: {
  label: string;
  title?: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title ?? `Sort by ${label}`}
      aria-label={`Sort by ${title ?? label}`}
      aria-pressed={active}
      data-on={active ? 'true' : 'false'}
      className="tsm-sortbtn"
    >
      {label}
    </button>
  );
}

/** Toggleable chip. Active state reads the theme accent; colors stay CSS
 *  vars (theme cascade), only the shape varies via cva. */
function ToggleChip({
  shape,
  label,
  active,
  onToggle,
  title,
}: {
  shape: 'pill' | 'square';
  label: string;
  active: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-pressed={active}
      className={toggleChipVariants({ shape })}
      /*
       * SELECTED IS A FILL, NOT A COLOUR.
       *
       * It used to take `--accent-primary` for the label AND the border
       * on top of a tinted background — three signals for one bit of
       * state, in the one colour the rest of this panel never uses. In a
       * row of six chips that made the selected one the loudest thing on
       * a screen whose subject is the results underneath it.
       *
       * A solid white plate with black type says the same thing with one
       * signal, and it is the same language the nav uses for the page you
       * are on.
       */
      style={{
        color: active ? '#ffffff' : 'var(--ink-2)',
        background: active ? 'var(--ink-0)' : 'transparent',
        border: `1px solid ${active ? 'var(--ink-0)' : 'var(--hairline-2)'}`,
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

/* ---- row helpers ----------------------------------------------------- */

function rowImage(card: SearchCard): string | null {
  return (
    card.imageThumbUrl ??
    card.imageCdnUrl ??
    card.imageUrl ??
    card.imageSourceUrl ??
    ingestionTokenImageUrl(card.mint)
  );
}

/** Map a search card onto the discover `MetaRow` shape — same icon
 *  vocabulary as the discover section rows (age, X, pump.fun, USDC pair,
 *  secondary link, mode badge). */
function metaRowCoin(card: SearchCard): MetaRowCoin {
  const mode: CoinMode | undefined = card.isMayhem
    ? 'mayhem'
    : card.agentMode
      ? 'agent'
      : card.isCashback
        ? 'cashback'
        : undefined;
  // Imported catalog rows without a witnessed CREATE carry created_at_ms=0,
  // which would read as a ~56y age. Treat those as unknown.
  const ageKnown = card.createdAtMs > 0 && card.ageMs > 0;
  return {
    id: card.mint,
    ticker: card.symbol,
    ageLabel: ageKnown ? compactAge(card.ageMs) : '—',
    txns: card.txns,
    score: 0,
    // Normalized like every other feed into MetaRow (see
    // useLiveNewPairs.linksFor). These come from on-chain metadata an
    // anonymous deployer writes; passing them through raw put a
    // `javascript:` URL one click away from executing in this origin.
    links: {
      twitter: normalizeSocialUrl(card.twitter, 'twitter'),
      telegram: normalizeSocialUrl(card.telegram, 'telegram'),
      website: normalizeWebsiteUrl(card.website),
    },
    mode,
    quoteMint: card.quoteMint ?? null,
  };
}

/** Token image framed by the same bonding-progress border + pump badge the
 *  discover cards use (green partial ring while bonding, gold once
 *  graduated) — replaces a textual GRAD badge. */
function TokenImageFrame({ card }: { card: SearchCard }) {
  const image = rowImage(card);
  const graduated = card.graduated === true;
  const progressPct = graduated ? 100 : bondingProgressFromReserves(card.realTokenBaseUnits);
  return (
    <div className="relative shrink-0" style={{ width: ROW_IMAGE_PX, height: ROW_IMAGE_PX }}>
      <img
        src={image ?? TOKEN_IMAGE_PLACEHOLDER}
        alt=""
        loading="lazy"
        className="h-full w-full rounded-xl object-cover"
        style={{ background: 'var(--chip-bg)' }}
        onError={(event) => {
          const img = event.currentTarget;
          if (img.src !== TOKEN_IMAGE_PLACEHOLDER) img.src = TOKEN_IMAGE_PLACEHOLDER;
        }}
      />
      <BondingBorder bucket={bondingProgressBucket(progressPct)} graduated={graduated} />
      <PumpBadge graduated={graduated} />
    </div>
  );
}

/** One spread stat column (Axiom-style): muted label beside a mono value,
 *  optional smaller sub-stat beneath (ATH under MC). Fixed width so the
 *  MC/V/L columns align vertically across rows. */
function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: { label: string; value: string };
}) {
  return (
    /*
     * NO MONOSPACE ON MONEY. The mono face draws a slashed zero, so
     * `$19.8K` read as a diagnostic rather than a market cap. The sans at
     * `tabular-nums` lines the columns up just as well.
     */
    <span className="tsm-stat flex w-24 flex-col justify-center gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span className="tsm-stat-k shrink-0 text-[11px]">{label}</span>
        <span className="tsm-stat-v text-[14px] font-semibold tabular-nums">{value}</span>
      </span>
      {sub ? (
        <span className="flex items-baseline gap-1">
          <span className="tsm-stat-k shrink-0 text-[10px]">{sub.label}</span>
          <span className="tsm-stat-sub text-[11px] tabular-nums">{sub.value}</span>
        </span>
      ) : null}
    </span>
  );
}

/** Copy-CA affordance on each row (Axiom-style copy glyph next to the
 *  name). Plain span with a click handler — the row itself is the
 *  navigation surface, so propagation stops here. */
function CopyMintButton({ mint }: { mint: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label="Copy contract address"
      className="inline-flex shrink-0 cursor-pointer items-center"
      style={{ color: copied ? 'var(--accent-primary)' : 'var(--ink-3)' }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(mint).catch(() => undefined);
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1_200);
      }}
    >
      <Copy style={{ width: 12, height: 12 }} />
    </span>
  );
}

function SearchRow({
  row,
  stats,
  index,
  active,
  onHover,
  onSelect,
}: {
  row:
    | { kind: 'direct'; mint: string }
    | { kind: 'evm'; chain: string; label: string; address: string }
    | { kind: 'evm-card'; item: EvmSearchItem }
    | { kind: 'card'; card: SearchCard };
  stats: SearchTokenStats | undefined;
  index: number;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  /*
   * The keyboard/hover row. `--input-bg` is a themed token that carries a
   * tint, which put a coloured wash across a full width row every time
   * the selection moved — the most movement on the panel, in the one
   * colour it otherwise avoids. A flat white at 6% marks the row without
   * changing what the row is.
   */
  /* The plate is the sheet's, because an inline background beats every
     selector and a 6% white wash is nothing on this ground. `data-active`
     is the hook. */
  const baseStyle = { background: 'transparent' } as const;

  // Rows are `div[role=button]` rather than `<button>`: they nest the
  // MetaRow's link buttons and the copy-CA glyph, and interactive elements
  // can't legally nest inside a native button. Keyboard activation stays at
  // the modal level (ArrowUp/Down + Enter on the input).
  if (row.kind === 'direct') {
    return (
      <div
        role="button"
        tabIndex={-1}
        data-active={active ? 'true' : 'false'}
        data-row-index={index}
        onPointerEnter={onHover}
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors"
        style={baseStyle}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--hairline)]"
          style={{ width: ROW_IMAGE_PX, height: ROW_IMAGE_PX, background: 'var(--chip-bg)' }}
        >
          <Search style={{ width: 18, height: 18, color: 'var(--ink-3)' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[15px] font-medium"
            style={{ color: 'var(--ink-0)' }}
          >
            Open contract address
          </span>
          <span
            className="block truncate text-[11px]"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
          >
            {row.mint}
          </span>
        </span>
      </div>
    );
  }

  if (row.kind === 'evm-card') {
    const { item } = row;
    /* `live: false` is NOT an error and NOT an empty result — it is a catalog
       hit the live indexer does not currently hold. The row stays clickable
       (the trade page does its own read) and the reason is disclosed, because
       "we know this token but not its current state" and "this token does not
       exist" are opposite things to tell someone about to trade. */
    const liveNote = evmLiveUnavailableText(item.liveUnavailableReason);
    return (
      <div
        role="button"
        tabIndex={-1}
        data-active={active ? 'true' : 'false'}
        data-row-index={index}
        data-testid="token-search-evm-card"
        onPointerEnter={onHover}
        onClick={onSelect}
        title={liveNote ?? undefined}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors"
        style={baseStyle}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--hairline)] text-[11px] font-bold"
          style={{
            width: ROW_IMAGE_PX,
            height: ROW_IMAGE_PX,
            background: 'var(--chip-bg)',
            color: 'var(--ink-2)',
            fontFamily: 'var(--mono)',
          }}
        >
          {evmSearchChainLabel(item.chain).slice(0, 3)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className="truncate text-[15px] font-medium"
              style={{ color: 'var(--ink-0)' }}
            >
              {evmSearchLabel(item)}
            </span>
            <span
              className="shrink-0 rounded-[3px] px-1 text-[9px] font-bold uppercase"
              style={{
                color: 'var(--ink-2)',
                background: 'var(--chip-bg)',
                border: '1px solid var(--hairline)',
                letterSpacing: '0.1em',
              }}
            >
              {evmSearchChainLabel(item.chain)}
            </span>
          </span>
          <span
            className="block truncate text-[11px]"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
          >
            {item.name ?? item.address}
          </span>
          {liveNote !== null ? (
            <span className="block truncate text-[10px]" style={{ color: 'var(--ink-3)' }}>
              {liveNote}
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  if (row.kind === 'evm') {
    return (
      <div
        role="button"
        tabIndex={-1}
        data-active={active ? 'true' : 'false'}
        data-row-index={index}
        data-testid="token-search-evm-result"
        onPointerEnter={onHover}
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors"
        style={baseStyle}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--hairline)] text-[11px] font-bold"
          style={{
            width: ROW_IMAGE_PX,
            height: ROW_IMAGE_PX,
            background: 'var(--chip-bg)',
            color: 'var(--ink-2)',
            fontFamily: 'var(--mono)',
          }}
        >
          {row.label.slice(0, 3).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[15px] font-medium"
            style={{ color: 'var(--ink-0)' }}
          >
            Open on {row.label}
          </span>
          <span
            className="block truncate text-[11px]"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
          >
            {row.address}
          </span>
        </span>
      </div>
    );
  }

  const { card } = row;
  return (
    <div
      role="button"
      tabIndex={-1}
      data-active={active ? 'true' : 'false'}
      data-row-index={index}
      data-testid="token-search-result"
      onPointerEnter={onHover}
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors"
      style={baseStyle}
    >
      <TokenImageFrame card={card} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Ticker-first identity line (Axiom convention): TICKER bold,
            name muted, copy-CA glyph. Graduation reads from the image
            frame (gold border + badge), not a text chip. */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 text-[15px] font-bold uppercase leading-none"
            style={{ color: 'var(--ink-0)' }}
          >
            {card.symbol || shortMint(card.mint)}
          </span>
          <span
            className="min-w-0 truncate text-[13px] leading-none"
            style={{ color: 'var(--ink-2)' }}
          >
            {card.name}
          </span>
          <CopyMintButton mint={card.mint} />
        </span>
        {/* Same meta icons as the discover rectangle rows. */}
        <MetaRow coin={metaRowCoin(card)} size="sm" />
      </span>
      <span className="flex shrink-0 items-center gap-4">
        <StatBlock
          label="MC"
          value={compactUsd(card.marketCapUsd, '—')}
          sub={{ label: 'ATH', value: compactUsd(athUsd(card, stats), '—') }}
        />
        {/* V, F and L were a legend the row never printed. Three short
            words cost about twelve pixels and need no legend. */}
        <StatBlock
          label="Vol"
          value={statUsd(stats?.vol1hUsd)}
          sub={{ label: 'Fees', value: statUsd(stats?.feesPaidUsd) }}
        />
        <StatBlock label="Liq" value={statUsd(stats?.liquidityUsd)} />
      </span>
    </div>
  );
}

function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/** Hydrated-but-zero renders "$0" (a fact: no recent volume / no fees /
 *  drained curve); "—" is reserved for genuinely missing data (stats
 *  query failed or timed out). `compactUsd` alone can't tell the two
 *  apart — it maps 0 to the fallback. */
function statUsd(value: number | undefined): string {
  return value != null ? compactUsd(value, '$0') : '—';
}

/** Displayed ATH: never below live MC (the rollup lags the current tick
 *  by at most a candle), and tokens the analytics store has no candle history for
 *  fall back to live MC instead of a hole. */
function athUsd(card: SearchCard, stats: SearchTokenStats | undefined): number | undefined {
  const rollup = stats?.athMarketCapUsd ?? 0;
  const live = card.marketCapUsd ?? 0;
  const best = Math.max(rollup, live);
  return best > 0 ? best : undefined;
}
