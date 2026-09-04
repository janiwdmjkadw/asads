import './order-sequence.css';

/**
 * The onboarding ground: a chart running, and a condition firing on it.
 *
 * The chart scrolls, always, the way a chart does. Over one pass:
 *
 *   1. a candle out on the right lights and rings — the trigger
 *   2. the conditions are set, one line at a time
 *   3. they clear, and the order is approved
 *   4. THEN the order line drops into that price and rests
 *
 * That order matters. The line used to arrive before the conditions had
 * appeared, which said the order was already resting there and the
 * conditions were describing something that had already happened.
 *
 * Then the chart runs on alone for a beat and it goes again. Eighteen
 * seconds, and the quiet tail is deliberate: this sits behind a panel
 * someone is reading a recovery key on, so the story has to finish rather
 * than churn.
 *
 * The cycle length IS the scroll speed. A seamless loop has to travel
 * exactly one copy of the series per cycle, so the two cannot be tuned
 * apart — a chart that scrolls calmly is a chart on a long cycle, and the
 * beats below are set as percentages so they stay quick inside it.
 *
 * The marker is GLUED to its candle. It is not a dot pinned to the screen
 * with a line sliding underneath, which is what a chart animation looks
 * like when it is faked — it travels at exactly the chart's velocity, so
 * the candle that triggers is the candle that fills. That is the whole
 * reason the series is periodic (below) and the two scroll keyframes in
 * the stylesheet carry the same speed written two ways.
 *
 * No cursor. A pointer implies a person clicking, which is the opposite of
 * what this product does: the claim is that the agent acts while you are
 * not there.
 *
 * No client JavaScript.
 */

/*
 * ARCTIC MINT.
 *
 * The ground was #070709 and the ink was neutral white. Both are cooled
 * here: a deep blue-green black, and a pale icy mint over it.
 *
 * ARCTIC IS THE OPERATIVE WORD. Mint at full saturation on a dark screen
 * reads as a terminal from 1987, so the ink is barely green — it is a
 * white that has been walked a few steps toward mint, which is what makes
 * it read as cold light rather than as coloured text. The ground carries
 * more of the hue than the ink does, for the same reason: colour in the
 * air rather than colour in the type.
 *
 * Worth knowing: the landing's own `--lp-mint` token is #ffffff. That
 * palette was deliberately desaturated to monochrome, so this page is now
 * the one place in the product carrying a hue.
 */
const BACK = '#04100f';
const INK = 'rgba(206,240,229,';

/** One viewport of chart. The rendered SVG is two of these, side by side. */
const SPAN = 1200;
const H = 320;
const N = 120;

/**
 * A price line: a few slow swings with tick texture on them, closed into a
 * loop.
 *
 * Three passes, and each one fixes what the pass before it looked like:
 *
 *   TREND — a walk where each step keeps 90% of the last one. A plain walk
 *   reverses direction at half its points, which is what a one-second
 *   chart looks like, not a normal one. High momentum plus two smoothing
 *   passes brings it down to eight swings across a screen: moves you can
 *   actually read.
 *
 *   CLOSE — subtract the total drift as a straight ramp, pulling the last
 *   point back onto the first. The loop puts the join on screen every
 *   cycle, and this removes it without touching the shape, since every
 *   step is nudged by the same tiny amount.
 *
 *   TICK — a little independent noise back on top. Without it the smoothed
 *   trend reads as a wave rather than a price. It is small enough that the
 *   step across the join stays the size of an ordinary tick, so the seam
 *   still has nothing to see.
 *
 * The LCG is seeded rather than `Math.random`, so the server and the
 * client draw the same chart and there is nothing to hydrate.
 *
 * The seed is SEARCHED FOR, not arbitrary. Two things have to be true of
 * one number, and neither is tunable after the fact: the step across the
 * join has to be smaller than an ordinary tick, or the loop visibly jumps
 * once a cycle; and the line has to be near its low at index 105, because
 * that is the candle the story marks and the card would cover it anywhere
 * higher. This seed puts the join at a sixteenth of a tick and the marked
 * candle at 84% down the band. Changing it means running that search
 * again, not picking another number.
 */
