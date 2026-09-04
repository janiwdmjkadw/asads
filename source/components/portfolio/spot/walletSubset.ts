import type { SpotHolding, SpotSuccess } from '@/lib/api/portfolio-spot';

/**
 * Slice "Portfolio Spot tab": narrowing a snapshot to a SUBSET of
 * wallets, client side.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * `/spot` takes one optional `wallet_account_id`, so the endpoint can
 * answer for every wallet or for exactly one. It cannot answer for
 * three of your twenty.
 *
 * It does not need to. The "all wallets" response already carries the
 * split: every holding has a `wallet_breakdown` naming, per wallet, the
 * amount and the value held in it. Three of twenty is that response
 * with the breakdown rows summed over the three — no second request,
 * no waiting, and no chance of the parts disagreeing with the whole,
 * because they came out of the same snapshot.
 *
 * WHAT THIS CANNOT DO is the chart. `/performance` returns a series,
 * not a per-wallet decomposition of one, so a subset's history is not
 * derivable from the "all" answer. `SpotTab` handles that by asking the
 * endpoint for one wallet when exactly one is picked and for everything
 * otherwise — see the note at its call site.
 */

/** Sum the parts of a holding that live in `ids`. */
function narrowHolding(h: SpotHolding, ids: ReadonlySet<string>): SpotHolding | null {
  const rows = h.wallet_breakdown.filter((b) => ids.has(b.wallet_account_id));
  if (rows.length === 0) return null;

  const amount = rows.reduce((s, b) => s + b.amount_ui, 0);
  if (amount <= 0) return null;

  /*
   * A breakdown row's `value_usd` is null when the token has no price.
   * Summing those as zero would quietly report a holding as worthless
   * rather than as unpriced, so the total stays null unless at least
   * one row actually carries a number.
   */
  const priced = rows.filter((b) => b.value_usd != null);
  const value = priced.length > 0 ? priced.reduce((s, b) => s + (b.value_usd ?? 0), 0) : null;

  /*
   * `amount_raw` is a string-encoded bigint of the FULL position, and
   * there is no honest way to scale it here — the ratio is a float and
   * the field is exact. It is left as the whole amount; nothing on this
   * page reads it, and a wrong exact number is worse than a stale one.
   */
  return {
    ...h,
    amount_ui: amount,
    value_usd: value,
    wallet_breakdown: rows,
    /* Recomputed against the subset's own total by the caller — a share
       of the whole portfolio is meaningless once the portfolio has been
       narrowed. */
    pct_of_portfolio: 0,
    /*
     * Cost basis and the PnL derived from it are per-LOT, and a lot
     * belongs to a wallet the breakdown does not name. Narrowing them
     * by value share would be inventing a number, so they are dropped
     * to null and the page shows nothing rather than something wrong.
     */
    cost_basis_usd: null,
    unrealized_usd: null,
    unrealized_pct: null,
    realized_usd: null,
  };
}

/**
 * A snapshot as it would read for `ids` alone.
 *
 * `ids` empty means every wallet, and the snapshot is returned
 * untouched — the caller has nothing to narrow.
 */
export function narrowSpot(spot: SpotSuccess, ids: ReadonlyArray<string>): SpotSuccess {
  if (ids.length === 0) return spot;
  const set = new Set(ids);

  const holdings = spot.holdings
    .map((h) => narrowHolding(h, set))
    .filter((h): h is SpotHolding => h !== null);

  const totalUsd = holdings.reduce((s, h) => s + (h.value_usd ?? 0), 0);

  const bucket = (name: SpotHolding['bucket']): number =>
    holdings.filter((h) => h.bucket === name).reduce((s, h) => s + (h.value_usd ?? 0), 0);

  return {
    ...spot,
    totalUsd,
    solUsd: bucket('sol'),
    stableUsd: bucket('stable'),
    splUsd: bucket('spl'),
    holdings: holdings.map((h) => ({
      ...h,
      pct_of_portfolio: totalUsd > 0 ? ((h.value_usd ?? 0) / totalUsd) * 100 : 0,
    })),
    walletAggregates: spot.walletAggregates.filter((a) => set.has(a.wallet_account_id)),
    /*
     * The 24h delta is a snapshot-level figure with no per-wallet
     * decomposition in the payload. Rather than scale it by value share
     * — which assumes every wallet moved the same way, and the point of
     * filtering is usually that one did not — the header shows no delta
     * for a subset.
     */
    change24hUsd: null,
    change24hPct: null,
    /* Lifetime PnL is not in the breakdown either. Same rule. */
    realizedUsd: 0,
    unrealizedUsd: 0,
    costBasisUsd: 0,
  };
}
