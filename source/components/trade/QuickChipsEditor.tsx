'use client';

import { useEffect, useState } from 'react';
import { Pencil, Solana, Usdc } from '@/components/listen/icons/Icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  QUICK_BUY_MAX_SOL,
  QUICK_BUY_MIN_SOL,
  QUICK_CHIPS_COUNT,
  SELL_CHIP_PCT_MAX,
  SELL_CHIP_PCT_MIN,
  USDC_BUY_MICRO_MAX,
  USDC_BUY_MICRO_MIN,
  USDC_QUICK_BUY_COUNT,
  defaultQuickChips,
  defaultUsdcTrade,
  useTradeStore,
  type QuickChipsState,
} from '@/lib/state/trade-store';
import { useUpdateQuickChips, useUpdateUsdcTrade } from '@/lib/api/user-settings';

/**
 * Pencil trigger + popover that edits one quick-chips set. Built on the
 * shadcn `Popover` primitive (Radix), which portals into `.listen-root` so
 * the popover inherits the active theme cascade (`--popover` / `--ink-*` /
 * `--accent-*`) and handles open/close, click-outside, Esc, and positioning.
 *
 * `field` selects which array of the `quickChips` block this editor writes:
 *   - `buy`     — Buy SOL amounts
 *   - `sell`    — Sell percentages
 *   - `sellSol` — Sell SOL amounts ("sell N SOL worth")
 *
 * `unit` drives the input adornment (Solana mark for SOL, "%" for percent,
 * "$" for USDC) and the parse/clamp bounds. Edits are wholesale on the
 * chosen field: a valid value writes the whole `quickChips` block to the
 * store (instant local update) and enqueues a debounced server PATCH via
 * `useUpdateQuickChips`. Invalid / mid-type input leaves the store
 * untouched (the draft keeps what was typed).
 *
 * `field='usdcBuy'` edits the OTHER store slice — the 5
 * `usdcTrade.quick_buy_usdc_micro` presets (drafts typed in dollars,
 * stored as integer micro-USDC) — and persists via the wholesale
 * `usdc_trade` PATCH instead.
 */

type ChipField = 'buy' | 'sell' | 'sellSol' | 'usdcBuy';
type ChipUnit = 'sol' | 'pct' | 'usd';

/** Display string for a stored chip value. */
function formatChip(value: number): string {
  return String(value);
}

/** Display string for a stored micro-USDC chip value, in dollars. */
function formatUsdcChip(micro: number): string {
  return String(micro / 1_000_000);
}

/** Parse a SOL-denominated chip draft to a clamped SOL number, or null. */
function parseSolChip(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(n, QUICK_BUY_MIN_SOL), QUICK_BUY_MAX_SOL);
}

/** Parse a percentage chip draft to a clamped integer percent, or null. */
function parsePctChip(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const int = Math.round(n);
  if (int <= 0) return null;
  return Math.min(Math.max(int, SELL_CHIP_PCT_MIN), SELL_CHIP_PCT_MAX);
}

/** Parse a dollar chip draft to clamped integer micro-USDC, or null. */
function parseUsdcChipMicro(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, '');
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const micro = Math.round(n * 1_000_000);
  return Math.min(Math.max(micro, USDC_BUY_MICRO_MIN), USDC_BUY_MICRO_MAX);
}

export function QuickChipsEditor({
  field,
  unit,
  title,
  sell = false,
  variant = 'chip',
}: {
  field: ChipField;
  unit: ChipUnit;
  title: string;
  /** Tint the pencil trigger red to match the Sell-side chips. */
  sell?: boolean;
  /** `chip` — `.amt-chip`-styled trigger (default). `ghost` — borderless
   *  icon button for clean top-bar use. */
  variant?: 'chip' | 'ghost';
}): React.ReactElement {
  const setQuickChips = useTradeStore((s) => s.setQuickChips);
  const setUsdcQuickBuyMicro = useTradeStore((s) => s.setUsdcQuickBuyMicro);
  const { enqueue } = useUpdateQuickChips();
  const { enqueue: enqueueUsdc } = useUpdateUsdcTrade();

  const isUsdc = field === 'usdcBuy';
  const chipCount = isUsdc ? USDC_QUICK_BUY_COUNT : QUICK_CHIPS_COUNT;
  /* Narrowed alias for the quickChips-backed fields; never read when
     `isUsdc` (every consumer branches first). */
  const solField: 'buy' | 'sell' | 'sellSol' = field === 'usdcBuy' ? 'buy' : field;
  const readDraft = (): string[] =>
    isUsdc
      ? useTradeStore.getState().usdcTrade.quick_buy_usdc_micro.map(formatUsdcChip)
      : useTradeStore.getState().quickChips[solField].map(formatChip);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(readDraft);

  /* Reseed the draft from the store whenever the target field changes
     while the popover is open (e.g. the Sell %/SOL toggle flips the active
     set, or the SOL/USDC mode flips the buy set), so the inputs always
     reflect the persisted values. Mid-edit store writes do NOT reseed.
     Opening reseeds via `onOpenChange`. */
  useEffect(() => {
    if (open) setDraft(readDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field]);

  const commit = (nextFieldValues: number[]) => {
    if (isUsdc) {
      setUsdcQuickBuyMicro(nextFieldValues);
      /* Read the post-normalize slice back so the server PATCH and the
         localStorage write-through agree with the rendered chips. */
      enqueueUsdc(useTradeStore.getState().usdcTrade);
      return;
    }
    const nextBlock: QuickChipsState = {
      ...useTradeStore.getState().quickChips,
      [solField]: nextFieldValues,
    };
    setQuickChips(nextBlock);
    enqueue(useTradeStore.getState().quickChips);
  };

  const onFieldChange = (index: number, raw: string) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = raw;
      return next;
    });
    const parsed =
      unit === 'usd' ? parseUsdcChipMicro(raw) : unit === 'sol' ? parseSolChip(raw) : parsePctChip(raw);
    if (parsed === null) return;
    const current = isUsdc
      ? useTradeStore.getState().usdcTrade.quick_buy_usdc_micro
      : useTradeStore.getState().quickChips[solField];
    const nextValues = [...current];
    nextValues[index] = parsed;
    commit(nextValues);
  };

  const onReset = () => {
    const defaults = isUsdc
      ? defaultUsdcTrade().quick_buy_usdc_micro
      : defaultQuickChips()[solField];
    commit([...defaults]);
    setDraft(isUsdc ? defaults.map(formatUsdcChip) : defaults.map(formatChip));
  };

  const onOpenChange = (next: boolean) => {
    if (next) setDraft(readDraft());
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${title}`}
          className={
            variant === 'ghost'
              ? 'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[var(--r-sm)] text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink-0)]'
              : `amt-chip${sell ? ' amt-chip--sell' : ''}`
          }
          style={variant === 'ghost' ? undefined : { minWidth: 0, width: '100%' }}
        >
          <Pencil style={{ width: 13, height: 13, display: 'block' }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-foreground">Edit {title}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={onReset}
          >
            Reset
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: chipCount }).map((_, i) => (
            <div key={i} className="relative">
              <Input
                inputMode="decimal"
                value={draft[i] ?? ''}
                onChange={(e) => onFieldChange(i, e.target.value)}
                aria-label={`${title} ${i + 1}`}
                className="h-8 pr-7 font-mono text-xs tabular-nums"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                {unit === 'sol' ? (
                  <Solana style={{ width: 13, height: 13, display: 'block' }} />
                ) : unit === 'usd' ? (
                  <Usdc style={{ width: 13, height: 13, display: 'block' }} />
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">%</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
