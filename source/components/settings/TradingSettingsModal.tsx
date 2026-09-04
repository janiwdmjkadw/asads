'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Info, Shield, ShieldCheck, ShieldOff } from 'lucide-react';
import { Gas, Slip, Tip } from '@/components/listen/icons/Icons';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  BRIBE_LAMPORTS_MAX,
  BRIBE_LAMPORTS_MIN,
  PRIORITY_LAMPORTS_MAX,
  PRIORITY_LAMPORTS_MIN,
  SEND_MODES,
  SLIPPAGE_BPS_MAX,
  SLIPPAGE_BPS_MIN,
  TRADE_PRESETS_COUNT,
  agentPresetFromPreset,
  useTradeStore,
  type AgentPresetField,
  type AgentPresetFields,
  type SendMode,
  type TradePresetIndex,
  type TradePresetNumericField,
  type TradePresetSide,
  type TradePresetSideKey,
} from '@/lib/state/trade-store';
import { useUpdateAgentPreset, useUpdateTradePresets } from '@/lib/api/user-settings';
import './trading-settings-edge.css';

/**
 * Trading Settings modal — global fee config that applies to every
 * trade (QuickBuy, Instant Trade, manual Buy/Sell). Three editable
 * presets, each with separate Buy and Sell blocks. Persisted via
 * `useUpdateTradePresets`; the store -> localStorage subscriber in
 * `useHydrateUserSettings` keeps the cache fresh, and the
 * synchronous module-load reader in `trade-store.ts` makes the
 * modal open instantly with the right values on every reload.
 *
 * Visual design notes (after the v2 refresh against the Axiom reference):
 *
 *  - Typography: the modal renders in `var(--sans)` (Inter) for
 *    labels / titles, with `var(--mono)` (JetBrains Mono) reapplied
 *    locally on the numeric inputs and the RPC URL. Earlier versions
 *    pinned mono globally; that made labels read techy / cramped.
 *
 *  - Surfaces: container fills `var(--surface-1)` (the neutral
 *    near-black used by `.dp-card` and friends) on a `var(--hairline)`
 *    1px border. Inner pills and inputs use `var(--input-bg)` so the
 *    two layers stay visually distinct.
 *
 *  - Active treatments: selected Preset / MEV pills use a SOLID
 *    accent fill (`var(--accent-primary)` + `#0a0e14` ink) rather
 *    than the prior outlined-glow look. Buy/Sell sides go full color
 *    (`var(--up)` / `var(--down)`) when active. This matches Axiom's
 *    convention of confidently-selected chips and avoids the
 *    "is anything selected?" ambiguity of low-opacity washes.
 *
 *  - Auto Fee / Max Fee fields are intentionally absent — they
 *    represent "coming soon" behaviour that doesn't yet wire to the
 *    engine. MEV Mode and RPC are rendered visually but inert
 *    (no-op onClick, readOnly input, tooltipped as "coming soon").
 *
 * Per-keystroke save: on every input change we
 *   1. parse + clamp the local string,
 *   2. write the bounded value to the store via `setPresetField`,
 *   3. `enqueue` the resulting snapshot so a single debounced PATCH
 *      fires 500 ms after the user stops typing.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

/* Ink for text drawn on top of the accent fill. Now a token: `themes.ts`
   derives it per theme (near-black on the light accents, white on the dark
   ones like midnight/blood, where the old hardcoded near-black vanished). */
const INK_ON_ACCENT = 'var(--accent-ink)';

/** The Agent tab's identity in the preset row. A string so it can never be
 *  confused with a numbered slot or land in `active_index`. */
const AGENT_TARGET = 'agent' as const;

/** Which preset the modal is currently editing — a numbered slot, or the
 *  agent's. See `PresetTabRow` for why the agent is not a fourth slot. */
