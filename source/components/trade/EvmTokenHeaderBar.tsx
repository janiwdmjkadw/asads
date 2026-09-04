'use client';

/**
 * EVM token header bar — the exact visual frame of the Solana page's
 * `TokenHeaderBar`, with an EVM binding (trade-page unification, phase 2).
 *
 * EXACT-FRAME, not a reuse of `TokenHeaderBar` itself, for one doctrinal
 * reason: that component consumes `MockToken`/`VolSnapshot`, whose counts and
 * money strings are REQUIRED numbers — it has no way to say "unmeasured", so
 * feeding it a partial-history EVM token would render fabricated zeros
 * (`Buys 0/$0` about a token whose counts the fold withheld). Its meta row and
 * call button are also Solana-bound (`CallCoinButton` posts alpha calls keyed
 * by mint; `TokenMetaRow` renders Solana platform/source affordances). The
 * layout skeleton, spacing and primitives here mirror it line for line —
 * `panel` frame, left identity cluster, bordered center MC/Price/Liquidity/ATH
 * grid, right stats column with the buy/sell ratio bar — so the two pages read
 * as one terminal.
 *
 * Doctrine, unchanged from the page this serves: absent is never zero, every
 * absent figure renders an em dash, and no unit is asserted the wire did not
 * carry.
 */

import { useState } from 'react';
import { Caption, HairlineDivider, Numeral, Stat } from '@/components/listen/primitives';
import { EvmLaunchpadBadge } from '@/components/discover/EvmLaunchpadBadge';
import { compactNumber } from '@/lib/format';
import { useColorCycle, type ColorStop } from './useColorCycle';
import { explorerAddressUrl, explorerName } from '@/lib/evm/explorer';
import type { EvmCardView } from '@/lib/evm/discoverAdapter';
import type { EvmStreamStatus } from '@/lib/evm/stream';

/* Same three-stop MC rotation as the Solana bar — motion, not status. */
const MC_CYCLE: readonly ColorStop[] = [
  { color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.35)' },
  { color: '#fb923c', glow: 'rgba(251, 146, 60, 0.35)' },
  { color: '#22c77e', glow: 'rgba(52, 211, 153, 0.35)' },
];

export interface EvmTokenHeaderBarProps {
  view: EvmCardView;
  /** Storage tag — explorer links; unknown chains link nowhere. */
  chain: string;
  chainLabel: string;
  stageLabel: string;
  /** The page-resolved price (last trade → wire → curve), or null. */
  priceText: string | null;
  priceSourceText: string | null;
  streamStatus: EvmStreamStatus | null;
  live: boolean;
}

export function EvmTokenHeaderBar({
  view,
  chain,
  chainLabel,
  stageLabel,
  priceText,
  priceSourceText,
  streamStatus,
  live,
}: EvmTokenHeaderBarProps) {
  return (
    <div
      className="panel flex w-full shrink-0 flex-nowrap items-center gap-x-3 px-5 py-4 xl:gap-x-6"
      data-testid="evm-token-header"
    >
      <LeftCluster
        view={view}
        chain={chain}
        chainLabel={chainLabel}
        stageLabel={stageLabel}
        streamStatus={streamStatus}
        live={live}
      />

      {/* Flexible gaps keep the three clusters in ONE row at every width —
          same compression behavior as the Solana bar. */}
      <div className="min-w-0 flex-1" />
      <CenterCluster view={view} priceText={priceText} priceSourceText={priceSourceText} />
      <div className="min-w-0 flex-1" />
      <ActivityStats view={view} />
    </div>
  );
}

