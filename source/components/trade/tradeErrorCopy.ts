// Human copy for engine capacity / availability reject codes that would
// otherwise render raw in toast subtitles (e.g. `engine_lane.queue_full`).
// The sync API path prefixes engine kinds with `engine_`
// (api/src/trade/errors.ts TradingEngineRejected) while SSE events carry
// them unprefixed, so both spellings map. Every other code intentionally
// keeps rendering raw — do not extend this to general error translation.

const TRADE_ERROR_COPY: Record<string, string> = {
  'lane.queue_full': 'Engine busy — order queue full, try again',
  'engine_lane.queue_full': 'Engine busy — order queue full, try again',
  'wallet.in_flight_cap': 'Too many in-flight orders for this wallet',
  'engine_wallet.in_flight_cap': 'Too many in-flight orders for this wallet',
  trading_engine_unavailable: 'Trading engine unreachable — try again',
};

export function humanTradeErrorCopy(code: string): string {
  return TRADE_ERROR_COPY[code] ?? code;
}
