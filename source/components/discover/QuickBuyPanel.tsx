'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Gas, Slip, Solana, Tip } from '@/components/listen/icons/Icons';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBps, formatLamportsAsSol } from '@/components/trade/SettingsReadout';
import {
  QUICK_BUY_MAX_SOL,
  selectActivePresetForSection,
  useTradeStore,
  type QuickBuySectionId,
  type TradePresetIndex,
  type TradePresetSide,
} from '@/lib/state/trade-store';
import {
  useUpdateQuickBuyAmount,
  useUpdateTradePresets,
} from '@/lib/api/user-settings';

/**
 * QuickBuyPanel — inline amount selector that lives in every Discover
 * section header (Alpha / New Pairs / Almost Graduated / Graduated).
 *
 * Per-section by design: each section maintains its own
 * `quickBuyAmountsBySection[sectionId]` slot in the trade-store and
 * its own JSONB slot on the server. Changing the amount in one
 * section's panel propagates only to that section's `<CoinCard>`s.
 *
 * Layout (left → right):
 *
 *   [ ⚡  0.10  ◎  | P1  P2  P3 ]
 *
 *   ⚡         lightning glyph (`/assets/quickbuy.svg`)
 *   0.10      editable amount (Enter / blur applies + saves)
 *   ◎         Solana brand mark
 *   P1/P2/P3  fixed presets — active preset is highlighted in the
 *             accent color when the section's amount matches it
 *
 * Lifecycle:
 *   - On mount / when the section's persisted amount changes
 *     (server hydration), the input's `draft` is initialized to the
 *     formatted value so the user sees what's saved.
 *   - Auto-save on every keystroke (no Enter / blur required):
 *     `onChange` parses the input and immediately writes the local
 *     store + enqueues a debounced server PATCH. Rapid typing
 *     coalesces into one network round-trip via the 500 ms
 *     `useUpdateQuickBuyAmount` debouncer.
 *   - Empty input → clears the section (`null` to both store and
 *     server). The input stays empty until the user types again or
 *     leaves it empty on blur.
 *   - Non-empty but unparseable transient input (`"0"`, `"0."`,
 *     `"abc"`) leaves the store alone — the user is mid-type. Once
 *     the input parses to a positive number, the store catches up.
 *   - Enter / blur reformats the visible draft to the canonical
 *     `formatSol()` representation (`"0.50"` → `"0.5"`), but doesn't
 *     trigger a save — the value is already saved by the per-
 *     keystroke path.
 *   - Esc reverts the draft to the persisted value (the prior
 *     auto-save remains in the store; Esc only undoes any unsaved
 *     transient typing).
 */

/* P-button labels mirror the modal's preset tabs (PRESET 1/2/3).
   Each button toggles `tradePresets.active_index`; the active one
   gets the accent treatment so users can see at a glance which
   preset is driving the next trade. */
const PRESET_LABELS = ['P1', 'P2', 'P3'] as const;

interface QuickBuyPanelProps {
  /** Which Discover section this panel controls. */
  sectionId: QuickBuySectionId;
  /** Compact form (narrow column headers): amount only, no P1/P2/P3 presets. */
  compact?: boolean;
}

