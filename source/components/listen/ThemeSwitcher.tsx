import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTheme } from './theme/useTheme';
import {
  WALLET_TOAST_DURATION_MAX_MS,
  WALLET_TOAST_DURATION_MIN_MS,
  WALLET_TOAST_SCALE_MAX,
  WALLET_TOAST_SCALE_MIN,
  useWalletToastStyle,
} from '@/lib/state/wallet-toast-style';
import { THEMES, THEME_GROUP_ORDER, type Theme, type ThemeGroup } from './theme/themes';
import { SANS_FONTS, MONO_FONTS, DISPLAY_FONTS } from './theme/fonts';
import './tweaks-v2.css';
import { getTradeSuccessVolume, setTradeSuccessVolume } from '@/components/trade/tradeSound';
import { getQuickbuyAlways, setQuickbuyAlways } from '@/lib/state/coincard-prefs';
import {
  getAttentionBellVolume,
  getPlayInBackground,
  getTweetChimeVolume,
  getWalletToastStackMode,
  getWalletToastVolume,
  setAttentionBellVolume,
  setPlayInBackground,
  setTweetChimeVolume,
  setWalletToastStackMode,
  setWalletToastVolume,
  type WalletSoundStackMode,
} from '@/components/discover/attentionSounds';
import {
  useDiscoverStore,
  type CardSize,
  type LayoutMode,
  type SectionId,
} from '@/lib/state/discover-store';
import {
  LOW_DPI_MEDIA_QUERY,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  useUiScale,
} from '@/lib/state/ui-scale';
import {
  BUY_BACKGROUNDS,
  BUY_FOREGROUNDS,
  useBuyStyle,
  type BuyShape,
  type BuySize,
} from '@/lib/state/buyStyle';

interface Props {
  onClose: () => void;
  /** Inline positioning relative to the anchor's positioned parent. */
  anchorStyle?: CSSProperties;
  /** When the popover is PORTALED away from its anchor (so the anchor is no
   *  longer an ancestor), pass the anchor element here — clicks on it keep
   *  toggling via its own onClick instead of racing the outside-click close. */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * Listen — theme + font switcher popover.
 *
 * Anchored to its parent (which must be `position: relative`), the
 * popover dismisses on Escape, on click outside, or on clicking the
 * close button. Focus moves to the first interactive element on open
 * and focus-trap is **not** enforced — this is a non-modal popover, so
 * tabbing past the last control returns to the page; that's the expected
 * behavior for this kind of utility tool.
 */
export function ThemeSwitcher({ onClose, anchorStyle, anchorRef }: Props) {
  const { style: buy, set: setBuy } = useBuyStyle();
  const {
    theme,
    sans,
    mono,
    display,
    setThemeId,
    setFontSans,
    setFontMono,
    setFontDisplay,
    reset,
  } = useTheme();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [tradeSuccessVolume, setTradeSuccessVolumeState] = useState(() => getTradeSuccessVolume());
  const [attentionBellVolume, setAttentionBellVolumeState] = useState(() => getAttentionBellVolume());
  const [walletToastVolume, setWalletToastVolumeState] = useState(() => getWalletToastVolume());
  const [tweetChimeVolume, setTweetChimeVolumeState] = useState(() => getTweetChimeVolume());
  const layout = useDiscoverStore((s) => s.layout);
  const patchLayout = useDiscoverStore((s) => s.patchLayout);
  const setSectionVisible = useDiscoverStore((s) => s.setSectionVisible);
  const resetSizes = useDiscoverStore((s) => s.resetSizes);
  const cardSize = layout.cardSize;
  const layoutMode = layout.mode;

  /* Close on Escape and on outside click. The mousedown listener (rather
     than click) prevents the popover from closing while the user is
     dragging a selection inside a <select> dropdown overlay. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onPointer(e: MouseEvent) {
      if (!popoverRef.current) return;
      const target = e.target as Node;
      if (popoverRef.current.contains(target)) return;
      /* Clicks on the anchor (cog button) toggle via its own onClick;
         the parent's relative wrapper contains both, so we walk up to it
         once. Portaled mounts pass the anchor explicitly instead. */
      if (anchorRef?.current?.contains(target)) return;
      const parent = popoverRef.current.parentElement;
      if (parent && parent.contains(target)) return;
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [anchorRef, onClose]);

