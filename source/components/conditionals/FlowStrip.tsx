/**
 * The flow strip — five nodes on a fixed 22px pitch (8px node, 14px link).
 *
 * THE PITCH IS THE POINT. Because it never varies, the nodes stack into
 * five straight columns down the panel and the eye reads DEPTH before it
 * reads any row: four filled nodes is a play that has done things, two is
 * one that has only just started. It is also why the strip survives the
 * narrow reflow untouched — five 8px nodes cost the same at 360px as at
 * 1440px, which is the argument for the strip over a phrase.
 *
 * COLOUR IS THE THEME'S. The lab draws the live ring in its own mint; here
 * it is `var(--flame)` and the soft halo is a `color-mix` of it, so a user
 * on another ramp gets THEIR accent (the card-classes rule). `--down` is
 * spent on exactly one 8px mark, the failed node: red that spreads makes
 * two ordinary failures look like an outage.
 *
 * A DONE STEP IS LIT IN EVERY VIEW. The record used to drop the accent and
 * paint its filled nodes white-grey, so History, Expired and Failed each
 * rendered as a wall of grey dots — the strip stopped answering "how far
 * did it get" on precisely the views that exist to answer it. Grey is the
 * remainder now: what never happened, plus the barred stop/fail node.
 *
 * NO `title` ATTRIBUTES. The lab hangs a per-node hover time off each dot;
 * design-28 §4 forbids tooltips on rows outright, and the detail view is
 * where five timestamps belong. The strip carries ONE `aria-label`, which
 * `strip-model` composes.
 */

import type { ReactElement } from 'react';
import type { FlowLinkState, FlowNodeState, FlowStripModel } from './strip-model';

/**
 * NO `bg-transparent` HERE, and that is not a tidy-up. A node's ground is
 * already transparent, and stating it puts a second background utility of
 * EQUAL specificity on the same element as the `done` node's fill —
 * whichever Tailwind emits last wins, and it emitted `bg-transparent`
 * last, so every filled node in the strip rendered invisible while the
 * geometry checks stayed green (five nodes, right pitch, right columns —
 * all of them true of five nodes you cannot see).
 */
const NODE = 'relative h-[8px] w-[8px] flex-none rounded-full';

/** The bar through a stopped node — the same mark in two colours. */
const BAR =
  "after:absolute after:left-[1.5px] after:right-[1.5px] after:top-[3.5px] after:h-[1px] after:content-['']";

/** Live and held rings; the halo is 3px of the same hue at ~13%. */
const RING_LIVE =
  'shadow-[inset_0_0_0_2px_var(--flame),0_0_0_3px_color-mix(in_srgb,var(--flame)_13%,transparent)]';
const RING_HELD =
  'shadow-[inset_0_0_0_2px_var(--hold),0_0_0_3px_color-mix(in_srgb,var(--hold)_14%,transparent)]';

function nodeClass(state: FlowNodeState): string {
  switch (state) {
    case 'done':
      return `${NODE} bg-[var(--flame)]`;
    case 'now':
      return `${NODE} ${RING_LIVE}`;
    case 'held':
      return `${NODE} ${RING_HELD}`;
    case 'stop':
      return `${NODE} shadow-[inset_0_0_0_1px_var(--hairline-2)] ${BAR} after:bg-[var(--ink-2)]`;
    case 'fail':
      return `${NODE} shadow-[inset_0_0_0_1px_var(--down)] ${BAR} after:bg-[var(--down)]`;
    default:
      return `${NODE} shadow-[inset_0_0_0_1px_var(--ink-4)]`;
  }
}

function linkClass(state: FlowLinkState): string {
  const base = 'h-[1px] w-[14px] flex-none';
  return state === 'ahead'
    ? `${base} bg-[repeating-linear-gradient(90deg,var(--hairline-2)_0_2px,transparent_2px_5px)]`
    : `${base} bg-[var(--hairline-2)]`;
}

export function FlowStrip({ model }: { readonly model: FlowStripModel }): ReactElement {
  return (
    <span
      className="cdl-flow inline-flex flex-none items-center gap-0 self-center whitespace-nowrap"
      role="img"
      aria-label={model.label}
      data-testid="cdl-flow"
    >
      {model.nodes.map((node, index) => (
        <span key={index} className="contents">
          {index === 0 ? null : <i className={linkClass(model.links[index - 1] ?? 'solid')} />}
          <i className={nodeClass(node)} data-node={node} />
        </span>
      ))}
    </span>
  );
}
