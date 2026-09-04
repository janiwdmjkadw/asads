'use client';

/**
 * The result list (spec/10-system.md §1.4.5, L06) — the ONE object a
 * research result earns, holders first. A pearl pane under Soren's
 * sentence, rows of lanes, NO headers (the sentence is the title):
 *
 *   · ≤4 rows earn NO pane at all — the model's prose carries them.
 *   · exactly 5 → a 144px viewport (5×28 + 4×1), nothing hidden.
 *   · 6+ → a 159px clip that scrolls INSIDE itself with no scrollbar;
 *     the affordance is the half-visible row at the BOTTOM edge only.
 *     No fades ("why is it kind of dark at the bottom … just remove
 *     it"), no `show 20 ▸`.
 *   · after the conversation moves on the list FOLDS to one row —
 *     `top N holders ▸` plus the tracked mojis — and clicks back open.
 *
 * Lanes here are the holders lane: the W04 wallet tag in a fixed 134px
 * slot (the moji IS the tracked signal), the share in quiet ivory mono,
 * and — the wire's one live per-holder number — unrealized PnL at the
 * right edge under the colour law. The design's proposed time column has
 * no wire truth, so it is not drawn (§ Open: the time column's meaning
 * was never agreed).
 */

import { useState } from 'react';
import { useTrackedWallets } from '@/components/discover/trackedWallets';
import { shortAddress } from '@/lib/api/tracker';
import type { HolderRowView } from '@/lib/agent/view';

const ROW_LIMIT_FOR_PANE = 5;

function WalletCell({ owner, emoji }: { owner: string; emoji: string | null }) {
  return (
    <span className="ag-pane-wtag">
      {emoji !== null ? (
        <span className="ag-pane-wtag-moji" aria-hidden>
          {emoji}
        </span>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="ag-pane-wtag-glyph">
          <rect x="1.5" y="3.5" width="13" height="9" rx="2" fill="none" stroke="#E8E8E2" strokeWidth="1.3" />
          <rect x="9.5" y="6.5" width="4" height="3" rx="1" fill="#E8E8E2" />
        </svg>
      )}
      <span className="ag-pane-wtag-addr">{shortAddress(owner)}</span>
    </span>
  );
}

function pnlText(sol: number): string {
  const abs = Math.abs(sol);
  const fig = abs >= 100 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(2) : abs.toFixed(3);
  return `${sol < 0 ? '−' : '+'}${fig}`;
}