const WALK = (() => {
  let seed = 0x17c;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const raw: number[] = [];
  let value = 0;
  let step = 0;
  for (let i = 0; i < N; i += 1) {
    step = step * 0.9 + (rnd() - 0.5) * 0.04;
    value += step;
    raw.push(value);
  }

  const drift = raw[N - 1]! - raw[0]!;
  let line = raw.map((y, i) => y - (drift * i) / (N - 1));

  /* Circular, so the smoothing does not flatten the ends and reopen the
     join it is sitting inside. */
  for (let pass = 0; pass < 2; pass += 1) {
    const previous = line;
    line = previous.map(
      (_, i) => (previous[(i - 1 + N) % N]! + previous[i]! * 2 + previous[(i + 1) % N]!) / 4,
    );
  }

  const span = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return values.map((y) => (y - lo) / (hi - lo));
  };

  const ticked = span(line).map((y) => y + (rnd() - 0.5) * 0.03);
  return span(ticked).map((y) => 0.15 + y * 0.7);
})();

const priceAt = (i: number) => H - WALK[i % N]! * H;

/** Two copies, so sliding one span over is a seam nobody can find. */
const SERIES = Array.from({ length: N * 2 + 1 }, (_, i) => ({
  x: (i / N) * SPAN,
  y: priceAt(i),
}));

const LINE = SERIES.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const AREA = `M 0 ${H} L ${SERIES.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')} L ${SPAN * 2} ${H} Z`;

/**
 * The candle that triggers and fills. Index 105 of 120 puts it at 87.5% of
 * a viewport, and the marker drifts left from there at one viewport per
 * cycle — so it is out past the card's right edge when it lights at 6.5%
 * of the cycle, and out past the card's left edge when the fill prints at
 * 72%. Both of those are why the card never covers the moments that
 * matter. Move this index and those two windows in the stylesheet move
 * with it.
 */
const HIT_INDEX = 105;
const HIT_Y = priceAt(HIT_INDEX);

/* The chart occupies the bottom band. These are what let an absolutely
   positioned marker land exactly on a point living in the SVG's own
   coordinate space. */
/*
 * The chart occupies a band along the bottom, and `--os-band` is its
 * height. That value lives in the STYLESHEET and only there, because two
 * things have to agree on it — the chart's own height, and the top of
 * anything pinned to a point on the chart — and a phone wants a taller
 * band than a desktop.
 *
 * It was a constant in this file, the stylesheet raised the chart to 52%
 * on phones, and the marker went on sitting where a 40% band would have
 * put it, floating off the line. Writing it here as an inline custom
 * property fixed nothing: an inline style outranks a media query, so the
 * phone rule was still dead. One definition, in the one place a media
 * query can reach.
 *
 * `top` solves the same mapping the SVG does: the band is anchored to the
 * bottom, so a point `HIT_Y / H` of the way down it sits that far up from
 * the bottom edge — 100% minus the part of the band left below it.
 */
const HIT_LEFT = `${((HIT_INDEX / N) * 100).toFixed(2)}vw`;
const HIT_TOP = `calc(100% - var(--os-band) * ${(1 - HIT_Y / H).toFixed(4)})`;

const CYCLE = '18s';
const MONO = 'font-geist-mono';

const CONDITIONS = [
  ['when', 'mc > $250K'],
  ['and', 'holders > 800'],
  ['then', 'buy 2 SOL'],
] as const;

/**
 * `backwards` IS LOAD BEARING. The condition lines are staggered with a
 * positive `animation-delay`, and during a delay an element renders in its
 * OWN state, not the animation's 0% frame — so lines two and three sat at
 * full opacity from the moment the page painted, then snapped off when
 * their delay elapsed. On every refresh the first thing on screen was the
 * middle of the sequence.
 *
 * `backwards` makes the delay hold the 0% frame instead. It costs nothing
 * on the beats whose delay is zero, so every element here carries it
 * rather than leaving a trap for the next one that gets staggered.
 */
