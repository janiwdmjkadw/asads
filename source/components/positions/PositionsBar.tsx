'use client';

import { Fragment } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { navigateToToken, prefetchToken } from '@/components/listen/navigation';
import { prewarmMints } from '@/lib/api/prewarm';
import { getClerkSession } from '@/lib/state/clerk-session-store';
import { useResolvedTokenImage } from '@/lib/token-image';
import { formatPct, formatUsd, truncateMint } from '@/components/portfolio/spot/format';
import { usePositionStrip, type PositionItem } from './usePositionStrip';
import { useSellAllPosition } from './useSellAllPosition';
import { useEvmPositions, type EvmPositionsSnapshot } from './useEvmPositions';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import { evmAmountText, type EvmPositionRow } from './evmPositionView';

/**
 * Live open-position strip for the active wallet, rendered in the top
 * sub-header. Each position is two separate hit targets: the coin (image +
 * ticker + amount + PnL%) opens its Trade page, and a small sell-all button
 * markets out 100% of the holding. A hairline separates positions (no pill).
 * Renders nothing when there are no positions.
 *
 * EVM POSITIONS SIT IN THEIR OWN SEGMENT after a double rule, and they are a
 * DIFFERENT COMPONENT reading a DIFFERENT type. That is not fastidiousness:
 * `PositionItem` carries lamports and a USD value, `EvmPositionRow` carries
 * wei and no USD at all, the two differ by ~1e9 and by chain, and one array
 * holding both is one `.reduce` away from a total that is silently wrong.
 * Keeping them un-unifiable in the type system is what makes the "never summed
 * into a Solana total" rule hold under future edits rather than under
 * discipline.
 */
/** What the strip reads while `evm-client-surface` is off. NOT the hook's own
 *  initial value, which is `isLoading: true` and only clears an effect later —
 *  that frame is long enough to paint "Loading EVM positions…" at every user. */
const EVM_DISABLED: EvmPositionsSnapshot = {
  rows: [],
  isLoading: false,
  errorsByChain: new Map(),
  truncatedCountsByChain: new Map(),
};

export function PositionsBar() {
  const evmEnabled = useEvmEnabled();
  const { items } = usePositionStrip();
  /* The `enabled` argument is the load-bearing half: this strip lives in the
     GLOBAL sub-header, so an ungated hook is a two-chain fetch every 30s for
     every user on every page, flag or no flag. */
  const evmSnapshot = useEvmPositions(evmEnabled);
  const { rows: evmRows, isLoading: evmLoading, errorsByChain } =
    evmEnabled ? evmSnapshot : EVM_DISABLED;
  const sellAll = useSellAllPosition();

  if (items.length === 0 && evmRows.length === 0 && !evmLoading && errorsByChain.size === 0) return null;

  return (
    /* The strip's own Tooltip provider. It sits in the GLOBAL sub-header,
       mounted by the app layout outside any page-level provider, so it
       carries one for every sell button below it — same reason AppFooter
       brings its own. One here, not one per row. */
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
    <div className="scroll-hide -mx-1 flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto px-1">
      {evmLoading && evmRows.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">Loading EVM positions…</span>
      ) : null}
      {errorsByChain.size > 0 ? (
        <span className="text-[10px] text-amber-500" title="Last known EVM positions are retained while balances recover">
          EVM positions stale ({[...errorsByChain.keys()].join(', ')})
        </span>
      ) : null}
      {items.map((item, i) => (
        <Fragment key={item.mint}>
          {i > 0 ? (
            <span
              aria-hidden
              className="h-3.5 w-px shrink-0"
              style={{ background: 'var(--hairline)' }}
            />
          ) : null}
          <PositionRow
            item={item}
            // Pass the position's identity as a navigation hint so the
            // trade header paints instantly instead of waiting on the
            // snapshot fetch.
            onOpen={() =>
              navigateToToken(item.mint, {
                symbol: item.symbol,
                imageUrl: item.logo,
              })
            }
            onSell={() => sellAll(item)}
          />
        </Fragment>
      ))}
      {evmRows.length > 0 && items.length > 0 ? (
        /* A DOUBLE rule, not the single hairline between same-chain rows: the
           boundary it marks is a change of denomination, and it needs to read
           as a stronger break than "next position". */
        <span
          aria-hidden
          className="h-3.5 w-[3px] shrink-0"
          style={{
            background: 'var(--hairline)',
            borderLeft: '1px solid var(--hairline)',
          }}
        />
      ) : null}
      {evmRows.map((row, i) => (
        <Fragment key={row.id}>
          {i > 0 ? (
            <span
              aria-hidden
              className="h-3.5 w-px shrink-0"
              style={{ background: 'var(--hairline)' }}
            />
          ) : null}
          <EvmPositionPill row={row} />
        </Fragment>
      ))}
    </div>
    </TooltipProvider>
  );
}