export function HoldersListPane({
  rows,
  folded: foldedInitially,
}: {
  rows: readonly HolderRowView[];
  /** True once the conversation has moved on — the pane starts folded. */
  folded: boolean;
}) {
  const [open, setOpen] = useState(!foldedInitially);
  const tracked = useTrackedWallets();
  const emojiByAddress = new Map<string, string>();
  for (const wallet of tracked.wallets) {
    const emoji = wallet.emoji?.trim();
    if (emoji !== undefined && emoji !== '') emojiByAddress.set(wallet.address, emoji);
  }

  // ≤4 rows: no object. The caller already gates on this, but the pane
  // enforces its own law so a future caller cannot un-decide it.
  if (rows.length <= 4) return null;

  if (!open) {
    const mojis = rows
      .map((r) => emojiByAddress.get(r.owner))
      .filter((e): e is string => e !== undefined);
    return (
      <button
        type="button"
        className="ag-pane-fold"
        data-testid="agent-holders-fold"
        onClick={() => setOpen(true)}
      >
        <span>top {rows.length} holders ▸</span>
        {mojis.length > 0 ? (
          <span className="ag-pane-fold-mojis" aria-hidden>
            {mojis.join(' ')}
          </span>
        ) : null}
      </button>
    );
  }

  const scrolls = rows.length > ROW_LIMIT_FOR_PANE;
  return (
    <div className="ag-pane" data-testid="agent-holders-pane">
      <div
        className={scrolls ? 'ag-pane-viewport ag-pane-viewport--scroll' : 'ag-pane-viewport'}
        data-scrolls={scrolls ? 'true' : undefined}
      >
        <div className="ag-pane-rows">
          {rows.map((row, i) => (
            <div key={`${row.owner}-${i}`} className="ag-pane-row" data-testid="agent-holders-row">
              <span className="ag-pane-slot">
                <WalletCell owner={row.owner} emoji={emojiByAddress.get(row.owner) ?? null} />
              </span>
              <span className="ag-pane-share">
                {row.supplyPct !== null ? `${row.supplyPct.toFixed(1)}%` : '—'}
              </span>
              <span className="ag-pane-spacer" />
              {row.unrealizedPnlSol !== null ? (
                <span className="ag-pane-pnl" data-tone={row.unrealizedPnlSol < 0 ? 'red' : 'green'}>
                  {pnlText(row.unrealizedPnlSol)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * The remaining lanes — trades, tokens, compare — on the same L06
 * skeleton. Lanes carry what their wire actually says:
 *   trades  · time (green, relative) · the side WORD under the colour
 *             law · the SOL amount with the drawn mark · the
 *             counterparty tag (tape/tracked) or the token (own fills,
 *             which have no counterparty address on the wire)
 *   tokens  · the symbol tag · mcap · 1h vol · age — the screener wire
 *             carries NO price and NO change, so those lanes are not
 *             drawn rather than faked
 *   compare · C06: the label lane, two value columns headed by wallet
 *             tags, one divider, no delta column — the wire's four
 *             metrics (PnL · volume · trades · lifetime PnL) clear the
 *             ≤3-metric no-pane rule
 * ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { Solana } from '@/components/listen/icons/Icons';
import type { CompareWalletView, TokenRowView, TradeRowView } from '@/lib/agent/view';

/** `0.25` · `12.4` · `312` — display precision for a SOL figure. */
function fmtSol(lamports: number): string {
  const sol = lamports / 1e9;
  const abs = Math.abs(sol);
  if (abs >= 100) return sol.toFixed(0);
  if (abs >= 1) return sol.toFixed(2);
  return sol.toFixed(3);
}

function fmtSignedSol(sol: number): string {
  const abs = Math.abs(sol);
  const fig = abs >= 100 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(2) : abs.toFixed(3);
  return `${sol < 0 ? '−' : '+'}${fig}`;
}

/** `5m` · `2h` · `3d` — the reader-relative age, spans-green by class. */
function agoText(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function compactUsdShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function FoldRow({
  label,
  mojis,
  onOpen,
  testId,
}: {
  label: string;
  mojis: readonly string[];
  onOpen: () => void;
  testId: string;
}) {
  return (
    <button type="button" className="ag-pane-fold" data-testid={testId} onClick={onOpen}>
      <span>{label} ▸</span>
      {mojis.length > 0 ? (
        <span className="ag-pane-fold-mojis" aria-hidden>
          {mojis.join(' ')}
        </span>
      ) : null}
    </button>
  );
}

/** The L06 viewport laws, shared: 144 exactly-five, 159 scrolling. */
function ListShell({ scrolls, children }: { scrolls: boolean; children: ReactNode }) {
  return (
    <div className="ag-pane">
      <div
        className={scrolls ? 'ag-pane-viewport ag-pane-viewport--scroll' : 'ag-pane-viewport'}
        data-scrolls={scrolls ? 'true' : undefined}
      >
        <div className="ag-pane-rows">{children}</div>
      </div>
    </div>
  );
}

export function TradesListPane({
  rows,
  folded: foldedInitially,
}: {
  rows: readonly TradeRowView[];
  folded: boolean;
}) {
  const [open, setOpen] = useState(!foldedInitially);
  const tracked = useTrackedWallets();
  const emojiByAddress = new Map<string, string>();
  for (const wallet of tracked.wallets) {
    const emoji = wallet.emoji?.trim();
    if (emoji !== undefined && emoji !== '') emojiByAddress.set(wallet.address, emoji);
  }
  if (rows.length <= 4) return null;
  if (!open) {
    const mojis = rows
      .map((r) => (r.wallet === null ? undefined : emojiByAddress.get(r.wallet)))
      .filter((e): e is string => e !== undefined);
    return (
      <FoldRow
        label={`${rows.length} trades`}
        mojis={[...new Set(mojis)]}
        onOpen={() => setOpen(true)}
        testId="agent-trades-fold"
      />
    );
  }
  const nowMs = Date.now();
  return (
    <div data-testid="agent-trades-pane">
      <ListShell scrolls={rows.length > 5}>
        {rows.map((row, i) => (
          <div key={i} className="ag-pane-row" data-testid="agent-trades-row">
            <span className="ag-pane-time">{row.timeMs !== null ? agoText(row.timeMs, nowMs) : '—'}</span>
            <span className="ag-pane-side" data-tone={row.side === 'buy' ? 'green' : 'red'}>
              {row.side}
            </span>
            <span className="ag-pane-sol">
              {row.solLamports !== null ? (
                <>
                  {fmtSol(row.solLamports)}
                  <Solana className="ag-pane-solmark" aria-label="SOL" />
                </>
              ) : (
                '—'
              )}
            </span>
            <span className="ag-pane-spacer" />
            {row.wallet !== null ? (
              <WalletCell owner={row.wallet} emoji={emojiByAddress.get(row.wallet) ?? null} />
            ) : row.mint !== null ? (
              <span className="ag-pane-mint">{`${row.mint.slice(0, 4)}…${row.mint.slice(-4)}`}</span>
            ) : null}
          </div>
        ))}
      </ListShell>
    </div>
  );
}

export function TokensListPane({
  rows,
  folded: foldedInitially,
}: {
  rows: readonly TokenRowView[];
  folded: boolean;
}) {
  const [open, setOpen] = useState(!foldedInitially);
  if (rows.length <= 4) return null;
  if (!open) {
    return (
      <FoldRow
        label={`${rows.length} tokens`}
        mojis={[]}
        onOpen={() => setOpen(true)}
        testId="agent-tokens-fold"
      />
    );
  }
  const nowMs = Date.now();
  return (
    <div data-testid="agent-tokens-pane">
      <ListShell scrolls={rows.length > 5}>
        {rows.map((row) => (
          <div key={row.mint} className="ag-pane-row" data-testid="agent-tokens-row">
            <span className="ag-pane-symslot">
              <span className="ag-pane-sym">
                {row.symbol !== null ? `$${row.symbol}` : (row.name ?? `${row.mint.slice(0, 4)}…`)}
              </span>
            </span>
            <span className="ag-pane-share">
              {row.mcapUsd !== null ? compactUsdShort(row.mcapUsd) : '—'}
            </span>
            <span className="ag-pane-vol">
              {row.vol1hUsd !== null ? compactUsdShort(row.vol1hUsd) : ''}
            </span>
            <span className="ag-pane-spacer" />
            {row.ageMs !== null ? (
              <span className="ag-pane-time">{agoText(nowMs - row.ageMs, nowMs)}</span>
            ) : null}
          </div>
        ))}
      </ListShell>
    </div>
  );
}

export function ComparePane({
  wallets,
  folded: foldedInitially,
}: {
  wallets: readonly CompareWalletView[];
  folded: boolean;
}) {
  const [open, setOpen] = useState(!foldedInitially);
  const tracked = useTrackedWallets();
  const emojiByAddress = new Map<string, string>();
  for (const wallet of tracked.wallets) {
    const emoji = wallet.emoji?.trim();
    if (emoji !== undefined && emoji !== '') emojiByAddress.set(wallet.address, emoji);
  }
  if (wallets.length !== 2) return null;
  const [a, b] = wallets;
  if (!open) {
    const nameOf = (w: CompareWalletView) => w.label ?? shortAddress(w.address);
    return (
      <FoldRow
        label={`${nameOf(a)} vs ${nameOf(b)}`}
        mojis={[]}
        onOpen={() => setOpen(true)}
        testId="agent-compare-fold"
      />
    );
  }
  const metric = (
    label: string,
    of: (w: CompareWalletView) => number | null,
    kind: 'sol-signed' | 'sol' | 'count',
  ) => {
    const cell = (w: CompareWalletView) => {
      const v = of(w);
      if (v === null) return <span className="ag-cmp-v">—</span>;
      if (kind === 'count') return <span className="ag-cmp-v">{v}</span>;
      const text = kind === 'sol-signed' ? fmtSignedSol(v) : fmtSol(v * 1e9);
      const tone = kind === 'sol-signed' ? (v < 0 ? 'red' : 'green') : undefined;
      return (
        <span className="ag-cmp-v" data-tone={tone}>
          {text}
          <Solana className="ag-pane-solmark" aria-label="SOL" />
        </span>
      );
    };
    // Both null → the row says nothing; skip it entirely.
    if (of(a) === null && of(b) === null) return null;
    return (
      <div className="ag-cmp-row" key={label}>
        <span className="ag-cmp-k">{label}</span>
        <span className="ag-cmp-a">{cell(a)}</span>
        <span className="ag-cmp-div" aria-hidden />
        <span className="ag-cmp-b">{cell(b)}</span>
      </div>
    );
  };
  const head = (w: CompareWalletView) => (
    <WalletCell owner={w.address} emoji={emojiByAddress.get(w.address) ?? null} />
  );
  const rows = [
    metric('PnL', (w) => w.pnlSol, 'sol-signed'),
    metric('volume', (w) => w.volumeSol, 'sol'),
    metric('trades', (w) => w.trades, 'count'),
    metric('lifetime PnL', (w) => w.lifetimePnlSol, 'sol-signed'),
  ].filter((r) => r !== null);
  // ≤3 metrics with anything to say → the sentence carries it (C06).
  if (rows.length <= 3) return null;
  return (
    <div className="ag-pane" data-testid="agent-compare-pane">
      <div className="ag-cmp-row ag-cmp-row--head">
        <span className="ag-cmp-k" />
        <span className="ag-cmp-a">{head(a)}</span>
        <span className="ag-cmp-div" aria-hidden />
        <span className="ag-cmp-b">{head(b)}</span>
      </div>
      {rows}
    </div>
  );
}
