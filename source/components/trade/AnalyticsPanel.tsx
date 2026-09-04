import { memo } from 'react';
import { Caption, LiveDot, Numeral, StatBox } from '@/components/listen/primitives';
import type { MockToken } from './mockTrade';
import type { TokenHolder } from './types';

interface Props {
  token: MockToken;
  holders: TokenHolder[];
  holdersLoading?: boolean;
  holdersError?: string | null;
  trackedWalletLabels?: Record<string, string>;
}

const EMPTY_TRACKED_WALLET_LABELS: Record<string, string> = {};

/**
 * Analytics side panel — sits beneath TradePanel, aligned to the same
 * 320px rail. Compressed to match TradesTable height so the whole page
 * fits inside one viewport.
 *
 * Memoized: TradePage re-renders ~1-2×/sec on stream ticks; props are
 * identity-stabilized upstream, so this subtree only re-renders when the
 * holders/token data actually changes.
 */
export const AnalyticsPanel = memo(function AnalyticsPanel({
  token,
  holders,
  holdersLoading = false,
  holdersError = null,
  trackedWalletLabels = EMPTY_TRACKED_WALLET_LABELS,
}: Props) {
  return (
    <aside className="panel flex min-h-[var(--table-min-h)] w-full flex-col gap-2 overflow-y-auto p-3 scroll-hide lg:h-full lg:min-h-0">
      <Header />
      <Top10Distribution holders={holders} />
      <TopHolders
        holders={holders}
        loading={holdersLoading}
        error={holdersError}
        trackedWalletLabels={trackedWalletLabels}
      />
      <SmartMoneyAndScore score={token.score} />
    </aside>
  );
});

function Header() {
  return (
    <div className="flex items-center justify-between">
      <Caption size="lg">Analytics</Caption>
      <span
        className="t-num-xs inline-flex items-center gap-1"
        style={{ color: 'var(--accent-primary)' }}
      >
        <LiveDot size={6} tone="primary" />
        LIVE
      </span>
    </div>
  );
}

function Top10Distribution({ holders }: { holders: TokenHolder[] }) {
  const top10Pct = holders.slice(0, 10).reduce((sum, holder) => sum + holder.supplyPct, 0);
  const slices = holders.slice(0, 10).map((holder, index) => ({
    key: holder.owner,
    w: Math.max(0, Math.min(100, holder.supplyPct)),
    color: HOLDER_COLORS[index % HOLDER_COLORS.length]!,
  }));
  const remainder = Math.max(0, 100 - top10Pct);
  return (
    <div className="flex items-center gap-2.5">
      <Caption size="sm" tone="ink-3" style={{ flexShrink: 0, letterSpacing: '0.14em' }}>
        Top 10
      </Caption>
      <div className="flex h-[6px] flex-1 overflow-hidden rounded-full" aria-hidden>
        {slices.map((slice) => (
          <Slice key={slice.key} w={slice.w} color={slice.color} />
        ))}
        <Slice w={remainder} color="rgba(255,255,255,0.08)" noGlow />
      </div>
      <Numeral size="xs" tone="ink-0" className="shrink-0">
        {formatPct(top10Pct)}
      </Numeral>
    </div>
  );
}

function TopHolders({
  holders,
  loading,
  error,
  trackedWalletLabels,
}: {
  holders: TokenHolder[];
  loading: boolean;
  error: string | null;
  trackedWalletLabels: Record<string, string>;
}) {
  const top10 = holders.slice(0, 10);
  const emptyLabel = error
    ? `holders unavailable: ${error}`
    : loading
      ? 'loading holders…'
      : 'no holders loaded';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <Caption size="sm" tone="ink-3" style={{ letterSpacing: '0.14em' }}>
          Top 10 Holders
        </Caption>
        <Numeral size="xs" tone="ink-3">
          {top10.length}/10
        </Numeral>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--r-lg)]"
        style={{
          background: 'var(--chip-bg)',
          border: '1px solid var(--chip-border, var(--hairline))',
        }}
      >
        {top10.length > 0 ? (
          <div className="scroll-hide min-h-0 overflow-y-auto">
            {top10.map((holder, index) => (
              <HolderRow
                key={holder.owner}
                holder={holder}
                trackedLabel={trackedWalletLabels[holder.owner]}
                last={index === top10.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[96px] flex-1 items-center justify-center px-3 text-center">
            <span className="t-num-xs" style={{ color: 'var(--ink-3)' }}>
              {emptyLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SmartMoneyAndScore({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <StatBox label="Smart $" value="+7" tone="up" />
      <StatBox label="Score" value={score.toFixed(1)} />
    </div>
  );
}

function Slice({ w, color, noGlow }: { w: number; color: string; noGlow?: boolean }) {
  return (
    <div
      style={{
        width: `${w}%`,
        background: color,
        boxShadow: noGlow ? 'none' : `0 0 6px color-mix(in srgb, ${color} 50%, transparent)`,
      }}
    />
  );
}

function HolderRow({
  holder,
  trackedLabel,
  last,
}: {
  holder: TokenHolder;
  trackedLabel?: string;
  last?: boolean;
}) {
  const display = trackedLabel ?? shortAddress(holder.owner);
  return (
    <div
      className="flex h-[28px] items-center gap-2 px-2.5"
      style={last ? undefined : { borderBottom: '1px solid var(--hairline)' }}
    >
      <span className="t-num-xs w-4 shrink-0" style={{ color: 'var(--ink-3)' }}>
        {holder.rank}
      </span>
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full"
        style={{
          width: 12,
          height: 12,
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
        }}
      />
      <span
        className="t-num-xs truncate"
        style={{ color: trackedLabel ? 'var(--accent-primary)' : 'var(--ink-1)' }}
        title={
          trackedLabel
            ? `${trackedLabel} (${shortAddress(holder.owner)})`
            : shortAddress(holder.owner)
        }
      >
        {display}
      </span>
      {holder.tokenAccountCount > 1 && (
        <span
          className="shrink-0 rounded-[var(--r-xs)] px-1 py-0.5 text-[9px] leading-none"
          style={{
            color: 'var(--hold)',
            background: 'color-mix(in srgb, var(--hold) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--hold) 30%, transparent)',
            letterSpacing: '0.1em',
            fontFamily: 'var(--mono)',
          }}
        >
          x{holder.tokenAccountCount}
        </span>
      )}
      <Numeral size="xs" tone="ink-0" className="ml-auto shrink-0">
        {formatPct(holder.supplyPct)}
      </Numeral>
    </div>
  );
}

const HOLDER_COLORS = [
  'var(--accent-primary)',
  'var(--accent-secondary)',
  'var(--up)',
  'var(--hold)',
  '#f0567a',
  '#38bdf8',
  '#f59e0b',
  '#a78bfa',
  '#22c55e',
  '#f472b6',
];

function formatPct(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value >= 10) return `${value.toFixed(1)}%`;
  if (value >= 1) return `${value.toFixed(2)}%`;
  return `${value.toFixed(3)}%`;
}

function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
