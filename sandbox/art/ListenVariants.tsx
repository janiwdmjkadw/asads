'use client';

import { useState } from 'react';
import './listen-variants.css';

/*
 * ── THE LISTEN TOGGLE, SIX WAYS ──────────────────────────────────────
 *
 * It flips the Holders tab into Listen's own holder cards — not a
 * filter, a different VIEW. That is why it has never looked like the
 * chips beside it and should not start now.
 *
 * Every one of these keeps the confetti mosaic, because that is the
 * thing being kept: five twinkling pixels borrowed from the FRENS nav
 * pill, which is what says this button belongs to Listen rather than to
 * the table it sits on.
 *
 * What varies is everything around it — the shell, the wordmark, the
 * count, and how loudly the ON state announces itself. Press a tile to
 * see both states; they are drawn on the tab strip's own ground so the
 * comparison is fair.
 */

/* The mosaic, exactly as it ships: same five cells, same palette, same
   stepped plot, same stagger. */
const CELLS: ReadonlyArray<{ x: number; y: number; c: string; d: string }> = [
  { x: 4, y: 0, c: '#f052d2', d: '0s' },
  { x: 8, y: 0, c: '#8b5cf6', d: '1.4s' },
  { x: 0, y: 4, c: '#fbbf24', d: '2.6s' },
  { x: 4, y: 4, c: '#37d67a', d: '0.8s' },
  { x: 8, y: 4, c: '#38bdf8', d: '2s' },
];

function Mosaic({ inline = false }: { inline?: boolean }) {
  return (
    <span className={inline ? 'lv-mosaic is-inline' : 'lv-mosaic'} aria-hidden>
      {CELLS.map((c) => (
        <i
          key={`${c.x}-${c.y}`}
          className="lv-px"
          style={{
            left: c.x,
            top: c.y,
            background: c.c,
            boxShadow: `0 0 4px color-mix(in srgb, ${c.c} 65%, transparent)`,
            animationDelay: c.d,
          }}
        />
      ))}
    </span>
  );
}

function Eq({ on }: { on: boolean }) {
  return (
    <span className="lv-eq" aria-hidden>
      {[0, 1, 2].map((i) => (
        <i key={i} data-on={on ? '' : undefined} style={{ animationDelay: `${i * 0.16}s` }} />
      ))}
    </span>
  );
}

function Tile({ id, name, children }: { id: string; name: string; children: (on: boolean) => React.ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <div className="lv-tile">
      <div className="lv-strip">
        <span className="lv-tab">Trades</span>
        <span className="lv-tab is-on">Holders</span>
        <span className="lv-gap" />
        <button type="button" className="lv-btn" data-v={id} data-on={on ? '' : undefined} onClick={() => setOn((v) => !v)}>
          {children(on)}
        </button>
      </div>
      <span className="lv-name">{id} · {name}</span>
    </div>
  );
}

export function ListenVariants() {
  return (
    <div className="lv">
      <div className="lv-grid">
        {/* Where it is now: a gradient ring around a dark core, an
            equaliser, a gradient wordmark and a count badge. */}
        <Tile id="A" name="Shipping">
          {(on) => (
            <>
              <Eq on={on} />
              <em className="lv-word is-grad">Listen</em>
              {on ? <b className="lv-count is-ring">1.2K</b> : null}
              <Mosaic />
            </>
          )}
        </Tile>

        {/* The mark carries the colour and nothing else does. One
            gradient on a strip of grey chips is enough. */}
        <Tile id="B" name="Quiet">
          {(on) => (
            <>
              <Eq on={on} />
              <em className="lv-word">Listen</em>
              {on ? <b className="lv-count">1.2K</b> : null}
              <Mosaic />
            </>
          )}
        </Tile>

        {/* No equaliser. The mosaic already twinkles — two things moving
            in a 90px pill is one too many — so the pixels do the whole
            job of saying "live". */}
        <Tile id="C" name="Mosaic only">
          {(on) => (
            <>
              <Mosaic inline />
              <em className="lv-word">Listen</em>
              {on ? <b className="lv-count">1.2K</b> : null}
            </>
          )}
        </Tile>

        {/* Filled when on. The strongest read of the six: it stops being
            a chip and becomes a lit surface, which is what a VIEW
            change deserves next to two filters. */}
        <Tile id="D" name="Filled">
          {(on) => (
            <>
              <Eq on={on} />
              <em className="lv-word">Listen</em>
              {on ? <b className="lv-count">1.2K</b> : null}
              <Mosaic />
            </>
          )}
        </Tile>

        {/* Wordless. The mosaic IS the wordmark — it is already the
            thing you recognise — with the count beside it. */}
        <Tile id="E" name="Mark">
          {(on) => (
            <>
              <Mosaic inline />
              {on ? <b className="lv-count">1.2K</b> : null}
            </>
          )}
        </Tile>

        {/* The mosaic underneath rather than in the corner: a strip of
            colour along the bottom edge, so the pill reads as sitting on
            Listen's own band. */}
        <Tile id="F" name="Underline">
          {(on) => (
            <>
              <em className="lv-word">Listen</em>
              {on ? <b className="lv-count">1.2K</b> : null}
              <Mosaic />
            </>
          )}
        </Tile>
      </div>
    </div>
  );
}