/**
 * One EVM position.
 *
 * No sell-all button, and that is an answer rather than an omission:
 * `useSellAllPosition` posts to the Solana order route with a lamports amount
 * and fans out across `contributors`, none of which exists here. A button that
 * looked identical and did nothing — or worse, submitted a Solana order for a
 * 0x address — is the failure mode this whole change exists to remove. The
 * pill opens the chain-qualified trade page, where the EVM panel is the real
 * sell surface.
 */
function EvmPositionPill({ row }: { row: EvmPositionRow }) {
  const amountText = evmAmountText(row.amount);
  const costText = evmAmountText(row.costBasis);
  const pnlText = evmAmountText(row.realizedPnl);
  /* Tone from the SIGN of the rendered text, not from a parsed float: the
     figure is a BigInt-derived string and re-parsing it to colour it would
     reintroduce the precision problem the formatter exists to avoid. A leading
     '-' is the whole signal, and an unknown figure takes neutral ink rather
     than the "down" colour — absence is not a loss. */
  const pnlTone =
    pnlText === null
      ? 'var(--ink-3)'
      : pnlText.startsWith('-')
        ? 'var(--down)'
        : 'var(--up)';
  /* Every disclosure this row carries, joined into the title. The strip has no
     room to render them inline, but they must be reachable — a figure whose
     unit is unconfirmed, or whose scale is unknown, cannot be presented as if
     it were neither. */
  const notes = [
    row.amount.kind === 'unknown' ? row.amount.reason : row.amount.note,
    row.costBasis.kind === 'amount' ? row.costBasis.note : null,
    row.value.kind === 'unknown' ? row.value.reason : null,
    row.unrealizedPnl.kind === 'unknown' ? row.unrealizedPnl.reason : null,
  ].filter((note): note is string => typeof note === 'string' && note.length > 0);

  return (
    <a
      href={row.href}
      draggable={false}
      onClick={(e) => {
        if (
          e.defaultPrevented
          || e.button !== 0
          || e.metaKey
          || e.ctrlKey
          || e.shiftKey
          || e.altKey
        ) {
          return;
        }
        e.preventDefault();
        // Chain-qualified. `navigateToToken` with a chain skips the Solana
        // hint/prewarm machinery entirely — see its own doc comment.
        navigateToToken(row.token, undefined, row.chain);
      }}
      onPointerEnter={() => prefetchToken(row.token, { chain: row.chain })}
      onFocus={() => prefetchToken(row.token, { chain: row.chain })}
      title={[`${row.label} on ${row.chain} — open trade`, ...notes].join('\n\n')}
      data-testid="evm-position-pill"
      className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--tabs-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      style={{ fontFamily: 'var(--mono)' }}
    >
      <span
        className="rounded-[3px] px-[3px] text-[7.5px] font-bold uppercase leading-[12px]"
        style={{
          color: 'var(--ink-2)',
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          letterSpacing: '0.1em',
        }}
      >
        {CHAIN_BADGES[row.chain]}
      </span>
      <span
        className="text-[10px] font-semibold uppercase leading-none"
        style={{ color: 'var(--ink-1)', letterSpacing: '0.04em' }}
      >
        {row.label}
      </span>
      {/* The AMOUNT, or the explicit unknown. Never a 0 standing in for an
          unread balance, and never an unlabelled bare number. */}
      <span className="text-[9.5px] leading-none tabular-nums" style={{ color: 'var(--ink-3)' }}>
        {amountText ?? '—'}
      </span>
      {costText !== null ? (
        <span
          className="text-[9.5px] leading-none tabular-nums"
          style={{ color: 'var(--ink-3)' }}
        >
          {/* "cost" spelled out because this is NOT the position's value —
              nothing on this route prices the open position, and a bare figure
              beside a Solana pill's USD value would read as one. */}
          cost {costText}
        </span>
      ) : null}
      {pnlText !== null ? (
        <span
          className="text-[9.5px] font-semibold leading-none tabular-nums"
          style={{ color: pnlTone }}
        >
          {/* REALIZED only, and labelled so. The unrealized leg is unknown on
              this route and an unlabelled PnL would be read as the total. */}
          r {pnlText}
        </span>
      ) : null}
    </a>
  );
}

