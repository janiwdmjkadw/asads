'use client';

import { useEffect, useState } from 'react';

import { fetchEvmFills, type EvmFillEntry, type EvmFillsResult } from '@/lib/evm/fillsApi';
import { foldFills } from '@/lib/evm/fillsFold';
import { EVM_NATIVE_DECIMALS, formatBigIntUnits, parseWireSigned } from '@/lib/evm/money';

/**
 * The signed-in user's own confirmed fills for one EVM token.
 *
 * THIS IS NOT THE PUBLIC TAPE and the heading says so. The tape above it is
 * every trade the page has watched land since it opened; this is every fill of
 * the user's own that the api has recorded, including ones from before the tab
 * existed. Presenting either as the other is the failure worth avoiding: the
 * tape looks like a trade history and is not, and this looks like market
 * activity and is not.
 *
 * Amounts are rendered in NATIVE units (18 decimals on every wave-1 chain,
 * served per-wallet as `native_decimals`). Token amounts are scaled by the
 * MEASURED `tokenDecimals` the page resolved for this token — the fills route
 * itself carries no per-token `decimals` field, but the page mounting this
 * panel holds `EvmCardView.measuredTokenDecimals` for exactly this token, and
 * printing raw base units beside a page that renders the same token scaled
 * everywhere else was a gap, not a disclosure. When nothing measured a scale
 * the base-unit rendering (with the words "base units") remains: scaling by
 * an assumed 18 would be a figure off by a power of ten with nothing on
 * screen admitting it could be.
 */

const LIMIT = 25;

export function EvmMyFills({
  chain,
  address,
  nativeSymbol,
  tokenDecimals,
  /** Bumped by the panel after an order confirms, to refetch. */
  refetchToken = 0,
}: {
  chain: string;
  address: string;
  nativeSymbol: string;
  /**
   * The token's MEASURED decimals, or `null` when nothing measured them.
   * Must be `EvmCardView.measuredTokenDecimals`, never the render-time
   * fallback that is 18 whenever the wire served no scale.
   */
  tokenDecimals: number | null;
  refetchToken?: number;
}) {
  const [result, setResult] = useState<EvmFillsResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void fetchEvmFills(
      { chain, token: address, limit: LIMIT },
      { signal: controller.signal },
    ).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [chain, address, refetchToken]);

  return (
    <section className="rounded-md border border-[var(--hairline)] p-3" data-testid="evm-my-fills">
      <header className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[12px] font-semibold" style={{ color: 'var(--ink-1)' }}>
          Your fills
        </h3>
        <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
          your own confirmed trades on this token — not the market tape
        </span>
      </header>
      <FillsBody result={result} nativeSymbol={nativeSymbol} tokenDecimals={tokenDecimals} />
    </section>
  );
}

/**
 * Each result kind renders as itself.
 *
 * `null` (in flight) is deliberately distinct from an `ok` with no fills: "we
 * are still asking" and "you have never traded this" are different answers and
 * showing the second while the first is true is the empty-vs-unavailable
 * defect in miniature.
 *
 * Exported for the render test only — the panel above it fetches in an effect,
 * so a rendered fill is not reachable through it.
 */
