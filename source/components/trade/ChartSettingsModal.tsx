'use client';

import { useEffect, useState } from 'react';
import { useTradePaneHidden } from './tradePaneVisibility';
import type { CSSProperties } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useChartPrefsStore } from '@/lib/state/chart-prefs-store';
import { useThemeMode } from '@/lib/theme-mode';
import {
  CHART_STYLE_PRESETS,
  paintToRgba,
  themedChartStyle,
  type BackdropPattern,
  type BackgroundMode,
  type CandlePartMode,
  type ChartGridMode,
  type ChartLineStyle,
  type ChartStylePreset,
  type Paint,
} from '@/lib/state/chart-style';

/**
 * Chart Studio — the full canvas-design dialog. Every control writes
 * straight to the chart-prefs store (complete section objects — the
 * store patch replaces sections wholesale); PriceChart subscribes and
 * applies the options live, so edits preview in real time behind the
 * dialog. Opened from the toolbar Settings icon or the chart's
 * right-click menu.
 *
 * Anatomy: a presets strip (curated starting points — stamps, not
 * states) followed by one section per paintable surface. The core
 * control is PaintControl: color swatch + 0-100 opacity slider + mono
 * % readout, because opacity is a first-class knob everywhere in the
 * style model.
 *
 * Built on the shared Radix Dialog: the trade page's chart column
 * lives inside a transformed panel stack, which turns a hand-rolled
 * `position: fixed` overlay into a chart-relative (click-through)
 * layer — the Dialog portals out to the themed root instead, with a
 * real solid backdrop.
 */

const GRID_MODES: ReadonlyArray<{ value: ChartGridMode; label: string }> = [
  { value: 'both', label: 'Vert and horz' },
  { value: 'vert', label: 'Vertical' },
  { value: 'horz', label: 'Horizontal' },
  { value: 'none', label: 'None' },
];

const LINE_STYLES: ReadonlyArray<{ value: ChartLineStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'dashed', label: 'Dashed' },
];

const PART_MODES: ReadonlyArray<{ value: CandlePartMode; label: string }> = [
  { value: 'match', label: 'Match body' },
  { value: 'custom', label: 'Custom' },
  { value: 'none', label: 'None' },
];

const PATTERNS: ReadonlyArray<{ value: BackdropPattern; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'grid', label: 'Grid' },
  { value: 'graph', label: 'Graph' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'plus', label: 'Plus' },
];

