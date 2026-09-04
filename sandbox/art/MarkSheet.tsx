import './art.css';
import { PADS } from '@/components/discover/column/rowData';
import { PAD_MARKS } from '@/components/discover/column/padMarks';

/*
 * THE MARKS, ON THEIR OWN.
 *
 * On a row the badge is 13px in the corner of a picture, which is the
 * size it has to work at but the worst size to judge a drawing at. This
 * shows each one big enough to see what was drawn, and then at the size
 * it actually renders, side by side.
 *
 * BOTH SIZES OR NEITHER. A mark that only works big is not a mark, it
 * is an illustration, and on the row these render at 17.5px.
 *
 * Pads with no mark are skipped rather than shown empty. Dynamic BC
 * has no logo of its own, and a blank cell in a sheet like this reads
 * as a mark that failed to draw.
 *
 * WHITE, which is how they render on the row. Showing them in the
 * launchpad's colour was showing a version that does not exist
 * anywhere, and a saturated colour hides weak drawing that white does
 * not.
 */

export function MarkSheet() {
  return (
    <div className="ms">
      {PADS.filter((pad) => PAD_MARKS[pad.key]).map((pad) => (
        <div className="ms-cell" key={pad.key}>
          <span className="ms-big">{PAD_MARKS[pad.key]}</span>
          <span className="ms-label">{pad.label}</span>
          <span className="ms-small">{PAD_MARKS[pad.key]}</span>
        </div>
      ))}
    </div>
  );
}
