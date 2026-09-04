'use client';

import { useState } from 'react';
import './grab-variants.css';

/*
 * ── THE SHEET'S HANDLE, EIGHT WAYS ───────────────────────────────────
 *
 * Each one is drawn on the real thing: the sheet's own black, its 15px
 * top corners, its actual top edge, and 34px of strip — so what is being
 * judged is the handle at the size and against the ground it lives on,
 * not a drawing of it on a card.
 *
 * The first row of every tile is what it looks like at rest. Press a
 * tile to see the same handle with the sheet raised, because several of
 * these say something different in each state and a handle that only
 * works in one of them is not finished.
 */

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: up ? 'none' : 'rotate(180deg)' }}>
    <path d="m6 14.5 6-6 6 6" />
  </svg>
);

function Tile({ id, name, children }: { id: string; name: string; children: (open: boolean) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gv-tile">
      <button
        type="button"
        className="gv-sheet"
        data-v={id}
        data-open={open ? '' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="gv-grab">{children(open)}</span>
        <span className="gv-body" aria-hidden>
          <span className="gv-pair">
            <i className="gv-buy">Buy</i>
            <i className="gv-sell">Sell</i>
          </span>
          <span className="gv-field" />
        </span>
      </button>
      <span className="gv-name">{id} · {name}</span>
    </div>
  );
}

export function GrabVariants() {
  return (
    <div className="gv">
      <div className="gv-grid">
        {/* Where it is now. */}
        <Tile id="A" name="Bar">
          {() => <span className="gv-bar" />}
        </Tile>

        {/* Longer and thinner. The bar stops being an object and starts
            being a seam you can grab. */}
        <Tile id="B" name="Seam">
          {() => <span className="gv-bar is-seam" />}
        </Tile>

        {/* The bar says where the sheet GOES rather than that it can be
            held: a caret pointing at the stop the press would take it
            to, which flips once it is up. */}
        <Tile id="C" name="Caret">
          {(open) => <span className="gv-caret"><Chevron up={!open} /></span>}
        </Tile>

        {/* A drawer pull: the tab sits ABOVE the sheet's edge rather than
            inside it, so the sheet reads as something that slides. */}
        <Tile id="D" name="Pull">
          {() => <span className="gv-pull"><i /></span>}
        </Tile>

        {/* The bar bends into a shallow chevron at rest and flattens
            when the sheet is up. One shape, two states, no second mark. */}
        <Tile id="E" name="Bend">
          {(open) => (
            <span className="gv-bend" data-flat={open ? '' : undefined}>
              <svg viewBox="0 0 44 10" fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
                <path d={open ? 'M4 6h36' : 'M4 7.5 22 3l18 4.5'} />
              </svg>
            </span>
          )}
        </Tile>

        {/* No bar at all. The top edge itself brightens toward the
            middle, so the whole strip is the handle and nothing is drawn
            on top of the sheet. */}
        <Tile id="F" name="Edge">
          {() => <span className="gv-edge" />}
        </Tile>

        {/* The handle carries the one thing you would open it for. It is
            a bar and a word, which is also the only variant that says
            what is inside before you pull it. */}
        <Tile id="G" name="Label">
          {(open) => (
            <span className="gv-label">
              <i className="gv-bar is-short" />
              <em>{open ? 'Close' : 'Trade'}</em>
            </span>
          )}
        </Tile>

        {/* Three grip lines, the way a physical handle is knurled. Wider
            target, and it reads as something meant to be held rather
            than as a decoration centred on an edge. */}
        <Tile id="H" name="Grip">
          {() => (
            <span className="gv-grip">
              <i /><i /><i />
            </span>
          )}
        </Tile>
      </div>
    </div>
  );
}