export function ChartSettingsModal(): React.ReactElement | null {
  const open = useChartPrefsStore((s) => s.settingsOpen);
  // The dialog portals ABOVE the persistent trade pane: when the pane
  // hides (route change), a still-open dialog would float over the new
  // page. settingsOpen is global state — force-close on pane hide.
  const paneHidden = useTradePaneHidden();
  const style = useChartPrefsStore((s) => s.style);
  const setStyle = useChartPrefsStore((s) => s.setStyle);
  const replaceStyle = useChartPrefsStore((s) => s.replaceStyle);
  const mode = useThemeMode();
  const resetStyle = useChartPrefsStore((s) => s.resetStyle);
  const setSettingsOpen = useChartPrefsStore((s) => s.setSettingsOpen);
  useEffect(() => {
    if (paneHidden) setSettingsOpen(false);
  }, [paneHidden, setSettingsOpen]);

  const { background, backdrop, grid, crosshair, candle, watermark, axisText } = style;
  const patternOff = backdrop.pattern === 'none';

  return (
    <Dialog open={open} onOpenChange={setSettingsOpen}>
      <DialogContent
        className="cs-modal max-h-[78vh] gap-0 overflow-y-auto sm:max-w-[420px]"
        data-testid="chart-settings-modal"
      >
        <DialogTitle className="cs-title">Chart studio</DialogTitle>

        {/* ── Presets: complete-style stamps. Applying one replaces the
            whole style, then every knob below keeps editing it — so we
            deliberately do NOT track a "selected" preset. */}
        <Section title="Presets">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {/*
              * The presets are written on paper, like everything else in
              * the studio, and turned over for the dark half here — so a
              * chip shows the chart it will actually produce, and
              * applying it produces that chart. See `themedChartStyle`.
              */}
            {CHART_STYLE_PRESETS.map((preset) => (
              <PresetChip
                key={preset.id}
                preset={{ ...preset, style: themedChartStyle(preset.style, mode) }}
                onApply={() => replaceStyle(themedChartStyle(preset.style, mode))}
              />
            ))}
          </div>
        </Section>

        {/* ── Background: the canvas fill behind the candles. */}
        <Section title="Background">
          <Row label="Mode">
            <select
              value={background.mode}
              onChange={(e) =>
                setStyle({
                  background: { ...background, mode: e.target.value as BackgroundMode },
                })
              }
              className="cs-sel"
              aria-label="Background mode"
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="gradient">Gradient</option>
            </select>
            {background.mode === 'none' ? (
              <span style={hintStyle}>transparent — theme &amp; pattern show through</span>
            ) : null}
          </Row>
          {background.mode === 'solid' ? (
            <Row label="Color">
              <PaintControl
                paint={background.solid}
                label="Background"
                onChange={(solid) => setStyle({ background: { ...background, solid } })}
              />
            </Row>
          ) : null}
          {background.mode === 'gradient' ? (
            <>
              <Row label="Top">
                <PaintControl
                  paint={background.gradientTop}
                  label="Gradient top"
                  onChange={(gradientTop) =>
                    setStyle({ background: { ...background, gradientTop } })
                  }
                />
              </Row>
              <Row label="Bottom">
                <PaintControl
                  paint={background.gradientBottom}
                  label="Gradient bottom"
                  onChange={(gradientBottom) =>
                    setStyle({ background: { ...background, gradientBottom } })
                  }
                />
              </Row>
            </>
          ) : null}
        </Section>

        {/* ── Pattern: the SVG backdrop layer behind the transparent
            canvas (zero per-frame cost — pure tiled CSS). */}
        <Section title="Pattern">
          <Row label="Pattern">
            <select
              value={backdrop.pattern}
              onChange={(e) =>
                setStyle({
                  backdrop: { ...backdrop, pattern: e.target.value as BackdropPattern },
                })
              }
              className="cs-sel"
              aria-label="Backdrop pattern"
            >
              {PATTERNS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Paint" dimmed={patternOff}>
            <PaintControl
              paint={backdrop.paint}
              label="Pattern"
              onChange={(paint) => setStyle({ backdrop: { ...backdrop, paint } })}
            />
          </Row>
          <Row label="Scale" dimmed={patternOff}>
            <SliderControl
              value={backdrop.scale}
              min={4}
              max={200}
              suffix="px"
              label="Pattern scale"
              onChange={(scale) => setStyle({ backdrop: { ...backdrop, scale } })}
            />
          </Row>
        </Section>

        {/* ── Grid lines. */}
        <Section title="Grid">
          <Row label="Lines">
            <select
              value={grid.mode}
              onChange={(e) =>
                setStyle({ grid: { ...grid, mode: e.target.value as ChartGridMode } })
              }
              className="cs-sel"
              aria-label="Grid line mode"
            >
              {GRID_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={grid.style}
              onChange={(e) =>
                setStyle({ grid: { ...grid, style: e.target.value as ChartLineStyle } })
              }
              className="cs-sel"
              aria-label="Grid line style"
            >
              {LINE_STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Vertical" dimmed={grid.mode === 'none' || grid.mode === 'horz'}>
            <PaintControl
              paint={grid.vert}
              label="Vertical grid"
              onChange={(vert) => setStyle({ grid: { ...grid, vert } })}
            />
          </Row>
          <Row label="Horizontal" dimmed={grid.mode === 'none' || grid.mode === 'vert'}>
            <PaintControl
              paint={grid.horz}
              label="Horizontal grid"
              onChange={(horz) => setStyle({ grid: { ...grid, horz } })}
            />
          </Row>
        </Section>

        {/* ── Crosshair. */}
        <Section title="Crosshair">
          <Row label="Line">
            <PaintControl
              paint={crosshair.paint}
              label="Crosshair"
              onChange={(paint) => setStyle({ crosshair: { ...crosshair, paint } })}
            />
            <select
              value={crosshair.style}
              onChange={(e) =>
                setStyle({
                  crosshair: { ...crosshair, style: e.target.value as ChartLineStyle },
                })
              }
              className="cs-sel"
              aria-label="Crosshair line style"
            >
              {LINE_STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        {/* ── Candles: body / border / wick, each independently painted. */}
        <Section title="Candles">
          <Row label="Body">
            <PaintControl
              paint={candle.upBody}
              tag="Up"
              label="Up body"
              onChange={(upBody) => setStyle({ candle: { ...candle, upBody } })}
            />
            <PaintControl
              paint={candle.downBody}
              tag="Dn"
              label="Down body"
              onChange={(downBody) => setStyle({ candle: { ...candle, downBody } })}
            />
          </Row>
          <Row label="">
            <label className="cs-check">
              <input
                type="checkbox"
                checked={candle.hollowUp}
                onChange={(e) =>
                  setStyle({ candle: { ...candle, hollowUp: e.target.checked } })
                }
              />
              <span>Hollow up</span>
            </label>
          </Row>
          <Row label="Border">
            <select
              value={candle.borderMode}
              onChange={(e) =>
                setStyle({
                  candle: { ...candle, borderMode: e.target.value as CandlePartMode },
                })
              }
              className="cs-sel"
              aria-label="Candle border mode"
            >
              {PART_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          {candle.borderMode === 'custom' ? (
            <Row label="">
              <PaintControl
                paint={candle.upBorder}
                tag="Up"
                label="Up border"
                onChange={(upBorder) => setStyle({ candle: { ...candle, upBorder } })}
              />
              <PaintControl
                paint={candle.downBorder}
                tag="Dn"
                label="Down border"
                onChange={(downBorder) => setStyle({ candle: { ...candle, downBorder } })}
              />
            </Row>
          ) : null}
          <Row label="Wicks">
            <select
              value={candle.wickMode}
              onChange={(e) =>
                setStyle({
                  candle: { ...candle, wickMode: e.target.value as CandlePartMode },
                })
              }
              className="cs-sel"
              aria-label="Candle wick mode"
            >
              {PART_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          {candle.wickMode === 'custom' ? (
            <Row label="">
              <PaintControl
                paint={candle.upWick}
                tag="Up"
                label="Up wick"
                onChange={(upWick) => setStyle({ candle: { ...candle, upWick } })}
              />
              <PaintControl
                paint={candle.downWick}
                tag="Dn"
                label="Down wick"
                onChange={(downWick) => setStyle({ candle: { ...candle, downWick } })}
              />
            </Row>
          ) : null}
        </Section>

        {/* ── Axis text. */}
        <Section title="Text">
          <Row label="Axis labels">
            <PaintControl
              paint={axisText}
              label="Axis text"
              onChange={(next) => setStyle({ axisText: next })}
            />
          </Row>
        </Section>

        {/* ── Watermark. */}
        <Section title="Watermark">
          <Row label="Ticker">
            <label className="cs-check">
              <input
                type="checkbox"
                checked={watermark.show}
                onChange={(e) =>
                  setStyle({ watermark: { ...watermark, show: e.target.checked } })
                }
              />
              <span>Show ticker</span>
            </label>
          </Row>
          <Row label="Paint" dimmed={!watermark.show}>
            <PaintControl
              paint={watermark.paint}
              label="Watermark"
              onChange={(paint) => setStyle({ watermark: { ...watermark, paint } })}
            />
          </Row>
          <Row label="Size" dimmed={!watermark.show}>
            <SliderControl
              value={watermark.size}
              min={24}
              max={200}
              suffix="px"
              label="Watermark size"
              onChange={(size) => setStyle({ watermark: { ...watermark, size } })}
            />
          </Row>
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" className="cs-btn" onClick={() => resetStyle()}>
            Reset to defaults
          </button>
          <div style={{ flex: 1 }} />
          {/* White, not accent-tinted. Done closes a panel — it commits
              nothing, because every knob above already applied when it
              was turned. */}
          <button
            type="button"
            className="cs-btn is-primary"
            onClick={() => setSettingsOpen(false)}
            data-testid="chart-settings-done"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── building blocks ─────────────────────────────────────────────────────

/** Section eyebrow + hairline rule, house "CHART BASIC STYLES" style. */
function Section(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={{ marginBottom: 14 }}>
      <div style={sectionHeaderStyle}>
        <span>{props.title}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
      </div>
      {props.children}
    </section>
  );
}

/** Label column + control cluster. `dimmed` fades the cluster (never
 *  unmounts it) so toggling a mode doesn't shift layout. */
function Row(props: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly dimmed?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '92px 1fr',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 11.5, color: 'var(--d-chartsettingsmodal-1, rgba(11,14,20,0.82))' }}>{props.label}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          ...(props.dimmed === true ? dimStyle : null),
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/**
 * The core control: color swatch + opacity slider + mono % readout.
 * Every edit writes the COMPLETE Paint through onChange (the store
 * replaces sections wholesale, so partial paints would drop fields).
 */
function PaintControl(props: {
  readonly paint: Paint;
  readonly onChange: (paint: Paint) => void;
  readonly label: string;
  readonly disabled?: boolean;
  /** Optional tiny visible prefix (e.g. "Up") for paired controls. */
  readonly tag?: string;
}): React.ReactElement {
  const { paint, onChange } = props;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...(props.disabled === true ? dimStyle : null),
      }}
    >
      {props.tag !== undefined ? <span style={tagStyle}>{props.tag}</span> : null}
      <input
        type="color"
        value={paint.color}
        onChange={(e) => onChange({ color: e.target.value, opacity: paint.opacity })}
        aria-label={`${props.label} color`}
        style={swatchStyle}
      />
      <input
        type="range"
        min={0}
        max={100}
        value={paint.opacity}
        onChange={(e) => onChange({ color: paint.color, opacity: Number(e.target.value) })}
        aria-label={`${props.label} opacity`}
        style={rangeStyle}
      />
      <span style={readoutStyle}>{Math.round(paint.opacity)}%</span>
    </span>
  );
}

/** Full-width slider + mono value readout (pattern scale, watermark size). */
function SliderControl(props: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly suffix: string;
  readonly label: string;
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <>
      <input
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-label={props.label}
        style={{ ...rangeStyle, width: 'auto', flex: 1, maxWidth: 180 }}
      />
      <span style={{ ...readoutStyle, minWidth: 34 }}>
        {Math.round(props.value)}
        {props.suffix}
      </span>
    </>
  );
}

/**
 * Preset chip: a 56×32 mini canvas mock built from the preset's own
 * colors — background (solid/gradient) + three tiny candle bars — with
 * the name under it. A stamp: clicking applies the full style and the
 * knobs below take over, so no "selected" state is tracked.
 */
function PresetChip(props: {
  readonly preset: ChartStylePreset;
  readonly onApply: () => void;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  const s = props.preset.style;
  const bg =
    s.background.mode === 'gradient'
      ? `linear-gradient(180deg, ${paintToRgba(s.background.gradientTop)}, ${paintToRgba(s.background.gradientBottom)})`
      : s.background.mode === 'solid'
        ? paintToRgba(s.background.solid)
        : 'var(--input-bg)';
  const up = paintToRgba(s.candle.upBody);
  const down = paintToRgba(s.candle.downBody);
  return (
    <button
      type="button"
      onClick={props.onApply}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={`Apply ${props.preset.name} preset`}
      style={{
        ...chipStyle,
        borderColor: hover ? 'var(--hairline-2)' : 'var(--hairline)',
      }}
    >
      <span style={{ ...chipCanvasStyle, background: bg }}>
        <span style={{ ...chipBarStyle, height: 14, background: up }} />
        <span style={{ ...chipBarStyle, height: 9, background: down }} />
        <span style={{ ...chipBarStyle, height: 19, background: up }} />
      </span>
      <span style={chipNameStyle}>{props.preset.name}</span>
    </button>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const dimStyle: CSSProperties = {
  opacity: 0.4,
  pointerEvents: 'none',
};

/*
 * ── THE STUDIO, IN THE PAGE'S MATERIALS ──────────────────────────────
 *
 * Everything below was `--surface-1`, `--hairline-2`, mono capitals at
 * 1px of tracking, 8px corners and an accent-coloured slider — a fourth
 * design language on a page that had settled on one. The values here are
 * the rail's: sans throughout, 10–12px, `rgba(11,14,20,0.14)` outlines, 4–6px
 * corners, white for the thing that is on.
 */
const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 10,
  fontFamily: 'var(--sans)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--d-chartsettingsmodal-2, #8a9591)',
  marginBottom: 8,
};

const hintStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--d-chartsettingsmodal-3, rgba(11,14,20,0.35))',
};

const swatchStyle: CSSProperties = {
  width: 24,
  height: 20,
  padding: 0,
  border: '1px solid var(--d-chartsettingsmodal-4, rgba(11,14,20,0.14))',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
};

const rangeStyle: CSSProperties = {
  width: 64,
  height: 12,
  accentColor: 'var(--d-chartsettingsmodal-5, #0b0e14)',
  cursor: 'pointer',
};

const readoutStyle: CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--sans)',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--ink-3)',
  minWidth: 26,
  textAlign: 'right',
};

