import type { FixtureOrderKey, TokenSnapshot, TokenTrade } from './types';
import { setSolUsdHint } from '@/lib/state/sol-usd-hint';
import { rememberMintCreatedAt } from '@/components/discover/walletToastPresentation';

interface SnakeFixtureOrderKey {
  slot: number;
  tx_index: number;
  ix_index: number;
  log_index: number;
  event_index: number;
  order_source: 'source_index' | 'arrival_sequence';
}

export function normalizeTokenSnapshot(snapshot: TokenSnapshot): TokenSnapshot {
  // Feed the session-wide SOL price hint (toast MC math reads it sync)
  // and the coin-age registry (toast age badges for old coins).
  setSolUsdHint(snapshot?.solUsd);
  rememberMintCreatedAt(snapshot?.mint, snapshot?.createdAtMs);
  return {
    ...snapshot,
    recentTrades: normalizeTokenTrades(snapshot.recentTrades),
    tradeHistory: snapshot.tradeHistory ? normalizeTokenTrades(snapshot.tradeHistory) : snapshot.tradeHistory,
  };
}

export function normalizeTokenTrades(trades: readonly TokenTrade[]): TokenTrade[] {
  return trades.map((trade) => normalizeTokenTrade(trade)).filter((trade): trade is TokenTrade => trade != null);
}

export function normalizeTokenTrade(value: unknown): TokenTrade | null {
  if (!isRecord(value)) return null;
  const orderKey = normalizeFixtureOrderKey(value.orderKey);
  if (value.orderKey !== undefined && orderKey == null) return null;
  if (
    typeof value.signature !== 'string'
    || typeof value.slot !== 'number'
    || typeof value.user !== 'string'
    || typeof value.isBuy !== 'boolean'
    || typeof value.solLamports !== 'string'
    || typeof value.tokenBaseUnits !== 'string'
    || typeof value.vsr !== 'string'
    || typeof value.vtr !== 'string'
    || typeof value.realSolLamports !== 'string'
    || typeof value.realTokenBaseUnits !== 'string'
    || typeof value.feeLamports !== 'string'
    || (value.priceLamportsNum !== undefined && typeof value.priceLamportsNum !== 'string')
    || (value.priceLamportsDen !== undefined && typeof value.priceLamportsDen !== 'string')
    || typeof value.arrivedAtMs !== 'number'
    || (typeof value.blockTimeSec !== 'number' && value.blockTimeSec !== null)
  ) {
    return null;
  }
  return {
    signature: value.signature,
    slot: value.slot,
    ...(orderKey ? { orderKey } : {}),
    user: value.user,
    isBuy: value.isBuy,
    solLamports: value.solLamports,
    tokenBaseUnits: value.tokenBaseUnits,
    vsr: value.vsr,
    vtr: value.vtr,
    realSolLamports: value.realSolLamports,
    realTokenBaseUnits: value.realTokenBaseUnits,
    feeLamports: value.feeLamports,
    ...(typeof value.traderPostTokenBaseUnits === 'string'
      ? { traderPostTokenBaseUnits: value.traderPostTokenBaseUnits }
      : {}),
    ...(typeof value.marketCapLamports === 'string' ? { marketCapLamports: value.marketCapLamports } : {}),
    ...(typeof value.priceLamportsNum === 'string' ? { priceLamportsNum: value.priceLamportsNum } : {}),
    ...(typeof value.priceLamportsDen === 'string' ? { priceLamportsDen: value.priceLamportsDen } : {}),
    arrivedAtMs: value.arrivedAtMs,
    blockTimeSec: value.blockTimeSec,
  };
}

function normalizeFixtureOrderKey(value: unknown): FixtureOrderKey | null {
  if (!isRecord(value)) return null;
  if (isCamelOrderKey(value)) return value;
  if (isSnakeOrderKey(value)) {
    return {
      slot: value.slot,
      txIndex: value.tx_index,
      ixIndex: value.ix_index,
      logIndex: value.log_index,
      eventIndex: value.event_index,
      orderSource: value.order_source,
    };
  }
  return null;
}

function isCamelOrderKey(value: Record<string, unknown>): value is Record<string, unknown> & FixtureOrderKey {
  return typeof value.slot === 'number'
    && typeof value.txIndex === 'number'
    && typeof value.ixIndex === 'number'
    && typeof value.logIndex === 'number'
    && typeof value.eventIndex === 'number'
    && (value.orderSource === 'source_index' || value.orderSource === 'arrival_sequence');
}

function isSnakeOrderKey(value: Record<string, unknown>): value is Record<string, unknown> & SnakeFixtureOrderKey {
  return typeof value.slot === 'number'
    && typeof value.tx_index === 'number'
    && typeof value.ix_index === 'number'
    && typeof value.log_index === 'number'
    && typeof value.event_index === 'number'
    && (value.order_source === 'source_index' || value.order_source === 'arrival_sequence');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
