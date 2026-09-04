import { TokenHeader } from '@/components/trade/TokenHeader';

/**
 * `/trade/<mint>` — THE SAME PAGE AS `/trade`, NOT A SECOND ONE.
 *
 * There used to be two trade surfaces: this one and `/trade`. There is
 * one now, and this route renders it.
 *
 * ── WHY THE URL SURVIVED ─────────────────────────────────────────────
 *
 * Deleting the folder would have been the tidier read of "leave only
 * /trade", and it would 404 every link into a coin: the Discover cards,
 * the portfolio treemap, the wallet notifications, the agent's
 * proposals and `navigateToToken` all address a token this way. Eight
 * places, all of them the normal route into trading something.
 *
 * So the second PAGE is gone and the address is not. `/trade/<mint>` and
 * `/trade` are the same page; the mint in the path is which coin it is
 * about, which is a parameter rather than a different screen.
 */
export default function MintTradeRoute() {
  return <TokenHeader />;
}
