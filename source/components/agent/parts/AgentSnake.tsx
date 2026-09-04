'use client';

/**
 * The Snake — the agent's "work in progress" signature.
 *
 * A pixel board (7x3) with a chain of lit cells circulating its
 * perimeter, head brightest, body decaying to a dim tail: the arcade
 * game, at 34x16. The interior cells stay lit at board level so you
 * can SEE the board the snake is moving on, which is what makes it
 * read as Snake rather than as a row of blinking dots. Food waits on
 * the ring ahead, gets swallowed exactly as the head arrives, and
 * respawns a beat later — the loop tells a whole small story, and it
 * runs for as long as the function is running.
 *
 * The perimeter is a true CYCLE (16 cells, no jump back to a start),
 * so the motion loops seamlessly rather than restarting.
 *
 * ── how it animates, and why it costs nothing ──
 * There is no JS loop, no rAF, no state. Every cell runs the SAME
 * keyframe; a cell's position in the chain is expressed purely as a
 * negative `animation-delay` derived from its index on the ring. The
 * animated properties are `opacity` and `transform` only, so the whole
 * thing lives on the compositor. The head's glow is free: each cell
 * carries a permanent `box-shadow` in its own color, and since opacity
 * scales the shadow with the cell, only the bright head actually
 * glows. Sixteen 3px cells, one keyframe, zero layout.
 *
 * Rendered ONLY while a turn is in flight — a settled thread animates
 * nothing at all.
 */

const COLS = 7;
const ROWS = 3;

/**
 * Clockwise perimeter ring: across the top, down the right edge, back
 * along the bottom, up the left edge. Index = position in the cycle.
 */
function ringIndex(row: number, col: number): number | null {
  const lastCol = COLS - 1;
  const lastRow = ROWS - 1;
  if (row === 0) return col; // top edge, left → right
  if (col === lastCol) return lastCol + row; // right edge, down
  if (row === lastRow) return lastCol + lastRow + (lastCol - col); // bottom, right → left
  if (col === 0) return 2 * lastCol + lastRow + (lastRow - row); // left edge, up
  return null; // interior — board, not track
}

const RING_LENGTH = 2 * (COLS - 1) + 2 * (ROWS - 1); // 16
/** Seconds the head takes to advance one cell. */
const STEP_S = 0.085;
const CYCLE_S = RING_LENGTH * STEP_S;
/** Where the food sits on the ring — the far side, so it is visible
 *  for most of the lap before it is eaten. */
const FOOD_INDEX = Math.floor(RING_LENGTH * 0.55);

const CELLS = Array.from({ length: ROWS * COLS }, (_, i) => {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  return { key: i, ring: ringIndex(row, col) };
});

export function AgentSnake({ scale = 1, title }: { scale?: number; title?: string }) {
  return (
    <span
      className="ag-board shrink-0"
      role={title === undefined ? 'presentation' : 'img'}
      aria-label={title}
      aria-hidden={title === undefined}
      style={{
        // One knob: every metric derives from the cell size, so the
        // board scales without re-tuning gaps or radii.
        ['--ag-cell' as string]: `${3 * scale}px`,
        ['--ag-gap' as string]: `${1.5 * scale}px`,
        ['--ag-cycle' as string]: `${CYCLE_S}s`,
        gridTemplateColumns: `repeat(${COLS}, var(--ag-cell))`,
      }}
    >
      {CELLS.map((cell) =>
        cell.ring === null ? (
          <span key={cell.key} className="ag-cell" />
        ) : (
          <span
            key={cell.key}
            className={cell.ring === FOOD_INDEX ? 'ag-cell ag-cell--food' : 'ag-cell ag-cell--track'}
            style={{
              // Negative delay = already mid-cycle at t0, so the chain
              // is in steady state on the very first frame. Offsetting
              // by a full cycle keeps every value negative while the
              // head still advances with increasing ring index.
              animationDelay: `${(cell.ring * STEP_S - CYCLE_S).toFixed(3)}s`,
            }}
          />
        ),
      )}
    </span>
  );
}
