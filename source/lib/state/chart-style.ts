'use client';

/**
 * Chart Studio style model. Every visible surface is described by a
 * `Paint` — a hex color plus an independent 0-100 opacity — so opacity is
 * a first-class knob EVERYWHERE (grid, wicks, backdrop, watermark…), not
 * a special case. Colors compose to `rgba()` at apply time, which is what
 * both lightweight-charts and CSS accept.
 *
 * The candle splits into body / border / wick, each independently
 * paintable (or set to match the body, or hidden), plus a hollow mode —
 * enough to build anything from dense scalping candles to outlined art.
 *
 * The background has three modes (none / solid / vertical gradient) AND a
 * separate BACKDROP layer: an SVG tiling pattern rendered on a div behind
 * the transparent canvas. That is how "SVG patterns / art pieces" work —
 * the canvas stays transparent and the pattern shows through, so it costs
 * the chart nothing per frame (pure CSS, GPU-composited).
 */

export interface Paint {
  /** #rrggbb */
  readonly color: string;
  /** 0-100 */
  readonly opacity: number;
}

export type ChartGridMode = 'both' | 'vert' | 'horz' | 'none';
export type ChartLineStyle = 'solid' | 'dotted' | 'dashed';
/** How a candle's border / wick is colored. */
export type CandlePartMode = 'match' | 'custom' | 'none';
export type BackgroundMode = 'none' | 'solid' | 'gradient';
export type BackdropPattern =
  | 'none'
  | 'dots'
  | 'grid'
  | 'graph'
  | 'diagonal'
  | 'crosshatch'
  | 'plus';

export interface BackgroundStyle {
  readonly mode: BackgroundMode;
  readonly solid: Paint;
  readonly gradientTop: Paint;
  readonly gradientBottom: Paint;
}

export interface BackdropStyle {
  readonly pattern: BackdropPattern;
  readonly paint: Paint;
  /** Tile size in px (pattern density). */
  readonly scale: number;
}

export interface GridStyle {
  readonly mode: ChartGridMode;
  readonly vert: Paint;
  readonly horz: Paint;
  readonly style: ChartLineStyle;
}

export interface CrosshairStyle {
  readonly paint: Paint;
  readonly style: ChartLineStyle;
}

export interface CandleStyle {
  readonly upBody: Paint;
  readonly downBody: Paint;
  readonly borderMode: CandlePartMode;
  readonly upBorder: Paint;
  readonly downBorder: Paint;
  readonly wickMode: CandlePartMode;
  readonly upWick: Paint;
  readonly downWick: Paint;
  /** Up candles render hollow (transparent body, colored outline). */
  readonly hollowUp: boolean;
}

export interface WatermarkStyle {
  readonly show: boolean;
  readonly paint: Paint;
  /** Font size in px. */
  readonly size: number;
}

export interface ChartStyleSettings {
  readonly background: BackgroundStyle;
  readonly backdrop: BackdropStyle;
  readonly grid: GridStyle;
  readonly crosshair: CrosshairStyle;
  readonly candle: CandleStyle;
  readonly watermark: WatermarkStyle;
  readonly axisText: Paint;
}

// ── helpers ────────────────────────────────────────────────────────────

const paint = (color: string, opacity = 100): Paint => ({ color, opacity });

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Compose a Paint into an `rgba()` string. Invalid hex falls back to a
 *  visible mid-grey so a corrupted pref never renders an invisible or
 *  crashing color. Opacity clamps to [0, 100]. */
