'use client';

/**
 * The turn's ACTIVITY GROUP — 30-thinking-tools mock E: direction B's
 * collapsing shell with direction D's node rail as its interior.
 *
 * One object per assistant turn holds the reasoning and every tool
 * call, so the settled thread is a single 30px line ("✓ reasoned +
 * 3 tools · 6.2s") instead of four stacked cards, and one click
 * reopens the whole trace. While the turn works, the header names the
 * current activity and a thin INDETERMINATE rail runs beneath it —
 * indeterminate by construction, so it cannot stick half-filled the
 * way the old holders progress bar did.
 *
 * Timing is measured client-side across the streaming edge (nothing on
 * the wire carries durations), so a reloaded thread shows none — the
 * same convention AgentReasoning already used for its trigger.
 *
 * Tool payload values ALWAYS render as text (React escaping); nothing
 * from a preview is markdown-rendered or injected as HTML.
 */

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ActivityGroup, ActivityNode } from '@/lib/agent/view';
import { AgentReasoning } from './AgentReasoning';
import { AgentSnake } from './AgentSnake';

/* ---------------------------------------------------------------- *
 * timing — start/end per node, observed across the streaming edge
 * ---------------------------------------------------------------- */

interface Timing {
  start: number;
  end: number | null;
  /** Only rows we watched RUN can be honestly timed (history cannot). */
  observedRunning: boolean;
}

/**
 * Measured times live OUTSIDE the component: the store re-keys a turn
 * when it commits, so the streaming group unmounts and a history group
 * mounts in its place — a component-local map would reset every clock
 * at the exact moment the turn settles. Node keys come from part
 * content (`view.ts`), so they survive that handoff. Bounded so a long
 * session cannot grow it without limit.
 */
const TIMINGS = new Map<string, Timing>();
const MAX_TIMINGS = 400;

function rememberTiming(key: string, timing: Timing): void {
  if (TIMINGS.size >= MAX_TIMINGS) {
    const oldest = TIMINGS.keys().next();
    if (!oldest.done) TIMINGS.delete(oldest.value);
  }
  TIMINGS.set(key, timing);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function useTimings(nodes: readonly ActivityNode[], running: boolean) {
  const timings = useRef(TIMINGS);
  const [, bump] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let changed = false;
    const at = Date.now();
    for (const node of nodes) {
      const known = timings.current.get(node.key);
      if (known === undefined) {
        rememberTiming(node.key, {
          start: at,
          end: node.state === 'running' ? null : at,
          observedRunning: node.state === 'running',
        });
        changed = true;
      } else if (known.end === null && node.state !== 'running') {
        known.end = at;
        changed = true;
      }
    }
    if (changed) bump((v) => v + 1);
    // Rows only appear or settle when the turn's items change, and the
    // write is idempotent — so this converges rather than chaining.
  }, [nodes]);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [running]);

  const nodeDuration = (key: string): string | null => {
    const t = timings.current.get(key);
    if (t === undefined || !t.observedRunning) return null;
    const stop = t.end ?? (now === 0 ? t.start : now);
    return formatSeconds(Math.max(0, stop - t.start));
  };

  // The group's own clock spans every row of THIS turn we watched run.
  const watched = nodes
    .map((n) => timings.current.get(n.key))
    .filter((t): t is Timing => t !== undefined && t.observedRunning);
  let total: string | null = null;
  if (watched.length > 0) {
    const start = Math.min(...watched.map((t) => t.start));
    const ends = watched.map((t) => t.end);
    const finished = ends.every((e) => e !== null);
    const stop = running || !finished ? (now === 0 ? start : now) : Math.max(...(ends as number[]));
    total = formatSeconds(Math.max(0, stop - start));
  }

  return { nodeDuration, total };
}

/* ---------------------------------------------------------------- *
 * rows
 * ---------------------------------------------------------------- */