const run = (name: string, delay = 0) =>
  `${name} ${CYCLE} linear ${delay}s infinite backwards`;

export function OrderSequence(): React.ReactElement {
  return (
    <div aria-hidden className="os-root fixed inset-0 z-0 overflow-hidden" style={{ backgroundColor: BACK }}>
      {/* ── the chart ── */}
      <svg
        viewBox={`0 0 ${SPAN * 2} ${H}`}
        /* `none` rather than meet or slice: the chart stretches to the
           frame instead of cropping, which is what keeps the marker on the
           line at every width. */
        preserveAspectRatio="none"
        className="os-anim os-chart absolute bottom-0 left-0"
        style={{
          width: '200%',
          height: 'var(--os-band)',
          animation: run('os-scroll'),
          willChange: 'transform',
        }}
        focusable="false"
      >
        <path d={AREA} fill={`${INK}0.07)`} />
        <polyline
          points={LINE}
          fill="none"
          stroke={`${INK}0.55)`}
          strokeWidth={1.8}
          /* Pinned to device pixels, so the 2× horizontal stretch does not
             make the line twice as thick as it is tall. */
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* ── the conditions, in the left margin ── */}
      <div className="os-conditions">
        {CONDITIONS.map(([keyword, value], index) => (
          <div
            key={keyword}
            className={`os-anim ${MONO} flex items-baseline gap-3 whitespace-nowrap leading-none`}
            style={{ animation: run('os-line', index * 0.35), willChange: 'transform, opacity' }}
          >
            <span style={{ color: `${INK}0.55)` }}>{keyword}</span>
            <span
              className="rounded-md px-2.5 py-1"
              style={{ backgroundColor: `${INK}0.14)`, color: `${INK}0.95)` }}
            >
              {value}
            </span>
          </div>
        ))}

        <div
          className={`os-anim os-ok ${MONO} mt-2 flex items-center gap-2.5 text-[0.68em] uppercase leading-none tracking-[0.22em]`}
          style={{ animation: run('os-ok'), willChange: 'transform, opacity' }}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden focusable="false">
            <circle cx="9" cy="9" r="8" stroke={`${INK}0.75)`} strokeWidth="1.3" />
            <path d="M5.4 9.2 L7.9 11.6 L12.6 6.4" stroke={`${INK}0.95)`} strokeWidth="1.7" fill="none" />
          </svg>
          <span style={{ color: `${INK}0.88)` }}>approved</span>
        </div>
      </div>

      {/* ── the order line ──
          A dashed rule across the whole width at the marked price, which is
          what a resting order looks like in a terminal. It replaces a dot
          sitting on the candle: a dot has to land on the line to be right,
          and a rule AT that price is on it by construction, at every width
          and every band height.

          It does NOT scroll: a price level has no horizontal position, so
          sliding the dashes along would say it did. Its only motion is
          dropping into that price when the order is placed, and it then
          holds for most of the cycle before clearing with the rest. */}
      <div
        className="os-anim os-level"
        style={{
          top: HIT_TOP,
          color: `${INK}0.5)`,
          animation: run('os-level'),
          willChange: 'transform, opacity',
        }}
      />

      {/* ── the tap, travelling with the chart ──
          The ring is on the candle rather than anywhere on screen, so it
          has to move at the chart's speed to stay on it. */}
      <div
        className="os-anim absolute"
        style={{
          left: HIT_LEFT,
          top: HIT_TOP,
          animation: run('os-scroll-mark'),
          willChange: 'transform',
        }}
      >
        <span
          className="os-anim absolute block rounded-full"
          style={{
            width: 52,
            height: 52,
            marginLeft: -26,
            marginTop: -26,
            border: `1.5px solid ${INK}0.65)`,
            animation: run('os-click'),
            willChange: 'transform, opacity',
          }}
        />
      </div>
    </div>
  );
}