export function paintToRgba(p: Paint): string {
  const hex = HEX6.test(p.color) ? p.color : '#888888';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.max(0, Math.min(100, p.opacity)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** True when the paint is fully transparent (opacity 0) — used to route a
 *  "match/none" wick or border to `visible: false` for a cleaner render. */
export function isInvisible(p: Paint): boolean {
  return p.opacity <= 0;
}

// ── defaults ───────────────────────────────────────────────────────────

export const DEFAULT_CHART_STYLE: ChartStyleSettings = {
  background: {
    /* Paper, and NEUTRAL paper. The same argument as when this was
       black: a full bleed surface with any cast in it reads as a tint
       rather than as a ground, and the page around it is plain white. */
    mode: 'none',
    solid: paint('#ffffff'),
    gradientTop: paint('#f7f9f8'),
    gradientBottom: paint('#ffffff'),
  },
  /*
   * ── THE GRID IS PAINTED, NOT PLOTTED ─────────────────────────────
   *
   * Lightweight-charts draws its ruling at the AXIS TICKS, so how many
   * lines you get depends on the data: a narrow price range or a series
   * that has not loaded yet gives you two lines, or none, and the pane
   * reads as broken rather than as empty.
   *
   * So the ruling is a backdrop behind the canvas instead. It is always
   * there, evenly spaced, whatever the data is doing — which is what
   * every other chart on the internet does and why theirs never look
   * like a blank rectangle while they load.
   *
   * The chart's own grid stays on top of it and still marks the real
   * ticks; this is the paper it is drawn on.
   */
  backdrop: {
    pattern: 'grid',
    paint: paint('#0b0e14', 7),
    scale: 44,
  },
  grid: {
    mode: 'both',
    vert: paint('#e2e6e8', 100),
    horz: paint('#e2e6e8', 100),
    style: 'solid',
  },
  /* The crosshair measures; it does not value. Cyan read as a third
     colour on a surface where green and red already mean something. */
  crosshair: {
    paint: paint('#0b0e14', 45),
    style: 'dashed',
  },
  /*
   * ── PLAIN GREEN AND PLAIN RED ────────────────────────────────────
   *
   * These were `#34d399` and `#fb5374` — a mint that leans teal and a
   * red that leans pink. Both are lovely and neither is a candle: the
   * eye spends a beat deciding what it is looking at before it reads
   * the move, and on a wall of them that beat never stops.
   *
   * The page's own pair instead — the same green as the Buy button and
   * the same red as Sell. A candle now means exactly what the buttons
   * beside it mean, which is the only job the colour has.
   */
  candle: {
    upBody: paint('#0f6d5f', 100),
    downBody: paint('#b4482e', 100),
    borderMode: 'none',
    upBorder: paint('#0f6d5f', 100),
    downBorder: paint('#b4482e', 100),
    wickMode: 'match',
    upWick: paint('#0f6d5f', 100),
    downWick: paint('#b4482e', 100),
    hollowUp: false,
  },
  watermark: {
    show: false,
    paint: paint('#a8aeba', 8),
    size: 64,
  },
  axisText: paint('#a8aeba', 100),
};

// ── SVG backdrop patterns ────────────────────────────────────────────────

/**
 * A tiling SVG pattern as a `background-image` data URI, sized `scale`px.
 * The canvas above is transparent, so this shows through with zero
 * per-frame cost. Colors are baked in as `rgba` (opacity lives in the
 * paint), so the div needs no extra opacity rule.
 */
export function backdropCss(
  backdrop: BackdropStyle,
): { backgroundImage: string; backgroundSize: string } | null {
  if (backdrop.pattern === 'none' || isInvisible(backdrop.paint)) return null;
  const c = paintToRgba(backdrop.paint);
  const s = Math.max(4, Math.min(200, Math.round(backdrop.scale)));
  const svg = patternSvg(backdrop.pattern, c, s);
  if (!svg) return null;
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return {
    backgroundImage: `url("data:image/svg+xml,${encoded}")`,
    backgroundSize: `${s}px ${s}px`,
  };
}

function patternSvg(pattern: BackdropPattern, stroke: string, s: number): string | null {
  const w = 1.1;
  const open = `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'>`;
  const close = '</svg>';
  switch (pattern) {
    case 'dots':
      return `${open}<circle cx='${s / 2}' cy='${s / 2}' r='1.3' fill='${stroke}'/>${close}`;
    case 'grid':
      return `${open}<path d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${stroke}' stroke-width='${w}'/>${close}`;
    case 'graph': {
      // Fine minor grid + a heavier line every 4 cells (graph paper).
      const minor = `<path d='M ${s} 0 L 0 0 0 ${s}' fill='none' stroke='${stroke}' stroke-width='0.6'/>`;
      return `${open}${minor}${close}`;
    }
    case 'diagonal':
      return `${open}<path d='M-1,1 l2,-2 M0,${s} l${s},-${s} M${s - 1},${s + 1} l2,-2' stroke='${stroke}' stroke-width='${w}'/>${close}`;
    case 'crosshatch':
      return `${open}<path d='M-1,1 l2,-2 M0,${s} l${s},-${s} M${s - 1},${s + 1} l2,-2 M1,-1 l-2,2 M${s},0 l-${s},${s} M${s + 1},${s - 1} l-2,2' stroke='${stroke}' stroke-width='0.8'/>${close}`;
    case 'plus': {
      const m = s / 2;
      const a = 2.4;
      return `${open}<path d='M${m},${m - a} L${m},${m + a} M${m - a},${m} L${m + a},${m}' stroke='${stroke}' stroke-width='${w}' stroke-linecap='round'/>${close}`;
    }
    default:
      return null;
  }
}

// ── presets ───────────────────────────────────────────────────────────

export interface ChartStylePreset {
  readonly id: string;
  readonly name: string;
  readonly style: ChartStyleSettings;
}

const clone = (s: ChartStyleSettings): ChartStyleSettings =>
  JSON.parse(JSON.stringify(s)) as ChartStyleSettings;

/** Curated starting points — each a complete style. "Midnight" is the
 *  ship default; the rest showcase gradients, backdrops, hollow candles. */
/*
 * ── THE PRESETS ──────────────────────────────────────────────────────
 *
 * Five, and every one of them is a chart you would actually leave on.
 *
 * Paper, Neon Grid and Sunset are gone. They were demos of what the
 * style engine can do — a cream page, a purple gradient with a glowing
 * grid, an orange dusk — rather than ways anyone wants to read a candle
 * at four in the morning. A preset list is a set of defaults, not a
 * gallery, and three of the five being unusable made the other two hard
 * to find.
 *
 * What is left varies the two things that actually change how the chart
 * reads: how loud the grid is, and whether a candle is filled or hollow.
 * Everything else — the black ground, the white crosshair, the axis
 * grey — is shared, because those are the page's and not the preset's.
 */
const base = (over: Partial<ChartStyleSettings>): ChartStyleSettings => ({
  ...clone(DEFAULT_CHART_STYLE),
  ...over,
});

export const CHART_STYLE_PRESETS: ReadonlyArray<ChartStylePreset> = [
  /*
   * ── FIVE CHARTS, NOT FIVE COPIES ─────────────────────────────────
   *
   * The set used to vary two things: how much grid there was, and
   * whether an up candle was hollow. On a black chart that was enough to
   * tell them apart. On paper it is nothing — five white rectangles with
   * the same green and red in them, and a preset list where every option
   * previews identically is a list with one option.
   *
   * So each of these changes the GROUND as well. Ordered light to dark,
   * because that is the decision you are actually making.
   */

  /* The ship default. Plain paper, horizontal rules only: price is the
     axis you measure against and the time lines are mostly texture. */
  {
    id: 'paper',
    name: 'Paper',
    style: clone(DEFAULT_CHART_STYLE),
  },

  /* Nothing at all behind the candles. For reading the shape of a move
     rather than the levels it passed through. */
  {
    id: 'clean',
    name: 'Clean',
    style: base({
      backdrop: { pattern: 'none', paint: paint('#0b0e14', 0), scale: 44 },
      grid: { mode: 'none', vert: paint('#e2e6e8'), horz: paint('#e2e6e8'), style: 'solid' },
    }),
  },

  /* Engineering paper: a printed grid in both axes over a warm off
     white, and a dotted rule so the ruling never competes with a wick. */
  {
    id: 'graph',
    name: 'Graph',
    style: base({
      background: {
        mode: 'solid',
        solid: paint('#faf9f5'),
        gradientTop: paint('#faf9f5'),
        gradientBottom: paint('#faf9f5'),
      },
      backdrop: { pattern: 'graph', paint: paint('#1e8574', 12), scale: 28 },
      grid: { mode: 'both', vert: paint('#dfdcd2'), horz: paint('#dfdcd2'), style: 'dotted' },
    }),
  },

  /* Hollow up candles, the way a lot of desks read them: a filled body
     means the move closed down. On a cool grey ground so the hollow
     bodies have something to be hollow AGAINST — on white they read as
     outlines floating in nothing. */
  {
    id: 'hollow',
    name: 'Hollow',
    style: base({
      background: {
        mode: 'solid',
        solid: paint('#eef1f3'),
        gradientTop: paint('#eef1f3'),
        gradientBottom: paint('#eef1f3'),
      },
      backdrop: { pattern: 'none', paint: paint('#0b0e14', 0), scale: 44 },
      grid: { mode: 'horz', vert: paint('#d6dcdf'), horz: paint('#cdd4d8'), style: 'solid' },
      candle: {
        upBody: paint('#0f6d5f', 100),
        downBody: paint('#b4482e', 100),
        borderMode: 'match',
        upBorder: paint('#0f6d5f'),
        downBorder: paint('#b4482e'),
        wickMode: 'match',
        upWick: paint('#0f6d5f'),
        downWick: paint('#b4482e'),
        hollowUp: true,
      },
    }),
  },

  /* The dark one, kept whole. It is not a leftover: a chart is the one
     surface people genuinely split over, and somebody who reads a tape
     at four in the morning wants this and nothing else. It is also what
     makes the other four legible as choices. */
  {
    id: 'midnight',
    name: 'Midnight',
    style: base({
      background: {
        mode: 'solid',
        solid: paint('#000000'),
        gradientTop: paint('#0c0c0d'),
        gradientBottom: paint('#000000'),
      },
      backdrop: { pattern: 'grid', paint: paint('#ffffff', 7), scale: 44 },
      grid: { mode: 'both', vert: paint('#24242a'), horz: paint('#24242a'), style: 'solid' },
      crosshair: { paint: paint('#ffffff', 55), style: 'dashed' },
      candle: {
        upBody: paint('#22c77e', 100),
        downBody: paint('#f0567a', 100),
        borderMode: 'match',
        upBorder: paint('#22c77e'),
        downBorder: paint('#f0567a'),
        wickMode: 'match',
        upWick: paint('#22c77e'),
        downWick: paint('#f0567a'),
        hollowUp: false,
      },
    }),
  },
];


// ── migration / normalization ────────────────────────────────────────────

const numOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const strOr = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.length > 0 ? v : fallback;

function normPaint(v: unknown, fallback: Paint): Paint {
  if (!v || typeof v !== 'object') return { ...fallback };
  const o = v as Record<string, unknown>;
  return {
    color: HEX6.test(strOr(o['color'], '')) ? (o['color'] as string) : fallback.color,
    opacity: Math.max(0, Math.min(100, numOr(o['opacity'], fallback.opacity))),
  };
}

/**
 * Accept any persisted style — the new nested shape OR the legacy flat v1
 * shape (`gridColorVert`, `upColor`, `background: string|null`, …) — and
 * always return a complete, valid ChartStyleSettings merged over defaults.
 * Cosmetic-only, so anything unrecognized just falls back; nothing throws.
 */
export function normalizeChartStyle(raw: unknown): ChartStyleSettings {
  const d = DEFAULT_CHART_STYLE;
  if (!raw || typeof raw !== 'object') return clone(d);
  const o = raw as Record<string, unknown>;

  // Legacy flat v1 detection: had top-level `gridColorVert` / `upColor`.
  const isLegacy = 'gridColorVert' in o || 'upColor' in o || 'crosshairColor' in o;
  if (isLegacy) return migrateLegacy(o);

  const bg = (o['background'] ?? {}) as Record<string, unknown>;
  const bd = (o['backdrop'] ?? {}) as Record<string, unknown>;
  const gr = (o['grid'] ?? {}) as Record<string, unknown>;
  const ch = (o['crosshair'] ?? {}) as Record<string, unknown>;
  const cd = (o['candle'] ?? {}) as Record<string, unknown>;
  const wm = (o['watermark'] ?? {}) as Record<string, unknown>;

  const lineStyle = (v: unknown, fb: ChartLineStyle): ChartLineStyle =>
    v === 'solid' || v === 'dotted' || v === 'dashed' ? v : fb;
  const partMode = (v: unknown, fb: CandlePartMode): CandlePartMode =>
    v === 'match' || v === 'custom' || v === 'none' ? v : fb;
  const gridMode = (v: unknown): ChartGridMode =>
    v === 'both' || v === 'vert' || v === 'horz' || v === 'none' ? v : d.grid.mode;
  const bgMode = (v: unknown): BackgroundMode =>
    v === 'none' || v === 'solid' || v === 'gradient' ? v : d.background.mode;
  const patt = (v: unknown): BackdropPattern =>
    v === 'none' || v === 'dots' || v === 'grid' || v === 'graph' ||
    v === 'diagonal' || v === 'crosshatch' || v === 'plus'
      ? v
      : d.backdrop.pattern;

  return {
    background: {
      mode: bgMode(bg['mode']),
      solid: normPaint(bg['solid'], d.background.solid),
      gradientTop: normPaint(bg['gradientTop'], d.background.gradientTop),
      gradientBottom: normPaint(bg['gradientBottom'], d.background.gradientBottom),
    },
    backdrop: {
      pattern: patt(bd['pattern']),
      paint: normPaint(bd['paint'], d.backdrop.paint),
      scale: Math.max(4, Math.min(200, numOr(bd['scale'], d.backdrop.scale))),
    },
    grid: {
      mode: gridMode(gr['mode']),
      vert: normPaint(gr['vert'], d.grid.vert),
      horz: normPaint(gr['horz'], d.grid.horz),
      style: lineStyle(gr['style'], d.grid.style),
    },
    crosshair: {
      paint: normPaint(ch['paint'], d.crosshair.paint),
      style: lineStyle(ch['style'], d.crosshair.style),
    },
    candle: {
      upBody: normPaint(cd['upBody'], d.candle.upBody),
      downBody: normPaint(cd['downBody'], d.candle.downBody),
      borderMode: partMode(cd['borderMode'], d.candle.borderMode),
      upBorder: normPaint(cd['upBorder'], d.candle.upBorder),
      downBorder: normPaint(cd['downBorder'], d.candle.downBorder),
      wickMode: partMode(cd['wickMode'], d.candle.wickMode),
      upWick: normPaint(cd['upWick'], d.candle.upWick),
      downWick: normPaint(cd['downWick'], d.candle.downWick),
      hollowUp: cd['hollowUp'] === true,
    },
    watermark: {
      show: wm['show'] === true,
      paint: normPaint(wm['paint'], d.watermark.paint),
      size: Math.max(24, Math.min(200, numOr(wm['size'], d.watermark.size))),
    },
    axisText: normPaint(o['axisText'], d.axisText),
  };
}

/** Map the tiny legacy flat schema into the new model so early adopters
 *  keep their colors. */
function migrateLegacy(o: Record<string, unknown>): ChartStyleSettings {
  const d = DEFAULT_CHART_STYLE;
  const bgRaw = o['background'];
  const solidHex = typeof bgRaw === 'string' && HEX6.test(bgRaw) ? bgRaw : d.background.solid.color;
  const gm = o['gridMode'];
  const gridMode: ChartGridMode =
    gm === 'both' || gm === 'vert' || gm === 'horz' || gm === 'none' ? gm : 'both';
  const cs = o['crosshairStyle'];
  const crossStyle: ChartLineStyle = cs === 'solid' || cs === 'dotted' || cs === 'dashed' ? cs : 'dashed';
  return {
    ...clone(d),
    background: {
      ...d.background,
      mode: typeof bgRaw === 'string' ? 'solid' : 'none',
      solid: paint(solidHex, 100),
    },
    grid: {
      mode: gridMode,
      vert: paint(strOr(o['gridColorVert'], d.grid.vert.color), 100),
      horz: paint(strOr(o['gridColorHorz'], d.grid.horz.color), 100),
      style: 'solid',
    },
    crosshair: { paint: paint(strOr(o['crosshairColor'], d.crosshair.paint.color), 100), style: crossStyle },
    candle: {
      ...d.candle,
      upBody: paint(strOr(o['upColor'], d.candle.upBody.color), 100),
      downBody: paint(strOr(o['downColor'], d.candle.downBody.color), 100),
      upWick: paint(strOr(o['upColor'], d.candle.upWick.color), 100),
      downWick: paint(strOr(o['downColor'], d.candle.downWick.color), 100),
    },
    watermark: { ...d.watermark, show: o['watermark'] === true },
    axisText: paint(strOr(o['axisTextColor'], d.axisText.color), 100),
  };
}
