import './tracker.css';

import type { ReactNode } from 'react';

/** Horizontal wrapping row of removable chips (tracked handles/wallets). */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

export function TrackedChip({
  label,
  title,
  onRemove,
}: {
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  /*
   * The BUTTON is the whole pill, and the cross inside it is a mark
   * rather than a second target (`pointer-events: none` in the CSS).
   * It was the other way round: the pill lit on hover but only the 17px
   * cross could be clicked, so the hover promised a target the cursor
   * only found at the very end of it. Removal is the only thing this
   * popout does, so the pill does it.
   */
  return (
    <button type="button" className="tk-chip" title={title} onClick={onRemove} aria-label={`Stop tracking ${label}`}>
      <span>{label}</span>
      <span aria-hidden>
        {/* A DRAWN cross. `×` is a small glyph in a large em box, so it
            paints at about half the size it is set at and sat off
            centre in a 16px button. */}
        <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    </button>
  );
}