  const groups = useMemo(() => {
    const buckets = new Map<ThemeGroup, Theme[]>();
    for (const id of Object.keys(THEMES)) {
      const t = THEMES[id]!;
      const list = buckets.get(t.group) ?? [];
      list.push(t);
      buckets.set(t.group, list);
    }
    return THEME_GROUP_ORDER.map((g) => ({ group: g, items: buckets.get(g) ?? [] }));
  }, []);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Theme settings"
      className="ts-popover"
      style={anchorStyle}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-[14px] py-[10px]"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span
          className="text-[12px] font-semibold uppercase tracking-[0.04em]"
          style={{ color: 'rgba(255,255,255,0.7)' }}
        >
          Tweaks
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex items-center justify-center rounded-[6px]"
          style={{
            width: 22,
            height: 22,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '4px 0 12px' }}>
        {/*
          * ── QUICK BUY ────────────────────────────────────────────
          *
          * The one control on a token row, so it gets its own section
          * rather than living under Typography.
          *
          * Size first, because it is the only choice here that changes
          * the row's LAYOUT — ultra is a panel down the row's edge, not
          * a larger chip — and the colours read differently at each
          * size, so picking them first means picking them twice.
          */}
        <div className="ts-section">Quick buy</div>
        <SegRow<BuySize>
          value={buy.size}
          onChange={(size) => setBuy({ size })}
          options={[
            { id: 'small', label: 'Small' },
            { id: 'medium', label: 'Medium' },
            { id: 'ultra', label: 'Ultra' },
          ]}
        />
        <SegRow<BuyShape>
          value={buy.shape}
          onChange={(shape) => setBuy({ shape })}
          options={[
            { id: 'rounded', label: 'Rounded' },
            { id: 'sharp', label: 'Sharp' },
          ]}
        />
        <div className="ts-label">Button</div>
        <SwatchRow value={buy.bg} onChange={(bg) => setBuy({ bg })} options={BUY_BACKGROUNDS} />
        <div className="ts-label">Label</div>
        <SwatchRow value={buy.fg} onChange={(fg) => setBuy({ fg })} options={BUY_FOREGROUNDS} />

        <div className="ts-section">Typography</div>
        <FontSelect
          label="Sans (UI)"
          value={sans.name}
          options={SANS_FONTS.map((f) => f.name)}
          onChange={setFontSans}
        />
        <FontSelect
          label="Mono (numbers)"
          value={mono.name}
          options={MONO_FONTS.map((f) => f.name)}
          onChange={setFontMono}
        />
        <FontSelect
          label="Display (flourish)"
          value={display.name}
          options={DISPLAY_FONTS.map((f) => f.name)}
          onChange={setFontDisplay}
        />