type EditTarget = TradePresetIndex | typeof AGENT_TARGET;

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function TradingSettingsModal({ open, onOpenChange }: Props) {
  const tradePresets = useTradeStore((s) => s.tradePresets);
  const setActivePreset = useTradeStore((s) => s.setActivePreset);
  const setPresetField = useTradeStore((s) => s.setPresetField);
  const setPresetSendMode = useTradeStore((s) => s.setPresetSendMode);
  const { enqueue } = useUpdateTradePresets();

  const agentPreset = useTradeStore((s) => s.agentPreset);
  /* Select the two STORED references and derive locally. Passing a derived
     selector to `useTradeStore` would allocate a fresh object on every
     snapshot read, and zustand compares with `Object.is` — that is an
     infinite render loop, not a perf note (it was one, headlessly:
     "Maximum update depth exceeded"). */
  const p1 = useTradeStore((s) => s.tradePresets.presets[0]);
  const agentPresetView = useMemo(
    () => agentPreset ?? agentPresetFromPreset(p1),
    [agentPreset, p1],
  );
  const setAgentPresetField = useTradeStore((s) => s.setAgentPresetField);
  const setAgentPresetSendMode = useTradeStore((s) => s.setAgentPresetSendMode);
  const resetAgentPresetFromP1 = useTradeStore((s) => s.resetAgentPresetFromP1);
  const { enqueue: enqueueAgentPreset } = useUpdateAgentPreset();

  const activeIndex = tradePresets.active_index;
  const [sideTab, setSideTab] = useState<TradePresetSideKey>('buy');
  /* Local to the modal, seeded from the stored pointer. The numbered tabs
     keep their existing meaning (selecting one also makes it the active
     preset for manual trades); the Agent tab only redirects editing. */
  const [editTarget, setEditTarget] = useState<EditTarget>(activeIndex);
  const editingAgent = editTarget === AGENT_TARGET;

  const activePreset = tradePresets.presets[activeIndex];
  const activeSide = activePreset[sideTab];

  /* When any preset field changes, `setPresetField` already wrote
     the bounded value into the store. Re-read the store on each
     render and enqueue the latest snapshot for the debounced PATCH.
     Ref-equality guard skips the enqueue on mounts / tab switches
     that don't actually mutate the state. */
  const lastEnqueuedRef = useRef(tradePresets);
  useEffect(() => {
    if (tradePresets === lastEnqueuedRef.current) return;
    lastEnqueuedRef.current = tradePresets;
    enqueue(tradePresets);
  }, [tradePresets, enqueue]);

  /* Same per-keystroke -> debounced-PATCH loop for the agent block.
     Guarded on `null` as well as ref-equality: an unconfigured user who
     only LOOKS at the Agent section must not have P1's values written
     for them — nothing persists until they actually edit or copy. */
  const lastEnqueuedAgentRef = useRef(agentPreset);
  useEffect(() => {
    if (agentPreset === lastEnqueuedAgentRef.current) return;
    lastEnqueuedAgentRef.current = agentPreset;
    if (agentPreset === null) return;
    enqueueAgentPreset(agentPreset);
  }, [agentPreset, enqueueAgentPreset]);

  const handleSelectPreset = useCallback(
    (target: EditTarget) => {
      setEditTarget(target);
      /* Only a numbered slot moves the stored pointer. Letting the Agent
         tab write `active_index` would silently change which preset the
         user's MANUAL trades execute with. */
      if (target === AGENT_TARGET || target === activeIndex) return;
      setActivePreset(target);
    },
    [activeIndex, setActivePreset],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="trading-settings-modal max-w-md p-0 gap-0 rounded-[14px] border-[var(--hairline)]"
        style={
          {
            background: 'var(--surface-1)',
            color: 'var(--ink-0)',
            fontFamily: 'var(--sans)',
          } as CSSProperties
        }
      >
        {/* Title row — centered with a hairline divider beneath.
            The DialogContent renders its own close (X) in the
            top-right corner; the centered title visually balances
            against that floating affordance. */}
        <div
          className="px-6 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--hairline)' }}
        >
          <DialogTitle
            className="text-[15px] font-medium tracking-normal text-center"
            style={{ fontFamily: 'var(--sans)', color: 'var(--ink-0)' }}
          >
            Trading Settings
          </DialogTitle>
        </div>

        <div className="px-6 pt-5 pb-6 flex flex-col gap-5">
          <PresetTabRow active={editTarget} onSelect={handleSelectPreset} />

          {editingAgent ? (
            /* The agent's tab mirrors a manual preset: Buy/Sell sides,
               the same three knobs, the same Send Mode row. What it
               omits is MEV Mode and the custom RPC field — those are
               inert here AND unmappable: no conditional-payload field
               corresponds to either (they are engine-side concerns), so
               showing them would promise the agent honours a setting it
               never receives. */
            <AgentPresetBody
              view={agentPresetView}
              side={sideTab}
              onSelectSide={setSideTab}
              configured={agentPreset !== null}
              onFieldChange={(field, value) => setAgentPresetField(sideTab, field, value)}
              onSendModeChange={(mode) => setAgentPresetSendMode(sideTab, mode)}
              onCopyFromP1={resetAgentPresetFromP1}
            />
          ) : (
            <>
              <SideTabRow active={sideTab} onSelect={setSideTab} />

              <FieldsGrid
                side={activeSide}
                onFieldChange={(field, value) =>
                  setPresetField(activeIndex, sideTab, field, value)
                }
              />

              <SendModeRow
                active={activeSide.send_mode}
                onSelect={(mode) => setPresetSendMode(activeIndex, sideTab, mode)}
              />

              <MevModeRow />

              <RpcField />
            </>
          )}

          <ContinueButton onClick={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Preset tab row ──────────────────────────────────────────────── */

function PresetTabRow({
  active,
  onSelect,
}: {
  active: EditTarget;
  onSelect: (target: EditTarget) => void;
}) {
  /* The three numbered slots, then the agent as a fourth peer. It is a
     peer in the row and in the editing model, but NOT in the stored
     `presets` array: that array is a fixed length-3 the api schema pins,
     and `active_index` is typed `0 | 1 | 2` because it also selects which
     preset MANUAL trades execute with. Selecting Agent therefore changes
     what this modal edits without touching `active_index` — an agent
     posture is not a thing manual trades can be "on". */
  const targets: EditTarget[] = useMemo(
    () => [
      ...(Array.from({ length: TRADE_PRESETS_COUNT }, (_, i) => i) as TradePresetIndex[]),
      AGENT_TARGET,
    ],
    [],
  );
  /* Segmented control — one rounded container with hairline
     dividers between cells. Cells themselves are flush (no
     individual borders or per-cell rounding), so the row reads as
     a single object rather than four adjacent buttons. */
  return (
    <div
      className="grid grid-cols-4 rounded-md overflow-hidden"
      style={{ border: '1px solid var(--input-border)' }}
    >
      {targets.map((idx) => {
        const isActive = idx === active;
        const isLast = idx === targets.length - 1;
        return (
          <button
            key={String(idx)}
            type="button"
            onClick={() => onSelect(idx)}
            className="h-9 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
            style={{
              background: isActive ? 'var(--accent-primary)' : 'transparent',
              color: isActive ? INK_ON_ACCENT : 'var(--ink-2)',
              /* Inter-cell hairline. The active cell's solid fill
                 visually overrides this on either side, which is
                 the intended effect (the active segment "absorbs"
                 the borders touching it). */
              borderRight: isLast ? 'none' : '1px solid var(--input-border)',
              fontFamily: 'var(--sans)',
            }}
            aria-pressed={isActive}
          >
            {idx === AGENT_TARGET ? 'Agent' : `Preset ${idx + 1}`}
          </button>
        );
      })}
    </div>
  );
}

/* ── Buy / Sell side tab row ─────────────────────────────────────── */

/* Buy/Sell side tabs reuse the canonical `.seg` + `.seg__btn--buy/--sell`
   styling defined in `terminal/components/listen/listen.css` so this
   modal's Buy/Sell selector matches the Trade page's Buy/Sell tabs
   pixel-for-pixel:
     - active Buy:  bright `var(--up)` text, 14% wash background,
                    35% tinted border, soft outer glow.
     - active Sell: same recipe with `var(--down)`.
   Previously we tried a 28% wash + white-ish text, which diverged
   from the rest of the app — the user flagged that the green/red
   didn't match what they see when clicking Buy/Sell elsewhere. */
function SideTabRow({
  active,
  onSelect,
}: {
  active: TradePresetSideKey;
  onSelect: (next: TradePresetSideKey) => void;
}) {
  return (
    <div className="seg w-full" style={{ gap: 4 }}>
      <button
        type="button"
        onClick={() => onSelect('buy')}
        className={`seg__btn seg__btn--buy flex-1 ${active === 'buy' ? 'active' : ''}`}
        style={{ height: 36, fontSize: 12, fontWeight: 600 }}
        aria-pressed={active === 'buy'}
      >
        Buy Settings
      </button>
      <button
        type="button"
        onClick={() => onSelect('sell')}
        className={`seg__btn seg__btn--sell flex-1 ${active === 'sell' ? 'active' : ''}`}
        style={{ height: 36, fontSize: 12, fontWeight: 600 }}
        aria-pressed={active === 'sell'}
      >
        Sell Settings
      </button>
    </div>
  );
}

/* ── Agent preset body ───────────────────────────────────────────── */

/**
 * What the Agent tab shows in place of a numbered preset's editor: the
 * same three knob frames, plus the "defaults from Preset 1" affordance.
 *
 * Until the user configures anything this DISPLAYS Preset 1's values and
 * says so, but persists nothing — the agent keeps compiling at platform
 * defaults. The first edit (or Copy) is what makes it real, which is why
 * merely opening this tab cannot change how anyone's conditionals compile.
 */
function AgentPresetBody({
  view,
  side,
  onSelectSide,
  configured,
  onFieldChange,
  onSendModeChange,
  onCopyFromP1,
}: {
  view: AgentPresetFields;
  side: TradePresetSideKey;
  onSelectSide: (next: TradePresetSideKey) => void;
  configured: boolean;
  onFieldChange: (field: AgentPresetField, value: number) => void;
  onSendModeChange: (mode: SendMode) => void;
  onCopyFromP1: () => void;
}) {
  const values = view[side];
  return (
    <>
      <SideTabRow active={side} onSelect={onSelectSide} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-xs font-medium"
            style={{ color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}
          >
            {configured ? "The agent's limits" : 'Defaults from Preset 1'}
          </span>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="About the agent preset"
                  className="inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] rounded-sm"
                  style={{ color: 'var(--ink-3)' }}
                >
                  <Info style={{ width: 12, height: 12 }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <p className="text-[11px] leading-relaxed">
                  Your ceiling for the agent. It uses these when a conditional
                  you asked for does not state a value, and it will not go
                  above them even if the chat asks for more. Platform limits
                  still backstop your numbers; anything lowered is named on the
                  approval card.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <button
          type="button"
          onClick={onCopyFromP1}
          className="h-6 px-2 rounded-md text-[11px] font-semibold inline-flex items-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
          style={{
            border: '1px solid var(--input-border)',
            background: 'var(--surface-2)',
            color: 'var(--ink-1)',
            fontFamily: 'var(--sans)',
          }}
        >
          Reset to Preset 1
        </button>
      </div>

      <FieldsGrid side={values} onFieldChange={onFieldChange} />

      <SendModeRow active={values.send_mode} onSelect={onSendModeChange} />

      <span
        className="text-[11px] leading-snug"
        style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}
      >
        {configured
          ? 'The agent uses these, and will not exceed them. Manual trades keep using the selected preset.'
          : "Showing Preset 1\u2019s values. Edit any field to give the agent its own."}
      </span>
    </>
  );
}

/* ── Inputs grid (slippage / priority / bribe) ───────────────────── */

function FieldsGrid({
  side,
  onFieldChange,
}: {
  side: TradePresetSide;
  onFieldChange: (field: TradePresetNumericField, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SlippageInput
        valueBps={side.slippage_bps}
        onCommit={(bps) => onFieldChange('slippage_bps', bps)}
      />
      <SolInput
        label="PRIORITY"
        icon={<Gas style={{ width: 12, height: 12 }} />}
        valueLamports={side.priority_lamports}
        minLamports={Number(PRIORITY_LAMPORTS_MIN)}
        maxLamports={Number(PRIORITY_LAMPORTS_MAX)}
        onCommit={(lamports) => onFieldChange('priority_lamports', lamports)}
      />
      <SolInput
        label="BRIBE"
        icon={<Tip style={{ width: 12, height: 12 }} />}
        valueLamports={side.bribe_lamports}
        minLamports={Number(BRIBE_LAMPORTS_MIN)}
        maxLamports={Number(BRIBE_LAMPORTS_MAX)}
        onCommit={(lamports) => onFieldChange('bribe_lamports', lamports)}
      />
    </div>
  );
}

/**
 * Shared visual frame for an input + label cell. The Axiom reference
 * splits the cell into TWO equal-height halves separated by a 1px
 * hairline: the top half holds the centered numeric value (with an
 * optional unit suffix pinned to the right edge), the bottom half
 * holds the centered icon + label. Both halves are tall enough to
 * give the digits and the label real presence — earlier versions
 * tried to compress everything into a single padded block and the
 * label ended up looking like an afterthought.
 */
function InputFrame({
  children,
  label,
  icon,
  unit,
}: {
  children: ReactNode;
  label: string;
  icon: ReactNode;
  unit?: string;
}) {
  /* All sizing here uses the design system's tokens rather than
     arbitrary pixel values:
       - Heights `h-7` (28px) / `h-px` / `h-5` (20px) come from the
         standard Tailwind scale.
       - Typography uses `.dp-label` (11px sans medium uppercase
         tracking-0.12em color-ink-3) and `.dp-mono-lg` (14px mono
         medium tabular-nums tracking-0.03em) defined in
         `app/globals.css`. The numeric input class is set by its
         caller so per-field overrides (semibold, ink-0) can layer
         on top of the base mono class.
       - The unit ("%") uses `text-xs` (12px) — sized BELOW the
         value but ABOVE the label, signalling it as a secondary
         marker on the value row. */
  return (
    <div
      className="flex flex-col rounded-md overflow-hidden"
      style={{ border: '1px solid var(--input-border)' }}
    >
      {/* Top half: value row. Filled with `--surface-2` (#1a1a20) —
          a deliberate lift above the modal's `--surface-1` so the
          value band reads as the interactive surface, distinct from
          the label band below it. */}
      <div
        className="relative h-7 flex items-center justify-center px-2.5"
        style={{ background: 'var(--surface-2)' }}
      >
        {children}
        {unit ? (
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-xs"
            style={{
              color: 'var(--ink-3)',
              fontFamily: 'var(--sans)',
              fontWeight: 500,
            }}
          >
            {unit}
          </span>
        ) : null}
      </div>

      {/* Hairline divider between the two surface tiers. */}
      <div className="h-px" style={{ background: 'var(--hairline)' }} />

      {/* Bottom half: icon + label. Filled with `--surface-1` —
          the SAME flat fill as the modal background, so the label
          band visually grounds into the modal and the value band
          floats above it. */}
      <div
        className="dp-label-sm h-5 flex items-center justify-center gap-1.5"
        style={{ background: 'var(--surface-1)' }}
      >
        {icon}
        <span>{label}</span>
      </div>
    </div>
  );
}

/* Slippage input — displays as percent (1500 bps -> "15"), wire is bps.
   The "%" suffix lives in the cell's top-right corner so the number
   gets the full row width. */
function SlippageInput({
  valueBps,
  onCommit,
}: {
  valueBps: number;
  onCommit: (bps: number) => void;
}) {
  const formatted = useMemo(() => formatPercentFromBps(valueBps), [valueBps]);
  const [draft, setDraft] = useState(formatted);

  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (typeof document !== 'undefined' && ref.current === document.activeElement) return;
    setDraft(formatted);
  }, [formatted]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setDraft(raw);
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      const parsedPct = Number(trimmed);
      if (!Number.isFinite(parsedPct) || parsedPct < 0) return;
      const bps = Math.round(parsedPct * 100);
      const clamped = Math.min(Math.max(bps, SLIPPAGE_BPS_MIN), SLIPPAGE_BPS_MAX);
      onCommit(clamped);
    },
    [onCommit],
  );

  return (
    <InputFrame
      label="SLIPPAGE"
      icon={<Slip style={{ width: 12, height: 12 }} />}
      unit="%"
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={handleChange}
        onBlur={() => setDraft(formatPercentFromBps(valueBps))}
        aria-label="Slippage percent"
        /* `.dp-mono-sm` brings font + tabular-nums + tracking
           from the design system (11px mono medium 0.01em).
           Local utilities layer the bits the system doesn't
           address: ink-0 color, semibold weight (vs system's
           medium), centered alignment, transparent background,
           and the leading override so the digit sits at the 28px
           cell's vertical midline. */
        className="dp-mono-sm font-semibold leading-none text-center w-full bg-transparent border-0 outline-none p-0"
        style={{ color: 'var(--ink-0)' }}
      />
    </InputFrame>
  );
}

/* Priority / Bribe input — displays as SOL, wire is lamports. */
function SolInput({
  label,
  icon,
  valueLamports,
  minLamports,
  maxLamports,
  onCommit,
}: {
  label: string;
  icon: ReactNode;
  valueLamports: number;
  minLamports: number;
  maxLamports: number;
  onCommit: (lamports: number) => void;
}) {
  const formatted = useMemo(() => formatSolFromLamports(valueLamports), [valueLamports]);
  const [draft, setDraft] = useState(formatted);

  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (typeof document !== 'undefined' && ref.current === document.activeElement) return;
    setDraft(formatted);
  }, [formatted]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setDraft(raw);
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        /* Empty = the field's minimum (typically 0 lamports for
           priority / bribe). The bounds-validator accepts 0 for
           these fields (unlike slippage where 0 bps would be 0%
           which the server rejects). */
        onCommit(minLamports);
        return;
      }
      const sol = Number(trimmed);
      if (!Number.isFinite(sol) || sol < 0) return;
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const clamped = Math.min(Math.max(lamports, minLamports), maxLamports);
      onCommit(clamped);
    },
    [onCommit, minLamports, maxLamports],
  );

  return (
    <InputFrame label={label} icon={icon}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={handleChange}
        onBlur={() => setDraft(formatSolFromLamports(valueLamports))}
        aria-label={`${label} in SOL`}
        /* See SlippageInput for the rationale on the `.dp-mono-sm`
           + local overrides composition. */
        className="dp-mono-sm font-semibold leading-none text-center w-full bg-transparent border-0 outline-none p-0"
        style={{ color: 'var(--ink-0)' }}
      />
    </InputFrame>
  );
}

