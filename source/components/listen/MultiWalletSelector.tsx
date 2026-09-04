'use client';

import { useMemo, type CSSProperties } from 'react';
import { useOpenSetupForWallet } from '@/lib/state/wallet-setup-store';
import { AgentBadge } from '@/components/portfolio/AgentBadge';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import {
  isEligibleWallet,
  pickDefaultSelectedWallet,
  useSelectedWalletStore,
} from '@/lib/state/selected-wallet-store';
import { walletDisplayName } from './WalletSelector';
import { Solana } from './icons/Icons';
import { formatLamportsBigInt, useMultiWalletSolBalance } from './useMultiWalletSolBalance';
import {
  formatSol,
  formatTokenAmount,
  useMintWalletHoldings,
  WalletRebalanceActions,
} from '@/components/trade/walletRebalance';

/**
 * Slice "Multi-wallet split buy/sell orders": checkbox-list wallet
 * selector for batch trade mode. Sibling of the single-mode
 * `WalletSelector` (which keeps its dropdown semantics) so each
 * UX paradigm stays self-contained.
 *
 * Layout ("dense ledger", 2026-07 redesign): the selector owns the
 * whole popover body — title + count + All/Clear header, one-LINE
 * rows (name ★ + pubkey tail | SOL | tokens) under a slim column
 * header, and the Split/Aggregate footer. Rows are a fixed single
 * line so late-arriving balances never reflow the list. Callers
 * render it edge-to-edge (container padding 0).
 *
 * Features:
 *   - Multi-select via checkboxes; selection is mirrored to
 *     `multiSelectedWalletAccountIds` in the zustand store.
 *   - Non-trade-ready wallets are rendered but visually-disabled
 *     with a "setup" link. They are excluded from "All".
 *   - "All" (eligible) / "Clear" affordances for high N.
 *   - Scrollable list region with a fixed max height so 50–100
 *     rows do not blow up the panel.
 *
 * Invariant enforced here:
 *   - The selection set must never become empty. "Clear" falls back
 *     to `[primary]`, never `[]`. Unchecking the last selected wallet
 *     is treated the same as Clear.
 */

export interface MultiWalletSelectorProps {
  variant?: 'panel' | 'compact';
  className?: string;
  style?: CSSProperties;
  /** Maximum wallets the user may select. Surfaced from env via
   *  the caller (TradePanel) so the cap line matches the api/ cap. */
  maxWallets?: number;
  /** Trade-page mint. When set, each row shows the wallet's SOL +
   *  this-mint token balance, and the Split/Aggregate actions render. */
  mint?: string | null;
}

/** Muted tail of the pubkey — enough chars to eyeball-match a wallet
 *  without crowding the balance columns. */
function pubkeyTail(pubkey: string): string {
  return `…${pubkey.slice(-4)}`;
}

/** Grid template shared by the column header and every row so the
 *  columns stay aligned: check | name | SOL | tokens. Without a mint
 *  there are no balance columns. */
function rowGridColumns(hasMint: boolean): string {
  /*
   * WITHOUT A MINT THE ROW STILL GETS A FIGURE COLUMN.
   *
   * It used to be `15px minmax(0, 1fr)` — a check and a name and nothing
   * else — so the picker off the sub-header strip listed wallets with no
   * way to tell which of them could cover the buy. That is the only
   * question this list is opened to answer.
   *
   * The mint-ful form keeps its two columns: on the trade page the token
   * balance means "how much of THIS coin does this wallet hold", which
   * is what a sell is decided on.
   */
  return hasMint ? '15px minmax(0, 1fr) 70px 62px' : '15px minmax(0, 1fr) auto';
}

