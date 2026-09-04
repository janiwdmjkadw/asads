'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeWalletEntry } from '@/lib/api/me';
import type { SpotWalletAgg } from '@/lib/api/portfolio-spot';
import { formatUsd } from './format';
import './spot-ledger.css';

/**
 * Slice "Portfolio Spot tab": which wallets the page is showing.
 *
 * ── IT PICKS ANY NUMBER OF THEM ──────────────────────────────────────
 *
 * Three of your twenty is the normal case, and neither of the first two
 * attempts could do it. A strip of one chip per wallet is fine at three
 * and a horizontal scroll at fifty; a single-choice menu makes you look
 * at one wallet or all of them and nothing in between.
 *
 * So: checkboxes. `All wallets` at the top is the empty selection, and
 * ticking any wallet narrows to exactly what is ticked. The page reads
 * the subset out of the snapshot it already has — see `walletSubset.ts`
 * — so picking three is instant and cannot disagree with the total.
 *
 * ── NO SEARCH FIELD UNTIL THERE IS SOMETHING TO SEARCH ───────────────
 *
 * There was a box labelled `Filter` above four wallets, which is a
 * control that asks a question the list already answers. It appears at
 * TEN, where a list stops being scannable, and it says what it does.
 */

interface Props {
  readonly wallets: ReadonlyArray<MeWalletEntry>;
  readonly aggregates: ReadonlyArray<SpotWalletAgg>;
  /** Total across every wallet, for the `All wallets` row. */
  readonly totalUsd: number;
  /** Ticked ids. Empty means every wallet. */
  readonly selected: ReadonlyArray<string>;
  readonly onChange: (next: ReadonlyArray<string>) => void;
}

/** Above this many wallets the list stops being scannable. */
const SEARCH_AT = 10;

export function WalletSelect(props: Props): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const totalByWallet = useMemo<ReadonlyMap<string, number>>(() => {
    const m = new Map<string, number>();
    for (const a of props.aggregates) m.set(a.wallet_account_id, a.total_usd);
    return m;
  }, [props.aggregates]);

  const named = useMemo(
    () =>
      props.wallets.map((w, i) => ({
        id: w.wallet_account_id,
        label: w.label ?? (w.is_primary ? 'Primary' : `Wallet ${i + 1}`),
        usd: totalByWallet.get(w.wallet_account_id) ?? 0,
        archived: w.is_archived,
      })),
    [props.wallets, totalByWallet],
  );

  /* Matches the NAME only. Nobody types a pubkey from memory, and
     searching them turns three letters into a list of near misses. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return named;
    return named.filter((w) => w.label.toLowerCase().includes(q));
  }, [named, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (props.wallets.length < 2) return null;

  const picked = new Set(props.selected);
  const all = picked.size === 0;

  /* The trigger names what you are looking at. One wallet is worth
     naming; three is a count, because three names do not fit on a line
     and truncating them tells you less than the number does. */
  const shownTotal = all
    ? props.totalUsd
    : named.filter((w) => picked.has(w.id)).reduce((s, w) => s + w.usd, 0);
  const label = all
    ? 'All wallets'
    : picked.size === 1
      ? (named.find((w) => picked.has(w.id))?.label ?? '1 wallet')
      : `${picked.size} wallets`;

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    /* Every wallet ticked is the same view as none ticked, so it
       collapses back to "all" rather than leaving twenty boxes on. */
    props.onChange(next.size === named.length ? [] : [...next]);
  };

  return (
    <div className="wsel" ref={wrapRef}>
      <button
        type="button"
        className="wsel-t"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wsel-t-name">{label}</span>
        <span className="wsel-t-usd">{formatUsd(shownTotal)}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <div className="wsel-menu">
          {named.length >= SEARCH_AT ? (
            <input
              className="wsel-find"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search wallets"
              spellCheck={false}
              autoFocus
            />
          ) : null}

          <div className="wsel-list dk-scroll">
            <button
              type="button"
              className="wsel-row"
              aria-pressed={all}
              data-on={all ? '' : undefined}
              onClick={() => props.onChange([])}
            >
              <Box on={all} />
              <span className="wsel-row-name">All wallets</span>
              <span className="wsel-row-usd">{formatUsd(props.totalUsd)}</span>
            </button>

            {shown.length === 0 ? (
              <div className="wsel-none">No wallet by that name.</div>
            ) : (
              shown.map((w) => (
                <button
                  type="button"
                  key={w.id}
                  className="wsel-row"
                  aria-pressed={picked.has(w.id)}
                  data-on={picked.has(w.id) ? '' : undefined}
                  data-archived={w.archived ? '' : undefined}
                  onClick={() => toggle(w.id)}
                >
                  <Box on={picked.has(w.id)} />
                  <span className="wsel-row-name">{w.label}</span>
                  <span className="wsel-row-usd">{formatUsd(w.usd)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Empty or filled, the same box the wallets list uses. */
function Box({ on }: { on: boolean }) {
  return <span className="wsel-box" data-on={on ? '' : undefined} aria-hidden />;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="wsel-chev"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      aria-hidden
    >
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}
