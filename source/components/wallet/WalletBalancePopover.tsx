'use client';

/**
 * Balances popover — what the topnav balance pill opens.
 *
 * The pill used to open the deposit/withdraw MODAL directly, which
 * answered a question nobody asked: clicking a balance means "show me
 * my balances", not "take my money". This panel answers the click
 * literally (total value, the assets that make it up, the per-wallet
 * split) and keeps Deposit / Withdraw as explicit actions at the foot.
 *
 * ── MATERIAL: "bare, black" ──────────────────────────────────────────
 *
 * Picked off the `/whatever` sheet. The two assets sit side by side with
 * NO plates under them, divided by one vertical hairline, on the black
 * surface and invite card shadow the deposit modal now carries.
 *
 * The panel used to be a glass pane holding a bordered inset card around
 * the asset rows — a box in a box in a box, three materials deep before
 * you reached a number. Side by side also halves the height of the only
 * part of the panel that grows, which matters for something dangling off
 * a nav pill.
 *
 * Every figure is one the app actually holds — aggregate SOL and USDC
 * from the same bulk balances query the pill reads, priced by the
 * shared SOL/USD query. While balances load the total is a breathing
 * placeholder; if balances are in but the PRICE is not, it renders a
 * dash rather than a number that silently omits the SOL position.
 */

import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Copy, Solana, Usdc } from '@/components/listen/icons/Icons';
import { formatUsd, useSolPriceUsd } from '@/components/onboarding/DepositCard';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import { isEligibleWallet } from '@/lib/state/selected-wallet-store';
import {
  formatLamportsBigInt,
  formatUsdcMicroBigInt,
  useMultiWalletSolBalance,
} from '@/components/listen/useMultiWalletSolBalance';
import './wallet-popover-v2.css';

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_PER_MICRO = 1_000_000;

/** `AbCd…WxYz` */
function shortPubkey(pubkey: string): string {
  return pubkey.length <= 9 ? pubkey : `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
}

/**
 * Copy-a-pubkey affordance. Its own component so the copied flash is
 * per-row state — copying one wallet must not flash every row.
 */
function CopyPubkey({ pubkey, label }: { pubkey: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(pubkey).then(() => setCopied(true));
      }}
      title={copied ? 'Copied' : `Copy ${label} address`}
      aria-label={copied ? 'Copied' : `Copy ${label} address`}
      className="wp-copy"
      style={copied ? { color: 'var(--up)' } : undefined}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" fill="none" style={{ width: 10, height: 10 }} aria-hidden>
          <path
            d="M3 8.5 6.5 12 13 4.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <Copy style={{ width: 10, height: 10 }} />
      )}
    </button>
  );
}

/**
 * One of the two bare columns. No plate, no border — the hairline
 * between the columns is drawn by the stylesheet as an inset shadow on
 * the second one, so it cannot add width and knock the right column out
 * of line with the wallet figures underneath.
 */
function AssetColumn({
  icon,
  symbol,
  amount,
  usd,
}: {
  icon: React.ReactNode;
  symbol: string;
  amount: string;
  usd: string | null;
}) {
  return (
    <div className="wp-col">
      <span className="wp-sym">
        <span className="wp-coin">{icon}</span>
        <span className="text-[11.5px] font-medium text-[var(--ink-1)]">{symbol}</span>
      </span>
      <div className="wp-num wp-amt">{amount}</div>
      {usd === null ? null : <div className="wp-num wp-usd">{usd}</div>}
    </div>
  );
}

export function WalletBalancePopover({
  children,
  onDeposit,
  onWithdraw,
}: {
  /** The pill, used as the popover trigger. */
  children: React.ReactNode;
  onDeposit: () => void;
  onWithdraw: () => void;
}) {
  const { data: me } = useMe();
  const solPriceUsd = useSolPriceUsd();

  const wallets = useMemo<ReadonlyArray<MeWalletEntry>>(
    () => (me && !me.reauth_required ? me.wallets.filter(isEligibleWallet) : []),
    [me],
  );
  const walletIds = useMemo(() => wallets.map((w) => w.wallet_account_id), [wallets]);
  const balances = useMultiWalletSolBalance(walletIds);
  const ready = walletIds.length > 0 && balances.status === 'ready';

  const solAmount = Number(balances.totalLamports) / LAMPORTS_PER_SOL;
  const usdcAmount = Number(balances.totalUsdcMicro) / USDC_PER_MICRO;
  // Total is only honest once the balances resolved AND SOL is priced —
  // otherwise it would silently read as "USDC only", which is wrong by
  // exactly the size of the user's SOL position.
  const totalUsd = ready && solPriceUsd !== null ? solAmount * solPriceUsd + usdcAmount : null;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        data-testid="wallet-balance-popover"
        data-wallet-popover=""
        /* `PopoverContent` merges the shadcn defaults `w-72 rounded-lg
           border p-4`, and `cn` runs tailwind-merge, so the only way to
           REMOVE them is to pass their counterparts here. The stylesheet
           repeats the same values with `!important` because the shipped
           shadow is an INLINE style, and inline beats any selector. */
        className="w-[296px] overflow-hidden rounded-[18px] border-0 p-0"
      >
        <div className="wp-head">
          <div className="wp-eyebrow">Total value</div>
          <div className="wp-total-wrap">
            {totalUsd !== null ? (
              <div className="wp-total">{formatUsd(totalUsd)}</div>
            ) : !ready ? (
              <div className="wp-pulse animate-pulse" aria-label="Loading total value" />
            ) : (
              // Balances in, PRICE missing: the honest dash.
              <div className="wp-total text-[var(--ink-3)]">—</div>
            )}
          </div>
        </div>

        <div className="wp-cols">
          <AssetColumn
            icon={<Solana style={{ width: 13, height: 13 }} />}
            symbol="SOL"
            amount={ready ? formatLamportsBigInt(balances.totalLamports) : '—'}
            usd={ready && solPriceUsd !== null ? formatUsd(solAmount * solPriceUsd) : null}
          />
          <AssetColumn
            icon={<Usdc style={{ width: 13, height: 13 }} />}
            symbol="USDC"
            amount={ready ? formatUsdcMicroBigInt(balances.totalUsdcMicro) : '—'}
            usd={ready ? formatUsd(usdcAmount) : null}
          />
        </div>

        {/* Per-wallet split. Rendered from ONE wallet up — even with no
            split to show, this is where the address + copy live. */}
        {wallets.length > 0 ? (
          <>
            <div aria-hidden className="wp-rule" />
            <div className="wp-wallets">
              {wallets.map((wallet) => {
                const lamports = balances.perWallet.get(wallet.wallet_account_id) ?? 0n;
                return (
                  <div key={wallet.wallet_account_id} className="wp-wallet">
                    <span className="truncate text-[11.5px] text-[var(--ink-1)]">
                      {walletDisplayName(wallet)}
                    </span>
                    <span className="wp-key text-[10.5px] text-[var(--ink-4)]">
                      {shortPubkey(wallet.wallet_pubkey)}
                    </span>
                    <CopyPubkey
                      pubkey={wallet.wallet_pubkey}
                      label={walletDisplayName(wallet)}
                    />
                    <span className="wp-num ml-auto text-[11.5px] text-[var(--ink-1)]">
                      {ready ? formatLamportsBigInt(lamports) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="wp-acts">
          <button
            type="button"
            onClick={onDeposit}
            data-testid="wallet-popover-deposit"
            className="wp-btn is-primary"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={onWithdraw}
            data-testid="wallet-popover-withdraw"
            className="wp-btn is-ghost"
          >
            Withdraw
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