export function MultiWalletSelector(
  props: MultiWalletSelectorProps = {},
): React.ReactElement | null {
  const { data } = useMe();
  const variant = props.variant ?? 'panel';
  const selectedIds = useSelectedWalletStore((s) => s.multiSelectedWalletAccountIds);
  const setMultiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.setMultiSelectedWalletAccountIds,
  );
  const eligible = useMemo<ReadonlyArray<MeWalletEntry>>(() => {
    if (!data || data.reauth_required) return [];
    return data.wallets.filter(isEligibleWallet);
  }, [data]);
  // Balances are only fetched when a mint is provided (trade page); the
  // selector mounts with its popover, so mount ≙ open.
  const mint = props.mint ?? null;
  const holdings = useMintWalletHoldings(mint, eligible, eligible.length > 0);
  const openSetupFor = useOpenSetupForWallet();

  if (eligible.length === 0) return null;

  const selectedSet = new Set(selectedIds);
  const tradeReadyIds = eligible
    .filter((w) => w.trade_ready)
    .map((w) => w.wallet_account_id);
  const cap = typeof props.maxWallets === 'number' ? props.maxWallets : 100;
  const wouldExceedCap = selectedSet.size >= cap;
  // Invariant: the selection set must always have ≥ 1 entry. The
  // primary is the canonical fallback when the user would otherwise
  // leave the set empty (unchecks the last wallet, clicks Clear).
  const fallbackPrimaryId =
    pickDefaultSelectedWallet(eligible)?.wallet_account_id ?? null;

  const toggle = (walletAccountId: string, isReady: boolean) => {
    if (selectedSet.has(walletAccountId)) {
      const next = selectedIds.filter((id) => id !== walletAccountId);
      // Reseed with primary if the user just unchecked the last
      // selected wallet — the spec requires the set to stay non-empty.
      setMultiSelectedWalletAccountIds(next, fallbackPrimaryId);
      return;
    }
    if (!isReady) return;
    if (wouldExceedCap) return;
    setMultiSelectedWalletAccountIds([...selectedIds, walletAccountId], fallbackPrimaryId);
  };

  const selectAllEligible = () => {
    const next = tradeReadyIds.slice(0, cap);
    setMultiSelectedWalletAccountIds(next, fallbackPrimaryId);
  };

  // "Clear" never empties the set — it falls back to [primary] so the
  // trade form always has at least one wallet to submit through.
  const clear = () => setMultiSelectedWalletAccountIds([], fallbackPrimaryId);

  const gridColumns = rowGridColumns(mint !== null);

  /*
   * Balances for EVERY listed wallet, not just the selected ones. The
   * hook already returns a per-wallet map; the wallet chip above only
   * ever asks it for the current selection, which is why the number for
   * an unticked wallet was never on hand.
   */
  const listedIds = useMemo(() => eligible.map((w) => w.wallet_account_id), [eligible]);
  const rowBalances = useMultiWalletSolBalance(listedIds);

  return (
    <div
      data-testid="multi-wallet-selector"
      className={props.className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--sans)',
        ...props.style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <span style={{ color: 'var(--ink-0)', fontSize: 13, fontWeight: 600 }}>Wallets</span>
        <span
          data-testid="multi-wallet-count"
          style={{
            marginLeft: 8,
            color: 'var(--ink-3)',
            fontWeight: 400,
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11,
            letterSpacing: 0.3,
          }}
        >
          {selectedSet.size}/{cap}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button
            type="button"
            data-testid="multi-wallet-select-all"
            onClick={selectAllEligible}
            disabled={tradeReadyIds.length === 0}
            style={linkButtonStyle(tradeReadyIds.length === 0)}
          >
            All
          </button>
          <button
            type="button"
            data-testid="multi-wallet-clear"
            onClick={clear}
            disabled={selectedSet.size === 0}
            style={linkButtonStyle(selectedSet.size === 0)}
          >
            Clear
          </button>
        </div>
      </div>
      {mint !== null ? (
        <div
          aria-hidden
          style={{
            display: 'grid',
            gridTemplateColumns: gridColumns,
            gap: 8,
            padding: '7px 14px',
            alignItems: 'center',
            color: 'var(--ink-3)',
            fontSize: 9.5,
            fontFamily: 'var(--font-mono, monospace)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          <span />
          <span>wallet</span>
          <span style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Solana style={{ width: 12, height: 12 }} />
          </span>
          <span style={{ textAlign: 'right' }}>tokens</span>
        </div>
      ) : null}
      <div
        role="listbox"
        aria-label="Wallets for batch trade"
        data-testid="multi-wallet-list"
        style={{
          maxHeight: variant === 'panel' ? 300 : 290,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {eligible.map((wallet) => {
          const isChecked = selectedSet.has(wallet.wallet_account_id);
          const isReady = wallet.trade_ready;
          const disabled = !isReady || (!isChecked && wouldExceedCap);
          const holding = holdings.byWalletId.get(wallet.wallet_account_id);
          return (
            <label
              key={wallet.wallet_account_id}
              data-testid={`multi-wallet-row-${wallet.wallet_account_id}`}
              data-trade-ready={isReady}
              style={{
                display: 'grid',
                gridTemplateColumns: gridColumns,
                alignItems: 'center',
                gap: 8,
                padding: '9px 14px',
                background: isChecked ? 'var(--accent-soft)' : 'transparent',
                opacity: !isReady ? 0.5 : 1,
                cursor: disabled && !isChecked ? 'not-allowed' : 'pointer',
                userSelect: 'none',
                color: 'var(--ink-0)',
              }}
              title={
                !isReady
                  ? wallet.purpose === 'agent'
                    ? 'Agent wallet needs setup (authorization or nonce pool)'
                    : 'Wallet needs trading setup (nonce setup or backup)'
                  : wouldExceedCap && !isChecked
                    ? `Already at the batch cap of ${cap} wallets`
                    : ''
              }
            >
              {/* Native input kept for a11y/tests but visually replaced
                  by the themed check so the popover matches the rest of
                  the terminal chrome. */}
              <span style={{ position: 'relative', display: 'inline-flex', width: 15, height: 15 }}>
                <input
                  type="checkbox"
                  data-testid={`multi-wallet-check-${wallet.wallet_account_id}`}
                  checked={isChecked}
                  disabled={disabled && !isChecked}
                  onChange={() => toggle(wallet.wallet_account_id, isReady)}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    margin: 0,
                    cursor: 'inherit',
                  }}
                />
                <CheckGlyph on={isChecked} />
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                <span
                  // The name column is narrow once the balance/token
                  // columns are present, so any long label ellipsises.
                  // The title keeps it readable on hover.
                  title={walletDisplayName(wallet)}
                  style={{
                    fontSize: 13,
                    color: 'var(--ink-0)',
                    fontWeight: isChecked ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {walletDisplayName(wallet)}
                </span>
                {wallet.purpose === 'agent' ? <AgentBadge /> : null}
                {wallet.is_primary ? (
                  <span aria-hidden title="Primary wallet" style={{ color: 'var(--accent-primary)', fontSize: 11, flexShrink: 0 }}>
                    ★
                  </span>
                ) : null}
                {isReady ? (
                  // The agent row drops its address tail. The badge
                  // already identifies it and there is only ever ONE, so
                  // the tail buys no distinguishing power — while the
                  // ~50px it costs truncated "Agent wallet" to "Ag…" in
                  // this compact row.
                  wallet.purpose === 'agent' ? null : (
                    <span
                      title={wallet.wallet_pubkey}
                      style={{
                        color: 'var(--ink-3)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 10,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {pubkeyTail(wallet.wallet_pubkey)}
                    </span>
                  )
                ) : (
                  /* Opens the global nonce-setup modal — or the agent
                     wallet's own ceremony, which is the only place that
                     one's readiness can be fixed. preventDefault stops
                     the wrapping <label> from toggling the checkbox. */
                  <span
                    role="button"
                    tabIndex={0}
                    title={
                      wallet.purpose === 'agent'
                        ? 'Finish agent wallet setup'
                        : 'Set up this wallet for trading'
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openSetupFor(wallet);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        openSetupFor(wallet);
                      }
                    }}
                    className="hover:underline"
                    style={{ color: 'var(--accent-primary)', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}
                  >
                    setup
                  </span>
                )}
              </span>
              {mint !== null ? (
                <>
                  <span
                    data-testid={`multi-wallet-balances-${wallet.wallet_account_id}`}
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 11.5,
                      color: 'var(--ink-1)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {holding
                      ? holding.solLamports === null
                        ? '—'
                        : formatSol(holding.solLamports)
                      : holdings.loading
                        ? '…'
                        : '—'}
                  </span>
                  <span
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 11.5,
                      color:
                        holding && holding.tokenBaseUnits !== null && holding.tokenBaseUnits > 0n
                          ? 'var(--ink-1)'
                          : 'var(--ink-3)',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {holding
                      ? holding.tokenBaseUnits === null
                        ? '—'
                        : formatTokenAmount(holding.tokenBaseUnits)
                      : holdings.loading
                        ? '…'
                        : '—'}
                  </span>
                </>
              ) : (
                /*
                 * SOL, with its mark. Off the trade page this is the only
                 * figure on the row and the only thing that answers what
                 * the list is for — whether this wallet can cover the buy.
                 *
                 * The mark is the real Solana logo rather than a letter or
                 * a disc, so the figure says WHICH balance it is without
                 * a column head above it to explain.
                 */
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 5,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    color: isChecked ? 'var(--ink-0)' : 'var(--ink-2)',
                    fontSize: 12,
                  }}
                >
                  <Solana style={{ width: 11, height: 11, flexShrink: 0 }} />
                  {rowBalances.status === 'ready'
                    ? formatLamportsBigInt(
                        rowBalances.perWallet.get(wallet.wallet_account_id) ?? 0n,
                      )
                    : rowBalances.status === 'loading'
                      ? '…'
                      : '—'}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {mint ? (
        <WalletRebalanceActions
          mint={mint}
          wallets={eligible}
          selectedIds={selectedIds}
          holdings={holdings}
        />
      ) : null}
    </div>
  );
}

/** Themed checkbox visual (the real input sits invisibly on top). */
function CheckGlyph({ on }: { on: boolean }): React.ReactElement {
  return (
    <span
      aria-hidden
      style={{
        width: 15,
        height: 15,
        borderRadius: 4,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: on ? '1px solid var(--accent-primary)' : '1px solid var(--hairline-2)',
        background: on ? 'var(--accent-primary)' : 'transparent',
        transition: 'background 100ms ease, border-color 100ms ease',
        pointerEvents: 'none',
      }}
    >
      {on ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M1.5 5.2 4 7.6 8.5 2.6"
            stroke="var(--surface-1)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function linkButtonStyle(disabled: boolean): CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: 0,
    color: disabled ? 'var(--ink-3)' : 'var(--accent-primary)',
    fontSize: 11.5,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    fontFamily: 'var(--sans)',
  };
}
