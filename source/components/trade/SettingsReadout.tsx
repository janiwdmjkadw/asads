import type { ReactNode } from 'react';
import { Numeral, type Tone } from '@/components/listen/primitives';
import { Gas, Slip, Tip } from '@/components/listen/icons/Icons';
import { useTradeStore, type TradePresetIndex } from '@/lib/state/trade-store';
import { useUpdateTradePresets } from '@/lib/api/user-settings';

/**
 * Compact fee snapshot rendered on the trade surfaces (TradePanel and
 * the Instant Trade box). Mirrors the three Trading Settings inputs —
 * Slip / Gas / Tip — for the side about to be submitted, plus the
 * P1/P2/P3 active-preset switch. One source of truth so both surfaces
 * stay in sync.
 */
export function SettingsReadout({
  slippageBps,
  priorityLamports,
  bribeLamports,
  showPresets = true,
}: {
  slippageBps: number;
  priorityLamports: number;
  bribeLamports: number;
  /** Render the P1/P2/P3 selector at the trailing edge. Surfaces that
   *  promote the presets elsewhere (e.g. the Instant Trade box) pass
   *  `false` to keep this row to just slip/priority/tip. */
  showPresets?: boolean;
}) {
  const cols = showPresets ? 4 : 3;
  return (
    <div
      className="grid h-[26px] items-stretch overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[color:var(--chip-bg)]"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      <ReadoutLane divider>
        <ReadoutItem
          icon={<Slip style={{ width: 14, height: 14 }} />}
          value={`${formatBps(slippageBps)}%`}
          title="Slippage tolerance"
        />
      </ReadoutLane>
      <ReadoutLane divider>
        <ReadoutItem
          icon={<Gas style={{ width: 14, height: 14 }} />}
          value={formatLamportsAsSol(priorityLamports)}
          title="Priority fee"
        />
      </ReadoutLane>
      <ReadoutLane divider={showPresets}>
        <ReadoutItem
          icon={<Tip style={{ width: 14, height: 14 }} />}
          value={formatLamportsAsSol(bribeLamports)}
          title="MEV tip"
        />
      </ReadoutLane>
      {showPresets ? (
        <ReadoutLane>
          <ActivePresetSelector />
        </ReadoutLane>
      ) : null}
    </div>
  );
}

/** One equal-width lane in the fee readout; content is centered and an
 *  optional hairline divider sits on the trailing edge. */
function ReadoutLane({ children, divider }: { children: ReactNode; divider?: boolean }) {
  return (
    <div
      className={
        divider
          ? 'flex min-w-0 items-center justify-center border-r border-[color:var(--hairline)] px-1'
          : 'flex min-w-0 items-center justify-center px-1'
      }
    >
      {children}
    </div>
  );
}

const PRESET_LABELS = ['P1', 'P2', 'P3'] as const;

/**
 * P1/P2/P3 selector. Click flips `tradePresets.active_index` (the
 * GLOBAL active preset — the trade surfaces are not section-bound,
 * unlike the Discover QuickBuyPanel). The slippage/priority/bribe
 * items re-render atomically to match.
 *
 * `variant`:
 *   - `inline` (default) — tight mono labels for the compact fee readout.
 *   - `tabs` — prominent segmented control for a standalone preset bar.
 */
export function ActivePresetSelector({ variant = 'inline' }: { variant?: 'inline' | 'tabs' }) {
  const activeIndex = useTradeStore((s) => s.tradePresets.active_index);
  const setActivePreset = useTradeStore((s) => s.setActivePreset);
  const { enqueue: enqueuePresets } = useUpdateTradePresets();
  const select = (presetIdx: TradePresetIndex, active: boolean) => {
    if (active) return;
    setActivePreset(presetIdx);
    /* Mutation is synchronous, so a `getState()` read here reflects the
       new `active_index`. Ship the wholesale snapshot so the server
       PATCH carries the canonical shape; the 500ms debouncer in
       `enqueuePresets` coalesces rapid back-to-back toggles. */
    enqueuePresets(useTradeStore.getState().tradePresets);
  };

  if (variant === 'tabs') {
    // Clean, borderless preset toggle: no track/box/fill — just the
    // labels, with the active preset lit in the accent color and an
    // accent glow.
    return (
      <div className="inline-flex items-center gap-1">
        {PRESET_LABELS.map((label, idx) => {
          const presetIdx = idx as TradePresetIndex;
          const active = activeIndex === presetIdx;
          return (
            <button
              key={label}
              type="button"
              suppressHydrationWarning
              onClick={() => select(presetIdx, active)}
              className="inline-flex cursor-pointer items-center justify-center"
              style={{
                padding: '2px 7px',
                fontFamily: 'var(--sans)',
                fontSize: 11,
                letterSpacing: '0.02em',
                color: active ? 'var(--accent-primary)' : 'var(--ink-3)',
                background: 'transparent',
                fontWeight: active ? 700 : 500,
                border: 'none',
                textShadow: active ? '0 0 10px var(--accent-glow, var(--accent-primary))' : 'none',
                transition: 'color 120ms var(--ease-out), text-shadow 120ms var(--ease-out)',
              }}
              aria-pressed={active}
              aria-label={`Activate ${label}`}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <span className="inline-flex select-none items-center gap-1">
      {PRESET_LABELS.map((label, idx) => {
        const presetIdx = idx as TradePresetIndex;
        const active = activeIndex === presetIdx;
        return (
          <button
            key={label}
            type="button"
            onClick={() => select(presetIdx, active)}
            /* `active` derives from the client-only persisted
               `tradePresets.active_index`. SSR renders the empty
               default (0); the client may have a different
               active_index hydrated from localStorage. The
               `aria-pressed` divergence is intentional. */
            suppressHydrationWarning
            className="inline-flex cursor-pointer items-center justify-center rounded-sm px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-0"
            style={{
              color: active ? 'var(--accent-primary)' : 'var(--ink-2)',
              fontFamily: 'var(--sans)',
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              letterSpacing: '0.04em',
              textShadow: active ? '0 0 8px var(--accent-glow, var(--accent-primary))' : 'none',
              transition: 'color 120ms var(--ease-out), text-shadow 120ms var(--ease-out)',
            }}
            aria-pressed={active}
            aria-label={`Activate ${label}`}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}

function ReadoutItem({
  icon,
  value,
  title,
  tone,
}: {
  icon: ReactNode;
  value: string;
  title: string;
  tone?: Tone;
}) {
  return (
    <span
      className="inline-flex select-none items-center gap-1.5"
      title={title}
      aria-label={`${title}: ${value}`}
    >
      <span style={{ color: 'var(--ink-3)' }}>{icon}</span>
      <Numeral size="xs" tone={tone ?? 'ink-1'}>
        {value}
      </Numeral>
    </span>
  );
}

export function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) return '0';
  const pct = bps / 100;
  return Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2);
}

/** Render a lamports integer as a short SOL string. `1_000_000 -> "0.001"`.
 *  Trailing zeros and a dangling decimal point are stripped. */
export function formatLamportsAsSol(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports <= 0) return '0';
  return (lamports / 1_000_000_000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}