        {/* Live preview — applies the active fonts + accent inline so the
            user sees changes before committing. */}
        <div className="ts-preview">
          <span
            style={{
              fontFamily: display.stack,
              fontStyle: 'italic',
              fontSize: 18,
              color: theme.primary,
              lineHeight: 1,
            }}
          >
            listen to the dolphin
          </span>
          <span
            style={{
              fontFamily: sans.stack,
              fontSize: 13,
              color: 'rgba(255,255,255,0.85)',
              fontWeight: 500,
            }}
          >
            DOLPHIN · PumpSwap · 1h ago
          </span>
          <span
            style={{
              fontFamily: mono.stack,
              fontSize: 14,
              color: '#fff',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            $0.000204 → +35.1%
          </span>
        </div>

        <div className="ts-section">Layout</div>
        <SegRow<LayoutMode>
          value={layoutMode}
          onChange={(mode) => patchLayout({ mode })}
          options={[
            { id: 'rows', label: 'Rows' },
            { id: 'columns', label: 'Columns' },
          ]}
        />

        <div className="ts-section">Sections</div>
        <div className="flex flex-col gap-1 px-[14px] pb-2">
          {SECTION_TOGGLES.map((s) => (
            <ToggleRow
              key={s.id}
              label={s.label}
              checked={layout.visible[s.id]}
              onChange={(v) => setSectionVisible(s.id, v)}
            />
          ))}
        </div>

        <div className="ts-section">Second row</div>
        <div className="flex flex-col gap-2 px-[14px] pb-2">
          <ToggleRow
            label="Auto when room"
            checked={layout.autoSecondRow}
            onChange={(v) => patchLayout({ autoSecondRow: v })}
          />
          {layout.autoSecondRow ? (
            <SegRow<SectionId>
              value={layout.secondRowTarget}
              onChange={(target) => patchLayout({ secondRowTarget: target })}
              options={SECOND_ROW_OPTIONS}
            />
          ) : null}
        </div>

        <div className="ts-section">Card size</div>
        <SegRow<CardSize>
          value={cardSize}
          onChange={(size) => patchLayout({ cardSize: size })}
          options={CARD_SIZE_OPTIONS}
        />
        <div className="flex justify-end px-[14px] pb-1">
          {/* Scoped reset — only the dragged section sizes, NOT theme/fonts. */}
          <button
            type="button"
            onClick={resetSizes}
            className="text-[10px] uppercase tracking-[0.08em] text-white/45 transition-colors hover:text-white/80"
            style={{ fontFamily: 'var(--mono)', cursor: 'pointer' }}
          >
            Reset section sizes
          </button>
        </div>

        <div className="ts-section">Theme</div>
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="ts-section" style={{ fontSize: 9, paddingTop: 8 }}>
              {group}
            </div>
            <div className="ts-swatch-grid">
              {items.map((t) => (
                <Swatch
                  key={t.id}
                  theme={t}
                  active={theme.id === t.id}
                  onClick={() => setThemeId(t.id)}
                />
              ))}
            </div>
          </div>
        ))}

        <UiScaleControls />

        <div className="ts-section">Sound</div>
        <VolumeSlider
          label="Trade success"
          value={tradeSuccessVolume}
          onChange={(next) => {
            setTradeSuccessVolumeState(next);
            setTradeSuccessVolume(next);
          }}
        />
        <VolumeSlider
          label="Alpha & graduation bell"
          value={attentionBellVolume}
          onChange={(next) => {
            setAttentionBellVolumeState(next);
            setAttentionBellVolume(next);
          }}
        />
        <VolumeSlider
          label="Wallet toasts"
          value={walletToastVolume}
          onChange={(next) => {
            setWalletToastVolumeState(next);
            setWalletToastVolume(next);
          }}
        />
        <VolumeSlider
          label="New tweets"
          value={tweetChimeVolume}
          onChange={(next) => {
            setTweetChimeVolumeState(next);
            setTweetChimeVolume(next);
          }}
        />

        <div className="ts-section">Wallet toasts</div>
        <WalletToastStyleControls />

        <div className="ts-section">Coin cards</div>
        <CoinCardPrefControls />

        <button
          type="button"
          onClick={reset}
          className="ts-reset"
          style={{ width: 'calc(100% - 28px)' }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

const CARD_SIZE_OPTIONS: { id: CardSize; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'default', label: 'Default' },
  { id: 'large', label: 'Large' },
  { id: 'fill', label: 'Fill' },
];

const SECTION_TOGGLES: { id: SectionId; label: string }[] = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'new-pairs', label: 'New Pairs' },
  { id: 'almost-graduated', label: 'Ripening' },
  { id: 'graduated', label: 'Graduated' },
];

const SECOND_ROW_OPTIONS: { id: SectionId; label: string }[] = [
  { id: 'new-pairs', label: 'New Pairs' },
  { id: 'almost-graduated', label: 'Ripening' },
  { id: 'graduated', label: 'Graduated' },
];