const duration = 'shrink-0 text-[10px] tabular-nums text-[var(--ink-4)] [font-family:var(--sans)] tabular-nums';

/* Every variant sets its own background: two arbitrary `bg-[…]` classes
   on one element resolve by stylesheet order, not class order. */
const dotBase =
  'absolute -left-[14px] top-[6.5px] h-[7px] w-[7px] shrink-0 rounded-full border';

function NodeDot({ node }: { node: ActivityNode }) {
  if (node.kind === 'reasoning') {
    // Open ring: reasoning is thought, not a result.
    return <span aria-hidden className={`${dotBase} border-[var(--flame)] bg-transparent`} />;
  }
  if (node.state === 'running') {
    // Breathes and sheds a halo — same language as the working orb,
    // one size down, so "in flight" reads identically everywhere.
    return (
      <span
        aria-hidden
        className={`${dotBase} ag-dot-running border-[var(--flame)] bg-[var(--flame)] shadow-[0_0_8px_var(--flame-glow)]`}
      />
    );
  }
  if (node.state === 'soft_failed') {
    return (
      <span
        aria-hidden
        className={`${dotBase} border-[var(--down)] bg-[var(--down)] shadow-[0_0_0_3px_rgba(224,106,106,0.14)]`}
      />
    );
  }
  // Landed: springs in and flashes its ring once, so a finishing tool
  // is legible as an EVENT even when the eye is elsewhere in the trace.
  return <span aria-hidden className={`${dotBase} ag-dot-done border-[var(--up)] bg-[var(--up)]`} />;
}

function KeyValueGrid({ node }: { node: ActivityNode }) {
  return (
    <div className="ag-kv my-1 rounded-[10px] px-2.5 py-2">
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-1.5">
        {node.fields.map((field) => (
          <Fragment key={field.key}>
            <span className="min-w-0">
              <span className="block text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
                {field.label}
              </span>
              <span className="block truncate text-[12px] tabular-nums text-[var(--ink-0)] [font-family:var(--sans)] tabular-nums">
                {field.value}
              </span>
            </span>
          </Fragment>
        ))}
      </div>
      {node.raw !== null ? (
        <details className="mt-2 border-t border-[var(--hairline)] pt-1.5">
          <summary className="cursor-pointer list-none text-[9.5px] uppercase tracking-[0.08em] text-[var(--ink-3)] transition-colors hover:text-[var(--ink-2)]">
            view raw json
          </summary>
          <pre
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--hairline)] bg-[var(--surface-1)] p-2 text-[10.5px] leading-relaxed text-[var(--ink-2)]"
            style={{ fontFamily: 'var(--sans)' }}
          >
            {node.raw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ToolNode({
  node,
  elapsed,
  onRetry,
}: {
  node: ActivityNode;
  elapsed: string | null;
  onRetry?: () => void;
}) {
  const failed = node.state === 'soft_failed';
  return (
    <div
      className="ag-node relative"
      data-testid={failed ? 'agent-tool-softfail' : 'agent-activity-node'}
    >
      <NodeDot node={node} />
      <div className="flex min-h-[19px] items-center gap-[7px] text-[11px] leading-tight">
        {node.streaming ? (
          <Shimmer as="span" className="shrink-0 text-[11px] [font-family:var(--sans)] tabular-nums" duration={1.4}>
            {node.name}
          </Shimmer>
        ) : (
          <span
            className={`shrink-0 [font-family:var(--sans)] tabular-nums ${failed ? 'text-[var(--down)]' : 'text-[var(--ink-2)]'}`}
          >
            {node.name}
          </span>
        )}
        {node.note !== null ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink-3)]">{node.note}</span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {failed && onRetry !== undefined ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-full border border-[rgba(224,106,106,0.35)] px-[7px] py-px text-[9.5px] uppercase tracking-[0.06em] text-[var(--down)] transition-colors hover:bg-[rgba(224,106,106,0.08)]"
          >
            retry
          </button>
        ) : null}
        {elapsed !== null ? <span className={duration}>{elapsed}</span> : null}
      </div>
      {node.digest !== null ? (
        <div className="truncate pb-[3px] text-[11px] tabular-nums text-[var(--ink-1)] [font-family:var(--sans)] tabular-nums">
          {node.digest}
        </div>
      ) : null}
      {node.fields.length > 0 ? <KeyValueGrid node={node} /> : null}
    </div>
  );
}