function LeftCluster({
  view,
  chain,
  chainLabel,
  stageLabel,
  streamStatus,
  live,
}: {
  view: EvmCardView;
  chain: string;
  chainLabel: string;
  stageLabel: string;
  streamStatus: EvmStreamStatus | null;
  live: boolean;
}) {
  const explorerUrl = explorerAddressUrl(chain, view.address);
  return (
    <div className="flex min-w-0 items-center gap-3 xl:gap-5">
      <TokenAvatar
        key={view.imageUrl ?? 'no-image'}
        imageUrl={view.imageUrl}
        ticker={view.ticker}
      />

      <div className="flex min-w-0 items-center gap-2.5">
        <span className="t-display max-w-[16ch] shrink-0 truncate">{view.ticker}</span>
        {view.name !== view.ticker && (
          <span
            className="hidden min-w-0 max-w-[22ch] truncate text-[17px] md:inline"
            style={{ color: 'var(--ink-2)', fontWeight: 400, lineHeight: '26px' }}
          >
            {view.name}
          </span>
        )}
      </div>

      <span className="hidden sm:inline-flex">
        <HairlineDivider orientation="v" length={28} />
      </span>

      {/* The EVM meta row: chain + stage chips, the contract address with its
          copy control and explorer link, and the stream chip. Same slot the
          Solana bar gives `TokenMetaRow`. */}
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 text-xs"
        style={{ color: 'var(--ink-2)' }}
      >
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">{chainLabel}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs" data-testid="evm-trade-stage">
          {stageLabel}
        </span>
        {view.launchpad !== null && view.launchVariant !== null && (
          <EvmLaunchpadBadge
            chain={chain}
            launchpad={view.launchpad}
            launchVariant={view.launchVariant}
            profile={view.launchProfile}
          />
        )}
        <span className="font-mono" title={view.address}>
          {shortEvmAddress(view.address)}
        </span>
        <CopyAddressButton address={view.address} />
        {explorerUrl !== null && (
          /* An unknown chain gets NO link, never a guessed explorer URL. */
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 underline underline-offset-2"
            data-testid="evm-trade-address-explorer"
          >
            {explorerName(chain) ?? 'explorer'}
          </a>
        )}
        <StreamChip status={streamStatus} live={live} />
      </div>
    </div>
  );
}

function CenterCluster({
  view,
  priceText,
  priceSourceText,
}: {
  view: EvmCardView;
  priceText: string | null;
  priceSourceText: string | null;
}) {
  const mc = useColorCycle(MC_CYCLE, 4000);
  /* USD when the oracle backed one, native otherwise, em dash when neither —
     never derived here. The audit trail rides the title. */
  const mcText = view.marketCapUsdText ?? view.marketCapNativeText ?? '—';
  const liquidityText = view.reserveNativeText ?? '—';
  return (
    <div
      className="grid shrink-0 gap-x-4 xl:gap-x-8 xl:border-x xl:border-[var(--hairline)] xl:px-5"
      style={{
        gridTemplateColumns: 'repeat(4, auto)',
        rowGap: '0.375rem',
        alignItems: 'center',
        justifyItems: 'center',
      }}
    >
      <Caption size="lg">MC</Caption>
      <Caption size="lg">Price</Caption>
      <Caption size="lg">Liquidity</Caption>
      <Caption size="lg">ATH</Caption>

      <Numeral
        size="hero"
        style={{
          color: mc.color,
          textShadow: `0 0 10px ${mc.glow}`,
          transition: 'color 1200ms ease, text-shadow 1200ms ease',
        }}
      >
        {/* The audit trail rides the title — a USD figure a user can inspect. */}
        <span title={view.nativeUsdBasisText ?? undefined}>{mcText}</span>
      </Numeral>
      <Numeral size="display" tone="ink-1">
        <span
          data-testid="evm-trade-price"
          data-price-source={priceSourceText ?? undefined}
          title={priceSourceText === null ? undefined : `Price from ${priceSourceText}.`}
        >
          {view.priceUsdText ?? priceText ?? '—'}
        </span>
      </Numeral>
      <Numeral size="display" tone="primary">
        <span title={view.reserveBasisText ?? undefined}>{liquidityText}</span>
      </Numeral>
      {/* ATH is a measurement this wire does not carry — an em dash, never a
          recycled current MC. */}
      <Numeral size="display" tone="up">
        —
      </Numeral>
    </div>
  );
}

/**
 * The right stats column — the frame `VolStats` gives the Solana bar, bound
 * to what the EVM fold measures: cumulative volume and buy/sell COUNTS. On a
 * partial history the counts are withheld upstream (`null`), so they render
 * as em dashes and the ratio bar stays neutral 50/50 — never a one-sided
 * collapse fabricated from zeros.
 */