/** Label + switch row used for section show/hide and toggles. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 rounded-[6px] px-2 py-1 text-left transition-colors hover:bg-white/[0.03]"
      style={{ cursor: 'pointer' }}
    >
      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {label}
      </span>
      <span
        aria-hidden
        className="relative inline-block h-[14px] w-[26px] rounded-full transition-colors"
        style={{
          background: checked ? 'var(--accent-primary)' : 'rgba(255,255,255,0.12)',
        }}
      >
        <span
          className="absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-all"
          style={{ left: checked ? 14 : 2 }}
        />
      </span>
    </button>
  );
}

/**
 * Compact segmented control (used for Layout + Card size). Writes through to
 * the Discover store (persisted). The active border picks up the live theme
 * accent so it tracks the chosen palette like the theme swatches do.
 */
/*
 * Colour is chosen by LOOKING at it. A row of named buttons makes you
 * translate "Deep green" into a swatch you cannot see, which is two
 * steps for a decision that is entirely visual — so the swatch is the
 * control and the name is only its tooltip.
 */
function SwatchRow({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="flex gap-1.5 px-[14px] pb-2">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className="h-[22px] flex-1 rounded-[6px] transition-transform"
            style={{
              /* `transparent` is a real choice, so it has to look like
                 one rather than like a missing swatch. */
              background:
                o.id === 'transparent'
                  ? 'repeating-linear-gradient(45deg,rgba(255,255,255,0.09) 0 4px,transparent 4px 8px)'
                  : o.id,
              border: `1px solid ${active ? 'var(--tw-line-on)' : 'var(--tw-line)'}`,
              boxShadow: active ? '0 0 0 2px var(--tw-ring)' : 'none',
              cursor: 'pointer',
            }}
          />
        );
      })}
    </div>
  );
}

function SegRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 px-[14px] pb-2">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            className="flex-1 rounded-[6px] py-[6px] text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors"
            style={{
              color: active ? 'var(--tw-ink)' : 'var(--tw-ink-3)',
              background: active ? 'var(--tw-fill-on)' : 'var(--tw-fill)',
              border: `1px solid ${active ? 'var(--tw-line-on)' : 'var(--tw-line)'}`,
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function VolumeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const percent = Math.round(value * 100);
  return (
    <div className="ts-row" style={{ alignItems: 'center' }}>
      <div className="ts-label">{label}</div>
      <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-label={`${label} volume`}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          style={{
            width: 104,
            accentColor: 'var(--accent-primary)',
          }}
        />
        <span
          className="t-num-xs"
          style={{
            width: 36,
            textAlign: 'right',
            color: 'rgba(255,255,255,0.72)',
            fontFamily: 'var(--mono)',
          }}
        >
          {percent}%
        </span>
      </div>
    </div>
  );
}

function FontSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="ts-row">
      <div className="ts-label">{label}</div>
      <select className="ts-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Swatch({
  theme,
  active,
  onClick,
}: {
  theme: Theme;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={theme.name}
      aria-pressed={active}
      className={`ts-swatch${active ? ' active' : ''}`}
      style={{
        borderColor: active ? theme.primary : 'rgba(255,255,255,0.08)',
        boxShadow: active ? `0 0 10px -3px ${theme.glow}` : 'none',
      }}
    >
      <div
        className="ts-swatch-fill"
        style={{
          background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
          boxShadow: `0 0 8px -2px ${theme.glow}`,
        }}
      />
      <span className="ts-swatch-name">{theme.name}</span>
    </button>
  );
}

/** How long the slider must sit still before the zoom actually applies.
 *  Re-zooming on every tick moves the popover (and the slider itself)
 *  under the cursor mid-drag, which feels broken. */
const UI_SCALE_COMMIT_DELAY_MS = 800;

/**
 * UI auto-scale dial for standard-density (~1x) screens. The zoom itself
 * is CSS-gated to low-DPI screens (globals.css), so on Retina the
 * preference is inert — hide the whole section there instead of showing
 * a dead control. The percent readout tracks the drag instantly; the zoom
 * commits after the slider rests (inline `--ui-scale-pref` on <html>).
 */
