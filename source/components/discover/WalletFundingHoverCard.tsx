'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Clock, Copy, ExternalLink, Search, Solana, Wallet } from '@/components/listen/icons/Icons';
import { openWalletProfile } from '@/lib/state/wallet-profile-store';
import {
  useWalletFunding,
  walletFundingQueryOptions,
  type WalletFunding,
} from '@/lib/api/wallet-funding';
import { ExchangeIcon } from '@/components/trade/ExchangeIcon';
import { shortAddress } from './trackedWallets';

/**
 * WalletFundingHoverCard — Axiom-style wallet dossier popover for the
 * Discover dev chip. Hovering the trigger opens a compact card with the
 * wallet's address, live SOL balance (+USD), funding age, and funding
 * source (exchange badge when the first funder is a known CEX hot
 * wallet, otherwise the funder address).
 *
 * Latency: the immutable funding trace is prefetched at hover INTENT
 * (pointer touches the chip) rather than on card open, so it resolves
 * during the 150ms open delay instead of after mount. Idle lanes still
 * never fetch — Discover devs are fresh wallets, so eager per-card
 * prefetch would burn a cold the data provider walk for every coin that scrolls
 * by. The live SOL balance is fetched separately once the trace
 * settles (never two cold walks racing server-side).
 */

// Small open delay: the dev chip sits in a dense metric row that the
// cursor crosses constantly — an instant-open card would flicker on
// every pass. 150ms is enough to signal intent without feeling gated.
const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 140;

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol >= 1_000) return sol.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (sol >= 100) return sol.toFixed(1);
  if (sol >= 1) return sol.toFixed(3);
  return sol.toFixed(4);
}

