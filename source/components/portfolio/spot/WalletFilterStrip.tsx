'use client';

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { MeWalletEntry } from '@/lib/api/me';
import type { SpotWalletAgg } from '@/lib/api/portfolio-spot';
import { formatUsd } from './format';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": the wallet filter.
 *
 * One name per wallet with its total under it. Selection drives the
 * `wallet_account_id` filter on /spot, /transactions and /performance,
 * reshaping the whole view; the live one is the white one. The strip
 * scrolls sideways so ten wallets never widen the page.
 *
 * ── THE CONFETTI IS GONE ─────────────────────────────────────────────
 *
 * Every wallet hashed to one of eight colours — green, blue, cyan,
 * pink, amber, teal, violet, lime — drawn as a 4px tick in front of its
 * name, with the live chip taking a 48% ring and a 12% fill of that
 * same colour, over a frosted 8px backdrop.
 *
 * The colour identified a wallet you had already named yourself, and it
 * ran on the one page in the product that is meant to be shown to other
 * people, next to figures whose green and red mean gain and loss. Eight
 * decorative hues beside two meaningful ones is how a page stops being
 * readable. Names identify wallets. That is what names are.
 */

interface Props {
  readonly wallets: ReadonlyArray<MeWalletEntry>;
  readonly aggregates: ReadonlyArray<SpotWalletAgg>;
  readonly totalUsd: number;
  readonly selected: string | null; // wallet_account_id, or null = All
  readonly onSelect: (next: string | null) => void;
  readonly className?: string;
}

export function WalletFilterStrip(props: Props): React.ReactElement | null {
  const totalByWallet = useMemo<ReadonlyMap<string, number>>(() => {
    const m = new Map<string, number>();
    for (const a of props.aggregates) m.set(a.wallet_account_id, a.total_usd);
    return m;
  }, [props.aggregates]);
  // Only show the strip when the user has 2+ wallets — a single
  // wallet user gets no value from the filter.
  if (props.wallets.length < 2) return null;
  return (
    <div className={props.className ?? ''} style={rowStyle}>
      <WalletChip
        active={props.selected === null}
        label="All"
        sub={formatUsd(props.totalUsd)}
        onClick={() => props.onSelect(null)}
      />
      {props.wallets.map((w, i) => (
        <WalletChip
          key={w.wallet_account_id}
          active={props.selected === w.wallet_account_id}
          label={w.label ?? (w.is_primary ? 'Primary' : `Wallet ${i + 1}`)}
          sub={formatUsd(totalByWallet.get(w.wallet_account_id) ?? 0)}
          dim={w.is_archived}
          onClick={() => props.onSelect(w.wallet_account_id)}
        />
      ))}
    </div>
  );
}

function WalletChip(props: {
  readonly active: boolean;
  readonly label: string;
  readonly sub: string;
  readonly dim?: boolean;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="spl-wchip"
      onClick={props.onClick}
      aria-pressed={props.active}
      data-on={props.active ? '' : undefined}
      title={`${props.label} · ${props.sub}`}
      style={props.dim ? { opacity: 0.5 } : undefined}
    >
      <span>{props.label}</span>
      <small>{props.sub}</small>
    </button>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
};
