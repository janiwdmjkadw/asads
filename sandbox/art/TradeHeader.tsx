/*
 * The trade page's token header, on the design sheet.
 *
 * It is not built here any more — it lives in the product at
 * `source/components/trade/TokenHeader`, and this re-exports it so
 * `/whatever` shows the shipping component rather than a copy of it.
 *
 * Same arrangement the launchpad marks have: the sheet is a place to
 * LOOK at the thing, not a second version of it that can drift.
 */
export { TokenHeader as TradeHeader } from '@/components/trade/TokenHeader';
