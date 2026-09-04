'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

import '../split.css';

/**
 * The hero: the copy on paper, a conditional running on ink.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────
 *
 * Full bleed, two halves on a hairline. The copy sits in the left half on
 * a wide margin with registration ticks at the corners of that margin, and
 * the right half is a live readout of one conditional going through its
 * whole life: armed, watching while the market cap climbs, the match, and
 * filled.
 *
 * ── WHY THE RIGHT HALF IS INK ────────────────────────────────────────
 *
 * The page is white, so the split has to carry the contrast itself.
 * #0A0A0A is not a new colour invented for a hero: it is the exact surface
 * the conditional order card in the Agent band is already made of, so the
 * band is showing the product's own material rather than a decoration.
 *
 * ── THE CHROME IS NOT DECORATION ─────────────────────────────────────
 *
 * A cross at each corner of the panel, a tick rail on each side at the
 * vertical centre with the middle three taller, and four small squares. It
 * is instrument marking: it says the panel is a readout rather than a
 * slide, and it is what stops a large dark rectangle with one number in it
 * reading as empty.
 *
 * None of it moves. The readout is the only thing on the panel that
 * changes, and chrome that animated would compete with it.
 *
 * ── AND THE MARKET ONLY MOVES WHILE IT IS BEING WATCHED ──────────────
 *
 * The figure climbs during the watch beat and holds at $5,000 through the
 * match and the fill, so the number is never ahead of the story being told
 * around it.
 *
 * NOTE: the beats run 300 to 700ms longer than the numbers below, because
 * a timer plus a React commit is never the interval you asked for. Tune by
 * measuring rather than by reading these.
 */

const SANS = 'font-[family-name:var(--font-instrument-sans)]';

/*
 * `.lp` still declares the DARK palette, so every band on the light page
 * has to state its own. Without this the type paints near white on white.
 */
const LIGHT: CSSProperties = {
  '--lp-ground': '#ffffff',
  '--lp-ink-1': '#0b0b0b',
  '--lp-ink-2': '#55555a',
  '--lp-ink-3': '#8a8a90',
  '--lp-hairline': 'rgba(11, 11, 11, 0.13)',
} as CSSProperties;

const BEATS = [3000, 9000, 1800, 4600];
const WATCH = 1;

const LOG: ReadonlyArray<readonly [string, string]> = [
  ['03:14:02', 'Armed. Watching every block.'],
  ['03:52:44', 'Market cap crossed $5,000.'],
  ['03:52:45', 'Filled. 2 SOL at 0.0041.'],
];

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** The instrument marking. Inert, and aria-hidden: it carries no meaning. */
function Chrome(): ReactElement {
  return (
    <div className="sp-chrome" aria-hidden>
      <span className="sp-x is-tl" />
      <span className="sp-x is-tr" />
      <span className="sp-x is-bl" />
      <span className="sp-x is-br" />

      {/* The middle three ticks are taller, which is what makes the rail
          read as a scale rather than as a row of marks. */}
      <span className="sp-rail is-left">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} data-tall={i > 3 && i < 7 ? 'true' : 'false'} />
        ))}
      </span>
      <span className="sp-rail is-right">
        {Array.from({ length: 11 }, (_, i) => (
          <i key={i} data-tall={i > 3 && i < 7 ? 'true' : 'false'} />
        ))}
      </span>

      <span className="sp-sq is-a" />
      <span className="sp-sq is-b" />
      <span className="sp-sq is-c" />
      <span className="sp-sq is-d" />
    </div>
  );
}

export function HeroSplit() {
  const [beat, setBeat] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [cap, setCap] = useState(4182);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const ms = BEATS[beat] ?? 3000;
    const id = window.setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), ms);
    return () => window.clearTimeout(id);
  }, [beat, reduced]);

  /* The cap climbs only while it is being watched, and resets when the run
     comes back round, so the figure is never ahead of the story. */
  useEffect(() => {
    if (reduced || beat !== WATCH) {
      if (beat === 0) setCap(4182);
      return;
    }
    const id = window.setInterval(
      () => setCap((v) => Math.min(5000, v + 8 + Math.floor(Math.random() * 8))),
      130,
    );
    return () => window.clearInterval(id);
  }, [beat, reduced]);

  /* Reduced motion gets the finished run rather than a frozen first frame,
     which would read as a page that failed to load. */
  const at = reduced ? BEATS.length - 1 : beat;
  const state = ['Armed', 'Watching', 'Match', 'Filled'][at] ?? 'Armed';
  const shown = at === 0 ? 4182 : at >= 2 ? 5000 : cap;
  const pct = at === 0 ? 0 : Math.min(100, ((shown - 3800) / 1200) * 100);

  return (
    <section id="hero" style={LIGHT} className="sp">
      {/* ── the copy, on paper ──────────────────────────────────── */}
      <div className="sp-left">
        <span aria-hidden className="sp-tick is-tl" />
        <span aria-hidden className="sp-tick is-tr" />
        <span aria-hidden className="sp-tick is-bl" />
        <span aria-hidden className="sp-tick is-br" />

        <div className="sp-copy">
          <span className={`${SANS} sp-eyebrow`}>
            Built for Solana traders who never sleep on a fill
          </span>
          <h1 className={`${SANS} sp-h`}>
            Say it once.
            <br />
            It trades it
            <br />
            for you.
          </h1>
          <p className={`${SANS} sp-p`}>
            Solana has the markets. Listen holds your condition against them, block by block, until
            it is true.
          </p>
          {/* The site's own pair, not the reference's. That was a square
              outlined button with a plus in its own cell, and it looked
              like a control borrowed from another product because it was.
              Every other call to action on this page is this pill with a
              quiet link beside it. */}
          <div className="sp-go">
            <button type="button" className={`${SANS} sp-cta`}>
              Start trading
            </button>
            <a href="#agent" className={`${SANS} sp-alt`}>
              See how it works
            </a>
          </div>
        </div>
      </div>

      {/* ── the conditional, on ink ─────────────────────────────── */}
      <div className="sp-right">
        <Chrome />
        <div className="sp-run">
          <div className="sp-runtop">
            <span className={`${SANS} sp-sym`}>TAU</span>
            <span className={`${SANS} sp-state`} data-beat={at}>
              {state}
            </span>
          </div>

          <div className="sp-mid">
            <p className={`${SANS} sp-cond`}>Buy 2 SOL if the market cap passes $5,000</p>
            <p className={`${SANS} sp-figure tabular-nums`}>{money(shown)}</p>
            <div className="sp-meter">
              <i style={{ width: `${at >= 2 ? 100 : pct}%` }} />
            </div>
          </div>

          <ol className="sp-log">
            {LOG.map(([time, text], i) => (
              <li key={text} data-on={at >= i + 1 ? 'true' : 'false'}>
                <span className={`${SANS} tabular-nums`}>{time}</span>
                <b className={SANS}>{text}</b>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
