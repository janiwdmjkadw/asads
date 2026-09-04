'use client';

/**
 * `@`/`$` autocomplete list for the agent composer.
 *
 * Presentational only — detection, ranking and insertion live in
 * `lib/agent/mentions.ts`, which is pure and unit-tested. This renders the
 * ranked rows above the field and reports the pick; the field owns keyboard
 * focus throughout (arrow keys and Enter are handled there so typing is never
 * interrupted by a focus change).
 */

import type { MentionCandidate } from '@/lib/agent/mentions';

const SOURCE_BADGE: Record<MentionCandidate['source'], string> = {
  tracked: 'tracked',
  mine: 'mine',
  token: 'token',
  user: 'listen',
};

export function MentionPopover({
  candidates,
  activeIndex,
  onPick,
  onHover,
}: {
  candidates: readonly MentionCandidate[];
  activeIndex: number;
  onPick: (candidate: MentionCandidate) => void;
  onHover: (index: number) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      data-testid="agent-mention-popover"
      className="ag-pop absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[220px] overflow-y-auto rounded-[12px] py-1"
    >
      {candidates.map((candidate, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${candidate.kind}:${candidate.id}`}
            type="button"
            role="option"
            aria-selected={active}
            data-testid="agent-mention-option"
            // Keep focus in the textarea: mousedown would blur it first.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(candidate);
            }}
            onMouseEnter={() => onHover(index)}
            data-active={active ? 'true' : 'false'}
            className="ag-pop-row flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
          >
            {candidate.emoji === undefined ? null : (
              <span aria-hidden className="text-[12px] leading-none">
                {candidate.emoji}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ink-0)]">
              {candidate.label}
            </span>
            {candidate.hint === undefined ? null : (
              <span className="shrink-0 truncate text-[10px] text-[var(--ink-3)]">
                {candidate.hint}
              </span>
            )}
            <span className="shrink-0 rounded-full border border-[var(--hairline)] px-1.5 py-px text-[8.5px] uppercase tracking-[0.06em] text-[var(--ink-3)]">
              {SOURCE_BADGE[candidate.source]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