function ReasoningNode({ node, elapsed }: { node: ActivityNode; elapsed: string | null }) {
  return (
    <div className="ag-node relative" data-testid="agent-activity-node">
      <NodeDot node={node} />
      <AgentReasoning
        summary={node.summary ?? ''}
        streaming={node.streaming}
        note={node.note}
        elapsed={elapsed}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * the group
 * ---------------------------------------------------------------- */

export function AgentActivityGroup({
  group,
  onRetry,
}: {
  group: ActivityGroup;
  /** Offered by the failed node's inline RETRY chip (retries the turn). */
  onRetry?: () => void;
}) {
  const { nodeDuration, total } = useTimings(group.nodes, group.running);
  // Auto-open while working, collapsed once the turn settles — until the
  // viewer says otherwise, and then their choice sticks.
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? group.running;
  const railId = useId();

  return (
    <div
      data-testid="agent-activity-group"
      data-open={open ? 'true' : 'false'}
      data-running={group.running ? 'true' : 'false'}
      className="ag-activity overflow-hidden rounded-xl border"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={railId}
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-2 px-[11px] py-2 text-left text-[11px] leading-tight transition-colors hover:bg-[rgba(11, 14, 20, 0.03)]"
      >
        {group.running ? (
          <AgentSnake />
        ) : group.failedCount > 0 ? (
          <span aria-hidden className="shrink-0 text-[10px] leading-none text-[var(--hold)]">
            !
          </span>
        ) : (
          <span aria-hidden className="shrink-0 text-[10px] leading-none text-[var(--up)]">
            ✓
          </span>
        )}
        {group.running ? (
          <Shimmer as="span" className="min-w-0 flex-1 truncate text-[11px]" duration={1.4}>
            {group.label}
          </Shimmer>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[var(--ink-2)]">
            <span className="font-medium text-[var(--ink-1)]">{group.title}</span>
            {group.failedCount > 0 ? (
              <>
                <span className="text-[var(--ink-4)]"> · </span>
                {group.failedCount} retried
              </>
            ) : null}
          </span>
        )}
        {total !== null ? <span className={duration}>{total}</span> : null}
        <span
          aria-hidden
          className={`shrink-0 text-[8px] text-[var(--ink-4)] transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
      </button>

      {/* The trace expands on a grid row rather than a measured height,
          so any length opens smoothly and collapses the same way. Kept
          mounted while closed only when it HAS nodes, so the settled
          thread still costs one row. */}
      {group.nodes.length > 0 ? (
        <div className="ag-reveal" data-open={open ? 'true' : 'false'}>
          {/* `inert` while collapsed: the trace stays mounted so the
              collapse can animate, but overflow-hidden alone would leave
              it focusable and readable by a screen reader. */}
          <div inert={!open}>
            <div
              id={railId}
              className="relative flex flex-col gap-[3px] border-t border-[var(--hairline)] py-2 pl-[26px] pr-[11px] before:absolute before:bottom-4 before:left-[15px] before:top-[15px] before:w-px before:bg-[var(--hairline-2)] before:content-['']"
            >
              {group.nodes.map((node) =>
                node.kind === 'reasoning' ? (
                  <ReasoningNode key={node.key} node={node} elapsed={nodeDuration(node.key)} />
                ) : (
                  <ToolNode
                    key={node.key}
                    node={node}
                    elapsed={nodeDuration(node.key)}
                    onRetry={onRetry}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