export function FillsBody({
  result,
  nativeSymbol,
  tokenDecimals,
}: {
  result: EvmFillsResult | null;
  nativeSymbol: string;
  /** Measured token decimals, or `null` — see `EvmMyFills`. */
  tokenDecimals: number | null;
}) {
  if (result === null) {
    return <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>Loading…</p>;
  }
  if (result.kind === 'reauth') {
    return (
      <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
        Sign in to see your fills for this token.
      </p>
    );
  }
  if (result.kind !== 'ok') {
    return (
      <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
        Your fill history could not be loaded, so it is unknown rather than
        empty. {reasonText(result)}
      </p>
    );
  }
  if (result.fills.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
        No fills recorded for this token on your wallets.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PositionStrip
        fills={result.fills}
        nativeSymbol={nativeSymbol}
        tokenDecimals={tokenDecimals}
      />
      <ul className="flex flex-col gap-1">
        {result.fills.map((fill) => (
          <FillRow
            key={fill.fillId}
            fill={fill}
            nativeSymbol={nativeSymbol}
            tokenDecimals={tokenDecimals}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Bought / Sold / Holding over the user's own fills, plus the net native
 * flow — the aggregation the Solana panel's PnL strip provides and this
 * surface simply lacked.
 *
 * **Holding is gated on a provably complete list.** The fills route serves
 * the newest `LIMIT` rows with no pagination, so a full page means older
 * fills MAY exist and a lifetime net computed from a window would be a
 * fabricated position — it is omitted with the reason stated, while Bought
 * and Sold stay up labelled as sums over what is shown. An unreadable token
 * delta withholds the whole token fold rather than folding around it.
 */
function PositionStrip({
  fills,
  nativeSymbol,
  tokenDecimals,
}: {
  fills: ReadonlyArray<EvmFillEntry>;
  nativeSymbol: string;
  tokenDecimals: number | null;
}) {
  const fold = foldFills(fills);
  // A full page means the window may have clipped older fills.
  const windowMayClip = fills.length >= LIMIT;
  const tokenAmount = (value: bigint): string =>
    tokenDecimals === null
      ? `${formatBigIntUnits(value, 0, 0)} base units`
      : `${formatBigIntUnits(value, tokenDecimals, 4)} tokens`;
  return (
    <div
      className="flex flex-col gap-0.5 text-[11px] tabular-nums"
      style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}
      data-testid="evm-fills-position"
    >
      {fold.token.kind === 'unreadable' ? (
        <p data-testid="evm-fills-position-unreadable" style={{ color: 'var(--ink-3)' }}>
          A fill&apos;s token amount could not be read, so Bought / Sold /
          Holding are unavailable rather than computed around it.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span data-testid="evm-fills-bought">
            Bought {tokenAmount(fold.token.totals.boughtBaseUnits)}
          </span>
          <span data-testid="evm-fills-sold">
            Sold {tokenAmount(fold.token.totals.soldBaseUnits)}
          </span>
          {windowMayClip ? null : (
            <span data-testid="evm-fills-holding">
              Holding {tokenAmount(fold.token.totals.netBaseUnits)}
            </span>
          )}
          {fold.native.kind === 'ok' && (
            <span data-testid="evm-fills-net-native">
              Net {formatBigIntUnits(fold.native.netWei, EVM_NATIVE_DECIMALS, 6)} {nativeSymbol}
            </span>
          )}
        </div>
      )}
      {windowMayClip && (
        <p data-testid="evm-fills-position-window" style={{ color: 'var(--ink-3)' }}>
          Sums cover the newest {LIMIT} fills only — older fills may exist and
          cannot be requested, so a holding figure is not computable from this
          list.
        </p>
      )}
    </div>
  );
}

function reasonText(
  result: Exclude<EvmFillsResult, { kind: 'ok' } | { kind: 'reauth' }>,
): string {
  switch (result.kind) {
    case 'error':
      return `(${result.errorCode})`;
    case 'network_error':
      return '(the request did not complete)';
    case 'shape_mismatch':
      return '(the response was not in a readable shape)';
    default:
      return '';
  }
}

function FillRow({
  fill,
  nativeSymbol,
  tokenDecimals,
}: {
  fill: EvmFillEntry;
  nativeSymbol: string;
  tokenDecimals: number | null;
}) {
  /* THIS ONE IS GENUINELY NATIVE — audited, because it looks exactly like the
     quote-denomination bug the tape, the header price, the chart, the reserve
     stats and the top-traders panel were all gated for, and a future reader
     will reach for the same gate.

     It is a DIFFERENT PRODUCER. Those five read the ingestion wire, which
     publishes a market's ratio without naming the asset it is quoted in. This
     reads our own execution ledger: `trading.fills.sol_delta_lamports` — a
     Solana-era name on a chain-agnostic column. `trading.fills` is the table
     migration 0110 (`ledger_chain_expand`) chain-qualified, and the naming
     doctrine that makes the Solana-era column name safe to read as wei is
     stated by its sibling 0113 (`revenue_chain_expand`): "`*_lamports` holds
     wei on an EVM row … `chain` is what tells a reader which unit the integer
     is in." Aliased to `nativeDeltaWei` by
     `api/src/db/queries/evm-trade-reads.ts`. Its only EVM writer is
     `the backend service`'s `FILL_INSERT` ($8 = an internal routine,
     the backend source), and every path that fills it is denominated in the
     CHAIN's own asset:
       - four.meme curve — `TokenPurchase`/`TokenSale.cost`, BNB wei
         (the backend source).
       - Pancake V2 sell — `amount0Out`/`amount1Out` on the WBNB side of the
         `(token, WBNB)` pair (the backend source).
       - Pons V3 sell — the negative delta on the WETH9 side of the
         `(token, WETH9)` pool; the pool is resolved as
         `getPool(token, ROBINHOOD_WETH, tier)` (the backend source), so the
         money leg is WETH by construction.
       - any router buy — `intent.amount_in`, i.e. the order wire's
         `native_in_wei`, which is `msg.value`.

     A STOCK-QUOTED MARKET CANNOT REACH THIS PANEL AT ALL: the counter asset in
     that pool lookup is hard-wired to WETH9, so a token with no `(token, WETH9)`
     pool is refused at routing and never produces a fill. There is therefore no
     row here whose native figure could be quote-token base units, and gating
     this the way the wire-fed surfaces are gated would withhold a correct
     number for a case that cannot occur.

     The native delta is SIGNED and its sign is the direction: negative means
     native left the wallet. It is rendered as a MAGNITUDE beside the side
     label, because "buy −0.5 BNB" reads as a negative purchase; the side
     carries the direction and the figure carries the size. */
  const native = parseWireSigned(fill.nativeDeltaWei);
  const nativeText =
    native === null
      ? null
      : formatBigIntUnits(native < 0n ? -native : native, EVM_NATIVE_DECIMALS, 6);
  const tokens = parseWireSigned(fill.tokenDeltaBaseUnits);
  /* Scaled at the MEASURED decimals when the page holds one — the fills route
     serves none itself, but the page mounting this panel does, for exactly
     this token. Unmeasured stays BASE UNITS, said out loud below: an assumed
     18 would be off by a power of ten with nothing on screen admitting it. */
  const tokensText =
    tokens === null
      ? null
      : formatBigIntUnits(
          tokens < 0n ? -tokens : tokens,
          tokenDecimals ?? 0,
          tokenDecimals === null ? 0 : 4,
        );
  const tone = fill.side === 'buy' ? 'var(--up)' : 'var(--down)';
  return (
    <li
      className="flex items-baseline gap-2 text-[11px] tabular-nums"
      style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}
      data-testid="evm-fill-row"
    >
      <span className="font-bold uppercase" style={{ color: tone }}>
        {fill.side}
      </span>
      {/* A figure we could not read renders as an em dash. Never a 0 — a fill
          of zero native is not a thing that happened. */}
      <span>{nativeText === null ? '—' : `${nativeText} ${nativeSymbol}`}</span>
      <span style={{ color: 'var(--ink-3)' }}>
        {tokensText === null
          ? '—'
          : tokenDecimals === null
            ? /* BASE UNITS, said out loud — nothing measured a scale. */
              `${tokensText} base units`
            : `${tokensText} tokens`}
      </span>
      <span className="ml-auto" style={{ color: 'var(--ink-3)' }}>
        {fill.confirmedAtMs === null
          ? 'time unknown'
          : new Date(fill.confirmedAtMs).toLocaleTimeString()}
      </span>
    </li>
  );
}
