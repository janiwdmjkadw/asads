import type { ReactNode } from 'react';
import { EDGE, HEADER_H } from './panel-styles';
import './tracker.css';

/**
 * Shared chrome for both Tracker columns: a fixed header (title + count
 * + optional right slot), an optional toolbar row (the add-field +
 * chips), and a single scrolling body. One source of truth so the two
 * panels stay visually identical (frontend-style rule 4). Page/layout
 * padding lives here, not on the leaf feed rows (rule 3).
 */
export function TrackerPanel({
  title,
  count,
  afterCount,
  right,
  toolbar,
  hideHeader,
  children,
}: {
  title: string;
  count?: number;
  /** Panel-level control that belongs WITH the title, not at the far
   *  end of the bar — the tape's column settings. */
  afterCount?: ReactNode;
  right?: ReactNode;
  toolbar?: ReactNode;
  /** Embedded chrome (the Discover dock) renders its own header row —
   *  suppress this one so the panel doesn't stack two title bars. */
  hideHeader?: boolean;
  children: ReactNode;
}) {
  return (
    /* A container, so the tape inside can answer to the PANEL's width.
       The split is draggable and the dock mounts this same component at
       ~300px, neither of which the viewport knows anything about. */
    <section className="tk-panel flex h-full min-h-0 flex-col" style={{ background: 'var(--surface-0, transparent)' }}>
      {hideHeader ? null : (
      /* z-30: the header sits ABOVE the toolbar row below it, so a menu
         opened from up here is not painted over by a row that had to
         rank itself above the feed. */
      <header
        className={`${EDGE} ${HEADER_H} relative z-30 flex shrink-0 items-center gap-2`}
        style={{ borderBottom: '1px solid var(--hairline)' }}
      >
        {/* No status dot. A lit pip before the panel's name is a
            decoration that claims to be information — it said the feed
            had events, which the feed itself already says by having
            rows in it. */}
        {/* A name, not a stamp. This was 11px bold uppercase on a
            0.14em track — the printout voice the rest of the product
            has dropped. */}
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--ink-0)' }}>
          {title}
        </h2>
        {typeof count === 'number' ? (
          /* A number, not a badge. It was a bordered pill on a plate for
             a figure that is at most three digits and never changes on
             its own — chrome around a count nobody has to find. */
          <span
            className="text-[11.5px] font-semibold tabular-nums"
            style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}
          >
            {count}
          </span>
        ) : null}
        {afterCount}
        <div className="flex-1" />
        {right}
      </header>
      )}

      {toolbar ? (
        /*
         * ── WHY EVERY DROPDOWN WAS BEING PAINTED OVER ──────────────
         *
         * The `animation` below leaves a transform on this element for
         * good (`both` keeps the last keyframe), and an element with a
         * transform IS A STACKING CONTEXT. So the popouts inside the
         * toolbar — the tracked list, the column gear, the address
         * suggestions — had their z-index trapped in here, while this
         * div itself sat at `z-index: auto` and therefore painted in
         * DOM ORDER against the feed below it. The feed comes later, so
         * the feed won, every time, no matter how high the popout
         * asked to be.
         *
         * Ranking the two rows fixes all three popouts at once.
         */
        <div
          className={`${EDGE} relative z-20 shrink-0 py-2.5`}
          style={{
            borderBottom: '1px solid var(--hairline)',
            // Entrance only — the toolbar mounts on demand in the dock
            // (revealed by clicking into the panel), and a hard pop-in
            // reads as a glitch there. Steady-state cost is zero.
            animation: 'dp-rise 200ms var(--ease-out) both',
          }}
        >
          {toolbar}
        </div>
      ) : null}

      <div className="tk-scroll relative z-0 min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** Centered empty/placeholder state for a panel body. */
export function PanelEmpty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      {icon ? <div style={{ color: 'var(--ink-3)' }}>{icon}</div> : null}
      <p className="text-[13px] font-semibold" style={{ color: 'var(--ink-1)' }}>
        {title}
      </p>
      {hint ? (
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