function ActivityStats({ view }: { view: EvmCardView }) {
  const buys = view.buyCount;
  const sells = view.sellCount;
  const total = (buys ?? 0) + (sells ?? 0);
  const buyPct = buys === null || sells === null || total === 0 ? 50 : (buys / total) * 100;
  const volText = view.volumeUsdText ?? view.volumeNativeText ?? '—';
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-end gap-4 xl:gap-7">
        <Stat label="Vol" value={volText} valueTone="ink-1" />
        <Stat
          label="Buys"
          value={buys === null ? '—' : compactNumber(buys)}
          valueTone="up"
        />
        <Stat
          label="Sells"
          value={sells === null ? '—' : compactNumber(sells)}
          valueTone="down"
        />
        <Stat
          label="Trades"
          value={view.tradeCount === null ? '—' : compactNumber(view.tradeCount)}
          valueTone="ink-1"
        />
      </div>
      <div className="flex h-[2px] overflow-hidden rounded-full" aria-hidden>
        <div
          style={{
            width: `${buyPct}%`,
            background: 'var(--up)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--up) 70%, transparent)',
            transition: 'width 200ms var(--ease-out)',
          }}
        />
        <div
          style={{
            flex: 1,
            background: 'var(--down)',
            boxShadow: '0 0 6px color-mix(in srgb, var(--down) 70%, transparent)',
          }}
        />
      </div>
    </div>
  );
}

function shortEvmAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The token's image, or an initial-letter placeholder — moved here from
 * `EvmTradePage` with its testids intact (the render tests pin them), sized
 * to the Solana bar's 52px avatar.
 */
export function TokenAvatar({ imageUrl, ticker }: { imageUrl: string | null; ticker: string }) {
  const [broken, setBroken] = useState(false);
  if (imageUrl === null || broken) {
    return (
      <span
        aria-hidden="true"
        data-testid="evm-token-avatar-fallback"
        className="flex shrink-0 items-center justify-center rounded-[var(--r-md)] bg-muted text-lg font-bold text-muted-foreground"
        style={{ width: 52, height: 52 }}
      >
        {ticker.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // A plain <img> on purpose: an upstream-resolved token URI on an
    // arbitrary host, not an asset next/image is configured for.
    <img
      src={imageUrl}
      alt=""
      onError={() => setBroken(true)}
      data-testid="evm-token-avatar"
      className="shrink-0 rounded-[var(--r-md)] object-cover"
      style={{ width: 52, height: 52 }}
    />
  );
}

/** Copy the contract address — the one thing every memecoin flow needs. */
export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="evm-copy-address"
      title="Copy contract address"
      className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
      onClick={() => {
        const clipboard = globalThis.navigator?.clipboard;
        if (clipboard === undefined) return;
        clipboard.writeText(address).then(
          () => {
            setCopied(true);
            globalThis.setTimeout(() => setCopied(false), 1_500);
          },
          () => {
            // A denied clipboard is a no-op, not a crash. The button simply
            // never claims "Copied" for a copy that did not happen.
          },
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Stream state, with every counter in the tooltip. A silent failure is a defect. */
export function StreamChip({
  status,
  live,
}: {
  status: EvmStreamStatus | null;
  live: boolean;
}) {
  if (!live) return null;
  const phase = status?.phase ?? 'connecting';
  const counters = status?.counters;
  return (
    <span
      className="text-[10px]"
      data-testid="evm-trade-stream"
      data-phase={phase}
      style={{
        fontFamily: 'var(--mono)',
        color: phase === 'live' ? 'var(--positive, #37c07a)' : 'var(--ink-2)',
      }}
      title={
        counters === undefined
          ? 'Stream has not reported yet.'
          : `frames ${counters.framesApplied} · gaps ${counters.gaps} · ring lapses ${counters.ringLapped} · epoch changes ${counters.epochChanges} · reconnects ${counters.reconnects} · transport errors ${counters.transportErrors} · malformed ${counters.framesMalformed} · foreign-chain ${counters.framesForeignChain}`
      }
    >
      ● {phase}
    </span>
  );
}
