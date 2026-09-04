import { useTradeStore, type TradeQuoteMode } from '@/lib/state/trade-store';
import { SolDefs, SolMark } from '@/components/discover/column/sol';
import { useUpdateUsdcTrade } from '@/lib/api/user-settings';

/**
 * Compact SOL/USDC trade-mode segmented toggle, shared by the
 * TradePanel header and the InstantTradeBox top bar. Same borderless
 * glow treatment as the InstantTradeBox `%/◎` sell-mode toggle: the
 * active option lights up in the accent color, the other greys out.
 *
 * Clicking writes `usdcTrade.trade_quote_mode` to the store (instant
 * local flip, synced across tabs via the settings write-through) and
 * enqueues the debounced wholesale `usdc_trade` PATCH so the mode
 * follows the user across devices. The effective spend currency per
 * pair resolves through `lib/trade/spend-currency.ts` — USDC pairs
 * always spend USDC regardless of this toggle.
 */
export function QuoteModeToggle() {
  const mode = useTradeStore((s) => s.usdcTrade.trade_quote_mode);
  const setTradeQuoteMode = useTradeStore((s) => s.setTradeQuoteMode);
  const { enqueue } = useUpdateUsdcTrade();

  const pick = (next: TradeQuoteMode): void => {
    if (next === mode) return;
    setTradeQuoteMode(next);
    /* Store mutation is synchronous; ship the freshly-mutated wholesale
       snapshot (mirrors the QuickBuyPanel preset-click pattern). */
    enqueue(useTradeStore.getState().usdcTrade);
  };

  return (
    <div
      className="inline-flex items-center gap-0.5"
      role="group"
      aria-label="Trade quote mode"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <SolDefs />
      <ModeButton label="SOL" active={mode === 'sol'} onClick={() => pick('sol')} />
      <ModeButton label="USDC" active={mode === 'usdc'} onClick={() => pick('usdc')} />
    </div>
  );
}

/*
 * ── EACH CURRENCY WEARS ITS OWN MARK ─────────────────────────────────
 *
 * SOL and USDC were two words in tracked mono, told apart by which one
 * was lit. That is a lot of reading for a control you glance at: the
 * currencies already have marks, and a mark is what the eye catches
 * first in a row of three-letter tickers.
 *
 * So: a pill each, logo then ticker, the chosen one on a raised plate —
 * the same treatment every other one-of-N choice on this page gets.
 */
function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Trade in ${label}`}
      /* `active` derives from the client-only `usdcTrade` slice (read
         synchronously from localStorage at module load); SSR renders
         the 'sol' default. The divergence is intentional. */
      suppressHydrationWarning
      className="qm-b"
      data-on={active ? '' : undefined}
    >
      {/* 15, not 11: the box renders through a 0.77 zoom wrapper, so the
          mark has to be specified bigger than it is meant to appear. */}
      {label === 'SOL' ? (
        <SolMark size={15} />
      ) : (
        <img src="/assets/quotes/usdc.png" alt="" width={15} height={15} />
      )}
      {label}
    </button>
  );
}