/* ── Send Mode (per preset side) ─────────────────────────────────── */

/* Display labels for the wire enum. Kept short so six pills fit the
   modal width; '0slot' / 'Spray' match the trading-desk shorthand. */
const SEND_MODE_LABELS: Record<SendMode, string> = {
  auto: 'Auto',
  rpc: 'RPC',
  jito: 'Jito',
  zeroslot: '0slot',
  nozomi: 'Nozomi',
  nonceSpray: 'Spray',
};

/**
 * Send-path selector for the active preset side. Unlike the inert MEV
 * row below, this is wired: the selection persists per preset x side
 * (like slippage/priority/bribe) and flows into every order body via
 * the trade surfaces' preset reads. 'Auto' is the default (engine
 * picks the path); 'Spray' = nonceSpray fan-out.
 */
function SendModeRow({
  active,
  onSelect,
}: {
  active: SendMode;
  onSelect: (mode: SendMode) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="text-xs font-medium shrink-0"
        style={{ color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}
      >
        Send Mode
      </span>
      <div
        className="flex flex-1 rounded-md overflow-hidden"
        style={{ border: '1px solid var(--input-border)' }}
      >
        {SEND_MODES.map((mode) => {
          const isActive = mode === active;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSelect(mode)}
              className="flex-1 h-7 text-[11px] font-semibold inline-flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)]"
              style={{
                color: isActive ? INK_ON_ACCENT : 'var(--ink-3)',
                background: isActive ? 'var(--accent-primary)' : 'transparent',
                fontFamily: 'var(--sans)',
              }}
              aria-pressed={isActive}
              aria-label={`Send mode ${SEND_MODE_LABELS[mode]}`}
            >
              {SEND_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── MEV Mode (visual only) ──────────────────────────────────────── */

function MevModeRow() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}
        >
          MEV Mode
        </span>
        {/* Help tooltip — three-section explainer keyed to the
            Off / Reduced / Secure pills to the right. Triggered by
            the info icon; hover or keyboard-focus opens. Provider is
            scoped to this single tooltip so we don't introduce a
            modal-wide tooltip context for one consumer. */}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About MEV Mode"
                className="inline-flex items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                style={{ width: 14, height: 14, color: 'var(--ink-3)' }}
              >
                <Info style={{ width: 12, height: 12 }} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-[280px] p-3">
              <MevModeHelp />
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div
        className="flex flex-1 rounded-md overflow-hidden"
        style={{ border: '1px solid var(--input-border)' }}
      >
        <MevPill icon={<ShieldOff style={{ width: 11, height: 11 }} />} label="Off" isActive />
        <MevPill
          icon={<Shield style={{ width: 11, height: 11 }} />}
          label="Reduced"
          isActive={false}
        />
        <MevPill
          icon={<ShieldCheck style={{ width: 11, height: 11 }} />}
          label="Secure"
          isActive={false}
        />
      </div>
    </div>
  );
}

/* Inline tooltip body. Each section is a `<dt>`-style label + a
   short `<dd>`-style description, rendered as a tight vertical
   stack. Kept here as a colocated component rather than inlining
   in `MevModeRow` so the data + layout for the help copy lives in
   one readable block. */
function MevModeHelp() {
  return (
    <div
      className="flex flex-col gap-2.5 text-left"
      style={{ fontFamily: 'var(--sans)' }}
    >
      <MevModeHelpSection
        label="Off"
        description="Send trades as fast as possible to all Solana validators."
      />
      <MevModeHelpSection
        label="Reduced"
        description="Avoid sending transactions to blacklisted validators to reduce chances of MEV attacks."
      />
      <MevModeHelpSection
        label="Secure"
        beta
        description="Only sends transactions to whitelisted validators. This can be slow."
      />
    </div>
  );
}

function MevModeHelpSection({
  label,
  description,
  beta,
}: {
  label: string;
  description: string;
  beta?: boolean;
}) {
  return (
    <div>
      <div
        className="text-xs font-semibold leading-tight"
        style={{ color: 'var(--ink-0)' }}
      >
        {label}
        {beta ? (
          <span
            className="ml-1.5 text-[10px] font-medium"
            style={{ color: 'var(--ink-3)' }}
          >
            [BETA]
          </span>
        ) : null}
      </div>
      <div
        className="text-[11px] leading-snug mt-0.5"
        style={{ color: 'var(--ink-2)' }}
      >
        {description}
      </div>
    </div>
  );
}

function MevPill({
  icon,
  label,
  isActive,
}: {
  icon: ReactNode;
  label: string;
  isActive: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        /* Intentional no-op: MEV mode is not wired up yet. The
           click is swallowed so the visible Off / Reduced / Secure
           selection doesn't change. */
      }}
      aria-disabled
      // The row's selected state lived only in an inline colour, so the
      // stylesheet had nothing to hook and the Off pill stayed accent
      // while every other selected control on the panel had moved. It is
      // a toggle showing state, so it should have carried this anyway.
      aria-pressed={isActive}
      className="flex-1 h-7 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-default"
      style={{
        color: isActive ? INK_ON_ACCENT : 'var(--ink-3)',
        background: isActive ? 'var(--accent-primary)' : 'transparent',
        fontFamily: 'var(--sans)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ── RPC field (visual only) ─────────────────────────────────────── */

function RpcField() {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 h-9 cursor-not-allowed"
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--input-border)',
      }}
      title="Coming soon"
    >
      <span
        className="text-xs font-medium"
        style={{ color: 'var(--ink-2)', fontFamily: 'var(--sans)' }}
      >
        RPC
      </span>
      <input
        type="text"
        value="https://a...e.com"
        readOnly
        aria-readonly
        className="bg-transparent border-0 outline-none flex-1 text-xs cursor-not-allowed"
        style={{ color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}
      />
    </div>
  );
}

/* ── Continue button ─────────────────────────────────────────────── */

function ContinueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12 w-full rounded-full text-[15px] font-semibold transition-opacity hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2"
      style={{
        background: 'var(--accent-primary)',
        color: INK_ON_ACCENT,
        fontFamily: 'var(--sans)',
      }}
    >
      Continue
    </button>
  );
}

/* ── Formatting helpers ──────────────────────────────────────────── */

function formatPercentFromBps(bps: number): string {
  /* 1500 bps -> "15". Trims trailing zeros so "1500" never renders
     as "15.00". */
  const pct = bps / 100;
  if (Number.isInteger(pct)) return pct.toString();
  return pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatSolFromLamports(lamports: number): string {
  /* 1_000_000 lamports -> "0.001". Drops trailing zeros so common
     round values render compactly. */
  if (lamports === 0) return '0';
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}