function formatSol(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '';
  if (value >= 1) return value.toFixed(value % 1 === 0 ? 0 : 2);
  if (value >= 0.01) return value.toFixed(2);
  // Trim trailing zeros on sub-cent SOL so a tiny preset like 0.005
  // doesn't display as "0.0050".
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function parseSol(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // Clamp to a hard 100 SOL ceiling — the trade store also clamps at
  // its own MAX, but enforcing here prevents the user from seeing
  // "700" in the input box and assuming a 700-SOL buy was queued.
  return Math.min(parsed, QUICK_BUY_MAX_SOL);
}

export function QuickBuyPanel({ sectionId, compact = false }: QuickBuyPanelProps) {
  const quickBuyAmountSol = useTradeStore(
    (s) => s.quickBuyAmountsBySection[sectionId],
  );
  const setQuickBuyAmountSol = useTradeStore((s) => s.setQuickBuyAmountSol);
  /* Read the active preset RESOLVED for this section — uses the
     per-section `active_by_section` override when set, otherwise
     falls back to the global `active_index`. This is what drives
     the P1/P2/P3 highlight in this row. */
  const activePresetForSection = useTradeStore((s) =>
    selectActivePresetForSection(s.tradePresets, sectionId),
  );
  const setActivePresetForSection = useTradeStore((s) => s.setActivePresetForSection);
  /* Full preset array for the P-button hover cards. Cheap subscription:
     the panel mounts once per section header (not per card), and the
     array reference only changes on a settings edit / server hydration. */
  const presets = useTradeStore((s) => s.tradePresets.presets);
  const { enqueue } = useUpdateQuickBuyAmount();
  const { enqueue: enqueuePresets } = useUpdateTradePresets();
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* `draft` mirrors the section's persisted amount as a string so the
     input displays the saved value on mount and after a server
     hydration. On user edit, `draft` is the user's typing buffer;
     parsing + persisting happens per-keystroke in `onDraftChange`. */
  const [draft, setDraft] = useState<string>(() => formatSol(quickBuyAmountSol));

  /* Re-sync the draft when the section's amount changes from outside
     the input (server hydration on signed-in mount, P-preset click,
     cross-tab refetch). Guarded by focus: while the input is focused
     the user owns the draft, so a transient store value (or a
     mid-type "0." that parses to null) doesn't yank text out from
     under the cursor. */
  useEffect(() => {
    if (
      typeof document !== 'undefined' &&
      inputRef.current !== null &&
      document.activeElement === inputRef.current
    ) {
      return;
    }
    setDraft(formatSol(quickBuyAmountSol));
  }, [quickBuyAmountSol]);

  /* Per-keystroke parse + persist. Empty input clears the section;
     a parseable positive number sets it; everything else (`"0"`,
     `"0."`, `"abc"`) is treated as transient typing and leaves the
     store alone. The store write is synchronous so the local UI is
     instant; the server PATCH is debounced 500 ms by `enqueue`. */
  const onDraftChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const raw = event.target.value;
      setDraft(raw);
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        setQuickBuyAmountSol(sectionId, null);
        enqueue(sectionId, null);
        return;
      }
      const parsed = parseSol(trimmed);
      if (parsed === null) return;
      setQuickBuyAmountSol(sectionId, parsed);
      enqueue(sectionId, parsed);
    },
    [sectionId, setQuickBuyAmountSol, enqueue],
  );

  /* Blur reformats the visible draft to the canonical
     representation (`"0.50"` → `"0.5"`, `"700"` → `"100"` after
     clamp). No save here — the per-keystroke path already wrote the
     value. */
  const onDraftBlur = useCallback((): void => {
    setDraft(formatSol(quickBuyAmountSol));
  }, [quickBuyAmountSol]);

  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      setDraft(formatSol(quickBuyAmountSol));
      (event.target as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      /* Esc snaps the draft back to the last persisted value. Note
         that auto-save already wrote each keystroke, so what the
         user is "cancelling" is only the still-unparseable in-flight
         draft (e.g. `"0."`); any earlier valid value they typed has
         already been saved. */
      setDraft(formatSol(quickBuyAmountSol));
      (event.target as HTMLInputElement).blur();
    }
  };

  return (
    <span
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-2 rounded-full pl-2',
        // No presets in compact, so give the Solana mark a little breathing room.
        compact ? 'pr-2.5' : 'pr-1',
      )}
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        fontFamily: 'var(--mono)',
      }}
    >
      {/* Lightning glyph inlined from `/assets/quickbuy.svg`, with the
          path's hardcoded `fill="#111111"` swapped to `currentColor` so
          the icon tracks the active theme's accent automatically (no
          CSS filter math, no per-theme asset variants). */}
      <svg
        width={13}
        height={13}
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden
        style={{ display: 'block', color: 'var(--accent-primary)' }}
      >
        <path
          d="M7.92826 0.67044C7.92826 0.480261 7.80541 0.311865 7.62429 0.253817C7.44322 0.195771 7.24536 0.261371 7.13476 0.416118L1.59311 8.17289C1.49784 8.30624 1.48509 8.48165 1.56008 8.62737C1.63507 8.77309 1.78521 8.86467 1.9491 8.86467H5.59493V12.6288C5.59493 12.8196 5.71854 12.9883 5.90036 13.0459C6.08225 13.1035 6.28046 13.0366 6.39025 12.8806L11.9319 5.00555C12.0259 4.87198 12.0377 4.69718 11.9624 4.55221C11.8872 4.40725 11.7374 4.31627 11.5741 4.31627H7.92826V0.67044Z"
          fill="currentColor"
        />
      </svg>

      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        /* See CoinCard QuickbuyScoreArea: the `draft` state is
           initialized from the client-only `quickBuyAmountsBySection`
           slice (synchronously seeded from localStorage at module
           load). SSR renders `value=""`; client hydrates with the
           saved value. Suppress the warning — the divergence is
           intentional. */
        suppressHydrationWarning
        onChange={onDraftChange}
        onKeyDown={onDraftKey}
        onBlur={onDraftBlur}
        placeholder="0.0"
        aria-label={`Quickbuy amount in SOL for ${sectionId}`}
        className="bg-transparent border-0 outline-none tabular-nums text-left placeholder:text-[var(--ink-3)] placeholder:font-normal"
        style={{
          width: 36,
          color: 'var(--ink-0)',
          fontSize: 11,
          letterSpacing: '0.02em',
        }}
      />

      <Solana style={{ width: 14, height: 14, display: 'block' }} />

      {/* Hairline divider between the amount cluster and the presets. */}
      {compact ? null : (
      <span
        aria-hidden
        className="inline-block self-stretch w-px"
        style={{ background: 'var(--hairline)' }}
      />
      )}

      {/* P1 / P2 / P3 = per-section active preset selector. Clicking
          writes to `tradePresets.active_by_section[sectionId]` —
          independent per Discover section, so Alpha can pin P1 while
          Graduated pins P2. The global `active_index` (used by the
          Trade page + the modal's preset tabs) is unaffected. The
          active button gets the accent glow treatment. */}
      {compact ? null : (
      <span className="inline-flex items-center gap-1">
        {PRESET_LABELS.map((label, idx) => {
          const presetIdx = idx as TradePresetIndex;
          const active = activePresetForSection === presetIdx;
          return (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                if (active) return;
                setActivePresetForSection(sectionId, presetIdx);
                /* Read the freshly-mutated state and ship a wholesale
                   snapshot. The store mutation is synchronous so by
                   the next tick `getState()` reflects the new
                   per-section override. */
                enqueuePresets(useTradeStore.getState().tradePresets);
              }}
              /* `active` derives from the client-only
                 `tradePresets.active_index`. SSR sees the empty
                 default (0); the client may have a different
                 active_index loaded from localStorage. The style +
                 `aria-pressed` divergence is intentional. */
              suppressHydrationWarning
              className="inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-0 rounded-sm"
              style={{
                color: active ? 'var(--accent-primary)' : 'var(--ink-2)',
                background: 'transparent',
                fontSize: 10,
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.04em',
                padding: '0 4px',
                textShadow: active
                  ? '0 0 8px var(--accent-glow, var(--accent-primary))'
                  : 'none',
                transition: 'color 120ms var(--ease-out), text-shadow 120ms var(--ease-out)',
              }}
              aria-pressed={active}
              aria-label={`Activate ${label}`}
            >
              {label}
            </button>
              </TooltipTrigger>
              <TooltipContent>
                <PresetSettingsRows side={presets[presetIdx].buy} />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </span>
      )}
    </span>
  );
}

/**
 * P-button hover card body: the preset's BUY fee block, one icon+value
 * row per knob (same Slip / Gas / Tip vocabulary as the trade surfaces'
 * `SettingsReadout`), so a user can compare presets without opening the
 * Trading Settings modal.
 */
function PresetSettingsRows({ side }: { side: TradePresetSide }) {
  const rows = [
    { Icon: Slip, label: 'Slippage tolerance', value: `${formatBps(side.slippage_bps)}%` },
    { Icon: Gas, label: 'Priority fee', value: formatLamportsAsSol(side.priority_lamports) },
    { Icon: Tip, label: 'MEV tip', value: formatLamportsAsSol(side.bribe_lamports) },
  ];
  return (
    <span className="flex flex-col gap-1.5 tabular-nums" style={{ fontFamily: 'var(--mono)' }}>
      {rows.map(({ Icon, label, value }) => (
        <span key={label} className="flex items-center gap-2" aria-label={`${label}: ${value}`}>
          <Icon aria-hidden style={{ width: 13, height: 13, color: 'var(--ink-3)', flexShrink: 0 }} />
          <span style={{ color: 'var(--ink-0)' }}>{value}</span>
        </span>
      ))}
    </span>
  );
}