/** Short chain marks for the pill. Storage tags are too long for a 22px row. */
const CHAIN_BADGES: Record<EvmPositionRow['chain'], string> = {
  bsc: 'BSC',
  robinhood_chain: 'RH',
};

function PositionRow({
  item,
  onOpen,
  onSell,
}: {
  item: PositionItem;
  onOpen: () => void;
  onSell: () => void;
}) {
  const { src, onError } = useResolvedTokenImage(item.logo);
  const ticker = item.symbol ?? truncateMint(item.mint);
  const pnl = item.pnlPct;
  const pnlColor = pnl == null ? 'var(--ink-3)' : pnl >= 0 ? 'var(--up)' : 'var(--down)';

  return (
    /* `data-position-row` is the hook the sub-header's stylesheet needs to
       hover the WHOLE position — art, ticker, value, PnL and the sell
       button together — rather than just the coin button inside it. */
    <div data-position-row="" className="flex shrink-0 items-center gap-1.5">
      {/* Coin: opens the Trade page. Hover warms the route — the user
          HOLDS this token, so this is the coldest navigation in the app. */}
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={() => prefetchToken(item.mint)}
        onFocus={() => prefetchToken(item.mint)}
        title={`${ticker} — open trade`}
        className="flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--tabs-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}
      >
        {/* Raw <img> to match the discover token-art pattern; sizing + fallback
            handled by useResolvedTokenImage. */}
        <img
          src={src}
          onError={onError}
          alt=""
          width={13}
          height={13}
          className="h-[13px] w-[13px] shrink-0 rounded-full object-cover"
        />
        <span
          className="text-[10px] font-semibold uppercase leading-none"
          style={{ color: 'var(--ink-1)', letterSpacing: '0.04em' }}
        >
          {ticker}
        </span>
        {item.amountUsd != null ? (
          <span
            className="text-[9.5px] leading-none tabular-nums"
            style={{ color: 'var(--ink-3)' }}
          >
            {formatUsd(item.amountUsd)}
          </span>
        ) : null}
        {pnl != null ? (
          <span
            className="text-[9.5px] font-semibold leading-none tabular-nums"
            style={{ color: pnlColor }}
          >
            {formatPct(pnl)}
          </span>
        ) : null}
      </button>

      {/* Sell all: one-click market-out of 100% of the position. Hover /
          press warms the trading engine's quote + cashback caches (fire-
          and-forget via the sync Clerk token mirror) so the sell doesn't
          hit a cold engine cache; pointerdown skips the coalesce window
          since the order POST follows within ~100ms. */}
      {/*
        The arrow is one click away from closing the WHOLE position, and
        nothing on it said so — an 18px caret reads as "open something"
        or "sell some", and the native `title` it used to carry took a
        second to appear and rendered as an OS tooltip that nobody
        associates with a destructive action.

        `asChild` so the tooltip does not add a wrapper element: the
        button is a flex item in the row and an extra span between them
        would change the gap.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onSell}
            onPointerEnter={() => warmSellEngine(item.mint)}
            onPointerDown={() => warmSellEngine(item.mint, { immediate: true })}
            aria-label={`Sell all ${ticker}`}
            className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--ink-3)] transition-colors hover:border-[var(--down)] hover:text-[var(--down)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            <SellIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Sells your entire {ticker} position</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Engine prewarm for an imminent sell — NOT awaited (prewarm is
 *  fire-and-forget by design; failures never surface). Reads the sync
 *  Clerk token mirror, never an awaited getToken() network call. */
function warmSellEngine(mint: string, options: { immediate?: boolean } = {}): void {
  const session = getClerkSession();
  if (session.isSignedIn !== true) return;
  prewarmMints([mint], session.token, options);
}

/** Down arrow = sell / out. */
function SellIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}
