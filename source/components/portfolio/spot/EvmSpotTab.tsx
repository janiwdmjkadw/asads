'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  EvmActivityHistory,
  type EvmActivityChain,
} from '@/components/portfolio/EvmActivityHistory';
import {
  evmAmountText,
  shortenAddress,
  type EvmAmount,
  type EvmPositionRow,
} from '@/components/positions/evmPositionView';
import { useEvmPositions } from '@/components/positions/useEvmPositions';
import type { EvmPortfolioChain } from '@/lib/api/evm-positions';
import { EvmPerformancePanel } from './EvmPerformancePanel';

const BSC_ONLY: ReadonlyArray<EvmActivityChain> = ['bsc'];
const ROBINHOOD_ONLY: ReadonlyArray<EvmActivityChain> = ['robinhood_chain'];

const CHAIN_NAMES: Record<EvmPortfolioChain, string> = {
  bsc: 'BSC',
  robinhood_chain: 'Robinhood',
};

/**
 * Exact EVM portfolio surface.
 *
 * The EVM route is deliberately not projected through the Solana Spot types:
 * those types name lamports, SPL buckets, signatures and a Solana performance
 * series. This table consumes only `GET /portfolio/evm` rows, whose balances,
 * settlement assets, current USD value and PnL are separately typed.
 */
export function EvmSpotTab({ chain }: { chain: EvmPortfolioChain }) {
  const snapshot = useEvmPositions();
  const rows = snapshot.rows.filter((row) => row.chain === chain);
  const activityChains = chain === 'bsc' ? BSC_ONLY : ROBINHOOD_ONLY;
  return (
    <EvmSpotBody
      chain={chain}
      rows={rows}
      loading={snapshot.isLoading}
      errorKind={snapshot.errorsByChain.get(chain) ?? null}
      truncatedCount={snapshot.truncatedCountsByChain.get(chain) ?? 0}
      performance={<EvmPerformancePanel chain={chain} />}
      activity={<EvmActivityHistory key={chain} chains={activityChains} />}
    />
  );
}

export function EvmSpotBody({
  chain,
  rows,
  loading,
  errorKind,
  truncatedCount = 0,
  performance,
  activity,
}: {
  chain: EvmPortfolioChain;
  rows: ReadonlyArray<EvmPositionRow>;
  loading: boolean;
  errorKind: string | null;
  truncatedCount?: number;
  performance?: ReactNode;
  activity?: ReactNode;
}) {
  const chainName = CHAIN_NAMES[chain];
  const measuredValues = rows.filter((row) => row.value.kind === 'amount').length;
  const measuredPnl = rows.filter((row) => row.unrealizedPnl.kind === 'amount').length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid={`evm-spot-${chain}`}>
      <header className="panel portfolio-panel mb-3 flex flex-wrap items-start justify-between gap-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {chainName} spot
          </p>
          <h2 className="mt-1 text-lg font-semibold">Holdings and performance</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Chain-qualified balances, settlement units, current measured value, and PnL.
            Unread figures stay unavailable; they are never relabelled as Solana units or zero.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-[10px]">
          <Metric label="Shown holdings" value={String(rows.length)} />
          <Metric label="Measured values" value={`${measuredValues}/${rows.length}`} />
          <Metric label="Measured PnL" value={`${measuredPnl}/${rows.length}`} />
        </div>
      </header>

      {errorKind !== null ? (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600" role="status">
          {rows.length > 0
            ? `${chainName} could not refresh (${errorKind}); the last successfully read rows remain visible.`
            : `${chainName} holdings could not be read (${errorKind}). This is not an empty-portfolio result.`}
        </div>
      ) : null}

      {truncatedCount > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600" role="status">
          {truncatedCount} additional ledger {truncatedCount === 1 ? 'holding is' : 'holdings are'} omitted by the bounded portfolio read.
          Current rows and measured coverage are partial; omitted holdings are not counted as zero.
        </div>
      ) : null}

      {performance}

      <section className="panel portfolio-panel mb-3 overflow-hidden" aria-label={`${chainName} current value and PnL`}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--hairline)] px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Current holdings</h3>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Exact current snapshot from the EVM portfolio ledger and on-chain balance reads.
            </p>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">Loading {chainName} holdings...</p>
        ) : rows.length === 0 && errorKind === null ? (
          <p className="p-4 text-xs text-muted-foreground">No open {chainName} positions recorded.</p>
        ) : rows.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left text-[11px]">
              <thead className="bg-[var(--input-bg)] text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Token</th>
                  <th className="px-3 py-2 font-semibold">Wallet</th>
                  <th className="px-3 py-2 font-semibold">Balance</th>
                  <th className="px-3 py-2 font-semibold">Current value</th>
                  <th className="px-3 py-2 font-semibold">Cost basis</th>
                  <th className="px-3 py-2 font-semibold">Unrealized PnL</th>
                  <th className="px-3 py-2 font-semibold">Realized PnL</th>
                  <th className="px-3 py-2 font-semibold">Fills</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hairline)]">
                {rows.map((row) => <EvmHoldingRow key={row.id} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activity}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--input-bg)] px-2.5 py-2">
      <div className="font-mono text-sm font-semibold tabular-nums text-[var(--ink-0)]">{value}</div>
      <div className="mt-0.5 whitespace-nowrap uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
    </div>
  );
}

function EvmHoldingRow({ row }: { row: EvmPositionRow }) {
  return (
    <tr>
      <td className="px-3 py-2.5">
        <Link href={row.href} className="font-mono font-semibold underline decoration-transparent hover:decoration-current">
          {shortenAddress(row.token)}
        </Link>
      </td>
      <td className="px-3 py-2.5 font-mono text-muted-foreground" title={row.walletAddress}>
        {shortenAddress(row.walletAddress)}
      </td>
      <AmountCell amount={row.amount} />
      <AmountCell amount={row.value} />
      <AmountCell amount={row.costBasis} />
      <AmountCell amount={row.unrealizedPnl} signed />
      <AmountCell amount={row.realizedPnl} signed />
      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
        {row.fillCount}
        {row.lastFillAtMs === null ? null : (
          <span className="ml-1 text-[9px]">({new Date(row.lastFillAtMs).toLocaleDateString()})</span>
        )}
      </td>
    </tr>
  );
}

function AmountCell({ amount, signed = false }: { amount: EvmAmount; signed?: boolean }) {
  const text = evmAmountText(amount);
  const note = amount.kind === 'unknown' ? amount.reason : amount.note;
  const color = text === null
    ? 'var(--ink-3)'
    : signed && text.startsWith('-')
      ? 'var(--down)'
      : signed
        ? 'var(--up)'
        : 'var(--ink-1)';
  return (
    <td className="px-3 py-2.5 font-mono tabular-nums" style={{ color }} title={note ?? undefined}>
      {text ?? 'Unavailable'}
    </td>
  );
}