const tagStyle: CSSProperties = {
  fontSize: 9.5,
  fontFamily: 'var(--sans)',
  fontWeight: 500,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--d-chartsettingsmodal-6, rgba(11,14,20,0.4))',
};


const chipStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 5,
  padding: 5,
  background: 'transparent',
  border: '1px solid var(--d-chartsettingsmodal-7, rgba(11,14,20,0.12))',
  borderRadius: 7,
  cursor: 'pointer',
  transition: 'border-color 160ms ease',
};

const chipCanvasStyle: CSSProperties = {
  width: 58,
  height: 34,
  borderRadius: 4,
  border: '1px solid var(--d-chartsettingsmodal-8, rgba(11,14,20,0.12))',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
  overflow: 'hidden',
};

const chipBarStyle: CSSProperties = {
  width: 5,
  borderRadius: 1.5,
};

const chipNameStyle: CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--sans)',
  fontWeight: 500,
  color: 'var(--d-chartsettingsmodal-9, rgba(11,14,20,0.62))',
};

const footerButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--d-chartsettingsmodal-10, rgba(11,14,20,0.14))',
  borderRadius: 5,
  fontFamily: 'var(--sans)',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--d-chartsettingsmodal-11, rgba(11,14,20,0.78))',
  padding: '5px 11px',
  cursor: 'pointer',
};