function UiScaleControls() {
  const { scale, setScale, reset } = useUiScale();
  const [lowDpi, setLowDpi] = useState(false);
  // Non-null while the user is dragging and the commit timer is pending.
  const [draft, setDraft] = useState<number | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the unmount flush commits the LATEST pending value.
  const draftRef = useRef<number | null>(null);
  draftRef.current = draft;
  const setScaleRef = useRef(setScale);
  setScaleRef.current = setScale;

  useEffect(() => {
    const mq = window.matchMedia(LOW_DPI_MEDIA_QUERY);
    setLowDpi(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setLowDpi(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Closing the popover with a commit pending must not lose the choice.
  useEffect(
    () => () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
      if (draftRef.current !== null) setScaleRef.current(draftRef.current);
    },
    [],
  );

  const scheduleCommit = (next: number) => {
    setDraft(next);
    if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      setDraft(null);
      setScale(next);
    }, UI_SCALE_COMMIT_DELAY_MS);
  };

  if (!lowDpi) return null;
  const shown = draft ?? scale;
  const percent = Math.round(shown * 100);
  return (
    <>
      <div className="ts-section">UI scale (this screen)</div>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Zoom</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
          <input
            type="range"
            min={Math.round(UI_SCALE_MIN * 100)}
            max={Math.round(UI_SCALE_MAX * 100)}
            step={1}
            value={percent}
            aria-label="UI scale"
            onChange={(e) => scheduleCommit(Number(e.target.value) / 100)}
            style={{ width: 104, accentColor: 'var(--accent-primary)' }}
          />
          <span
            className="t-num-xs"
            style={{
              width: 36,
              textAlign: 'right',
              color: 'rgba(255,255,255,0.72)',
              fontFamily: 'var(--mono)',
            }}
          >
            {percent}%
          </span>
        </div>
      </div>
      <div className="flex justify-end px-[14px] pb-1">
        <button
          type="button"
          onClick={() => {
            // Reset is deliberate — apply immediately, cancel any pending drag commit.
            if (commitTimer.current !== null) {
              clearTimeout(commitTimer.current);
              commitTimer.current = null;
            }
            setDraft(null);
            reset();
          }}
          className="t-num-xs"
          style={{
            color:
              shown === UI_SCALE_DEFAULT ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.72)',
            fontFamily: 'var(--mono)',
            background: 'transparent',
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          {shown === UI_SCALE_DEFAULT ? `default (${Math.round(UI_SCALE_DEFAULT * 100)}%)` : 'reset'}
        </button>
      </div>
    </>
  );
}

function CoinCardPrefControls() {
  const [quickbuyAlways, setQuickbuyAlwaysState] = useState(() => getQuickbuyAlways());
  return (
    <div className="ts-row" style={{ alignItems: 'center' }}>
      <div className="ts-label">Quickbuy always</div>
      <div className="flex items-center gap-2" style={{ minWidth: 150, justifyContent: 'flex-end' }}>
        <button
          type="button"
          aria-pressed={quickbuyAlways}
          onClick={() => {
            const next = !quickbuyAlways;
            setQuickbuyAlwaysState(next);
            setQuickbuyAlways(next);
          }}
          className="t-num-xs"
          style={{
            color: quickbuyAlways ? 'var(--accent-primary)' : 'rgba(255,255,255,0.55)',
            fontFamily: 'var(--mono)',
            background: 'transparent',
            border: '1px solid var(--hairline)',
            borderRadius: 6,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          {quickbuyAlways ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}

function WalletToastStyleControls() {
  const { scale, accent, durationMs, setScale, setAccent, setDurationMs, reset } = useWalletToastStyle();
  // Sound behavior flags live in attentionSounds' localStorage pattern
  // (read imperatively at play time); local state mirrors them for the UI,
  // same as the volume sliders above.
  const [playInBackground, setPlayInBackgroundState] = useState(() => getPlayInBackground());
  const [stackMode, setStackModeState] = useState<WalletSoundStackMode>(() => getWalletToastStackMode());
  const percent = Math.round(scale * 100);
  const min = Math.round(WALLET_TOAST_SCALE_MIN * 100);
  const max = Math.round(WALLET_TOAST_SCALE_MAX * 100);
  const durationSec = (durationMs ?? 6_500) / 1_000;
  const isDefault = accent === null && scale === 1 && durationMs === null;
  return (
    <>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Timer</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
          <input
            type="range"
            min={WALLET_TOAST_DURATION_MIN_MS / 1_000}
            max={WALLET_TOAST_DURATION_MAX_MS / 1_000}
            step={0.5}
            value={durationSec}
            aria-label="Wallet toast on-screen time"
            onChange={(e) => setDurationMs(Number(e.target.value) * 1_000)}
            style={{ width: 104, accentColor: 'var(--accent-primary)' }}
          />
          <span
            className="t-num-xs"
            style={{
              width: 36,
              textAlign: 'right',
              color: 'rgba(255,255,255,0.72)',
              fontFamily: 'var(--mono)',
            }}
          >
            {durationMs === null ? 'auto' : `${durationSec}s`}
          </span>
        </div>
      </div>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Play in background</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150, justifyContent: 'flex-end' }}>
          <button
            type="button"
            aria-pressed={playInBackground}
            onClick={() => {
              const next = !playInBackground;
              setPlayInBackgroundState(next);
              setPlayInBackground(next);
            }}
            className="t-num-xs"
            style={{
              color: playInBackground ? 'var(--accent-primary)' : 'rgba(255,255,255,0.55)',
              fontFamily: 'var(--mono)',
              background: 'transparent',
              border: '1px solid var(--hairline)',
              borderRadius: 6,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            {playInBackground ? 'on' : 'off'}
          </button>
        </div>
      </div>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Sound stacking</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150, justifyContent: 'flex-end' }}>
          {(['chill', 'stack'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={stackMode === mode}
              onClick={() => {
                setStackModeState(mode);
                setWalletToastStackMode(mode);
              }}
              className="t-num-xs"
              style={{
                color: stackMode === mode ? 'var(--accent-primary)' : 'rgba(255,255,255,0.55)',
                fontFamily: 'var(--mono)',
                background: 'transparent',
                border: '1px solid var(--hairline)',
                borderRadius: 6,
                padding: '2px 8px',
                cursor: 'pointer',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Size</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150 }}>
          <input
            type="range"
            min={min}
            max={max}
            step={5}
            value={percent}
            aria-label="Wallet toast size"
            onChange={(e) => setScale(Number(e.target.value) / 100)}
            style={{ width: 104, accentColor: 'var(--accent-primary)' }}
          />
          <span
            className="t-num-xs"
            style={{
              width: 36,
              textAlign: 'right',
              color: 'rgba(255,255,255,0.72)',
              fontFamily: 'var(--mono)',
            }}
          >
            {percent}%
          </span>
        </div>
      </div>
      <div className="ts-row" style={{ alignItems: 'center' }}>
        <div className="ts-label">Tint</div>
        <div className="flex items-center gap-2" style={{ minWidth: 150, justifyContent: 'flex-end' }}>
          <input
            type="color"
            value={accent ?? '#2de19f'}
            aria-label="Wallet toast tint"
            onChange={(e) => setAccent(e.target.value)}
            style={{
              width: 36,
              height: 22,
              padding: 0,
              border: '1px solid var(--hairline)',
              borderRadius: 6,
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
          <button
            type="button"
            onClick={() => reset()}
            className="t-num-xs"
            style={{
              color: isDefault ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.72)',
              fontFamily: 'var(--mono)',
              background: 'transparent',
              border: '1px solid var(--hairline)',
              borderRadius: 6,
              padding: '2px 8px',
              cursor: 'pointer',
            }}
          >
            {isDefault ? 'default' : 'reset'}
          </button>
        </div>
      </div>
    </>
  );
}
