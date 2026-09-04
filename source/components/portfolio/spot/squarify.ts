/**
 * Squarified treemap layout (Bruls, Huijing, van Wijk, 2000).
 *
 * Input: a list of `value` numbers (assumed > 0 and sorted desc), plus
 * the rectangle to fill. Output: one rect per input value, sized so
 * area ∝ value and aspect ratios stay close to 1.
 *
 * Pure, deterministic, exported here so the treemap component stays
 * declarative and we can unit test the layout independent of React.
 */

export interface TreemapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SquarifyInput {
  readonly values: ReadonlyArray<number>;
  readonly width: number;
  readonly height: number;
}

export function squarify(input: SquarifyInput): TreemapRect[] {
  const total = input.values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (
    total <= 0 ||
    input.width <= 0 ||
    input.height <= 0 ||
    input.values.length === 0
  ) {
    return input.values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  }
  // Scale values so their sum equals area (width*height).
  const area = input.width * input.height;
  const scaled = input.values.map((v) => (v > 0 ? (v * area) / total : 0));

  const rects: TreemapRect[] = new Array(input.values.length);
  const layout = (
    items: { value: number; index: number }[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void => {
    if (items.length === 0) return;
    if (items.length === 1) {
      rects[items[0]!.index] = { x, y, w, h };
      return;
    }
    let row: { value: number; index: number }[] = [];
    let bestRatio = Number.POSITIVE_INFINITY;
    const shortSide = Math.min(w, h);
    let i = 0;
    while (i < items.length) {
      const candidate = [...row, items[i]!];
      const ratio = worstAspect(candidate.map((c) => c.value), shortSide);
      if (ratio > bestRatio) break;
      row = candidate;
      bestRatio = ratio;
      i += 1;
    }
    // Lay the row along the short side.
    const rowSum = row.reduce((s, r) => s + r.value, 0);
    if (w <= h) {
      // place row across the top
      const rowH = rowSum / w;
      let cx = x;
      for (const r of row) {
        const rw = r.value / rowH;
        rects[r.index] = { x: cx, y, w: rw, h: rowH };
        cx += rw;
      }
      layout(items.slice(row.length), x, y + rowH, w, h - rowH);
    } else {
      // place row down the left
      const rowW = rowSum / h;
      let cy = y;
      for (const r of row) {
        const rh = r.value / rowW;
        rects[r.index] = { x, y: cy, w: rowW, h: rh };
        cy += rh;
      }
      layout(items.slice(row.length), x + rowW, y, w - rowW, h);
    }
  };

  layout(
    scaled.map((value, index) => ({ value, index })),
    0,
    0,
    input.width,
    input.height,
  );
  // Guard: rects that didn't get placed (zero-value items).
  for (let i = 0; i < rects.length; i += 1) {
    if (!rects[i]) rects[i] = { x: 0, y: 0, w: 0, h: 0 };
  }
  return rects;
}

function worstAspect(row: number[], side: number): number {
  if (row.length === 0) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((s, v) => s + v, 0);
  if (sum <= 0) return Number.POSITIVE_INFINITY;
  let mx = -Infinity;
  let mn = Infinity;
  for (const v of row) {
    if (v > mx) mx = v;
    if (v < mn) mn = v;
  }
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * mx) / sum2, sum2 / (side2 * mn));
}