function formatUsd(value: number): string {
  if (value >= 1_000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (value >= 100) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

/** Largest-unit age: '2mo', '3d', '5h', '12m', 'now'. */
export function formatFundedAge(fundedAtMs: number, nowMs: number): string {
  const elapsedSec = Math.max(0, Math.floor((nowMs - fundedAtMs) / 1_000));
  const year = Math.floor(elapsedSec / 31_536_000);
  if (year >= 1) return `${year}y`;
  const month = Math.floor(elapsedSec / 2_592_000);
  if (month >= 1) return `${month}mo`;
  const day = Math.floor(elapsedSec / 86_400);
  if (day >= 1) return `${day}d`;
  const hour = Math.floor(elapsedSec / 3_600);
  if (hour >= 1) return `${hour}h`;
  const minute = Math.floor(elapsedSec / 60);
  if (minute >= 1) return `${minute}m`;
  return 'now';
}

const tileStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
  flex: 1,
};

function StatTile({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary: string;
}) {
  return (
    <div style={tileStyle}>
      <span
        className="flex items-center gap-1.5 text-[14px] font-semibold leading-none"
        style={{ color: 'var(--ink-0)' }}
      >
        {primary}
      </span>
      <span className="text-[11px] leading-none" style={{ color: 'var(--ink-3)' }}>
        {secondary}
      </span>
    </div>
  );
}

function CardBody({ wallet }: { wallet: string }) {
  const { data, loading, error } = useWalletFunding(wallet, true);
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    void navigator.clipboard?.writeText(wallet).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };

  const iconBtnCls =
    'inline-flex h-6 w-6 items-center justify-center rounded hover:bg-white/[0.06] transition-colors';
  const mutedIcon: CSSProperties = { width: 13, height: 13, color: 'var(--ink-2)' };

  return (
    <div
      className="flex w-[236px] flex-col gap-2.5"
      style={{ fontFamily: 'var(--mono)' }}
    >
      {/* Header: truncated address + copy | wallet profile */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className="truncate text-[13px] font-semibold leading-none"
            style={{ color: 'var(--ink-0)' }}
          >
            {shortAddress(wallet)}
          </span>
          <button
            type="button"
            aria-label={copied ? 'Copied' : 'Copy address'}
            className={iconBtnCls}
            onClick={copyAddress}
          >
            <Copy style={{ ...mutedIcon, color: copied ? 'var(--up)' : 'var(--ink-2)' }} />
          </button>
        </span>
        <button
          type="button"
          aria-label="Open wallet profile"
          className={iconBtnCls}
          onClick={() => openWalletProfile(wallet)}
        >
          <Search style={mutedIcon} />
        </button>
      </div>

      {/* Stat tiles: SOL balance + USD | funded age */}
      <div className="flex gap-2">
        <StatTile
          primary={
            <>
              <Wallet style={{ width: 14, height: 14, color: 'var(--ink-2)' }} />
              <Solana style={{ width: 12, height: 12 }} />
              <span className="truncate">{balancePrimary(data, loading, error)}</span>
            </>
          }
          secondary={balanceSecondary(data)}
        />
        <StatTile
          primary={
            <>
              <Clock style={{ width: 14, height: 14, color: 'var(--ink-2)' }} />
              <span className="truncate">{fundedPrimary(data, loading, error)}</span>
            </>
          }
          secondary="Funded"
        />
      </div>

      {/* Footer: Solscan link | funding source badge */}
      <div className="flex items-center justify-between gap-2">
        <a
          href={`https://solscan.io/account/${encodeURIComponent(wallet)}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on Solscan"
          className={iconBtnCls}
        >
          <ExternalLink style={mutedIcon} />
        </a>
        <FundingSourceBadge data={data} loading={loading} />
      </div>
    </div>
  );
}

function balancePrimary(data: WalletFunding | null, loading: boolean, error: string | null): string {
  if (loading) return '…';
  if (error || !data || data.solBalanceLamports === null) return '—';
  return formatSol(data.solBalanceLamports);
}

function balanceSecondary(data: WalletFunding | null): string {
  if (!data || data.solBalanceLamports === null) return '\u00a0';
  return formatUsd((data.solBalanceLamports / LAMPORTS_PER_SOL) * data.solUsd);
}

function fundedPrimary(data: WalletFunding | null, loading: boolean, error: string | null): string {
  if (loading) return '…';
  if (error || !data || data.fundedAtMs === null) return '—';
  return formatFundedAge(data.fundedAtMs, Date.now());
}

function FundingSourceBadge({
  data,
  loading,
}: {
  data: WalletFunding | null;
  loading: boolean;
}) {
  if (loading || !data) return null;
  // Direct funder only: exchange label when known, address otherwise.
  const originLabel = data.originSource;
  const label = originLabel ?? (data.funder ? shortAddress(data.funder) : null);
  if (!label) return null;
  const badge = (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-none"
      style={{
        borderColor: 'var(--hairline)',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--ink-0)',
      }}
    >
      {originLabel !== null ? <ExchangeIcon label={originLabel} size={13} /> : null}
      {label}
    </span>
  );
  // Unlabeled funders link straight to the funder wallet — tracing the
  // funding chain is the whole point of showing it.
  if (!originLabel && data.funder) {
    return (
      <a
        href={`https://solscan.io/account/${encodeURIComponent(data.funder)}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Open funder on Solscan"
      >
        {badge}
      </a>
    );
  }
  return badge;
}

export function WalletFundingHoverCard({
  wallet,
  children,
}: {
  wallet: string;
  /** Trigger element (the dev metric chip). Rendered via `asChild`. */
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  // Start the fetch the instant the pointer touches the chip: the trace
  // resolves during the 150ms open delay, so the opened card is already
  // populated. staleTime dedupes repeat passes over the same chip.
  const prefetch = () => {
    void queryClient.prefetchQuery(walletFundingQueryOptions(wallet, true));
  };
  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild onPointerEnter={prefetch} onFocus={prefetch}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-auto p-3 duration-100"
        /* The card floats above a clickable CoinCard — swallow pointer
           and keyboard events so interacting with it never triggers the
           card's quickbuy/navigation handlers. */
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CardBody wallet={wallet} />
      </HoverCardContent>
    </HoverCard>
  );
}
