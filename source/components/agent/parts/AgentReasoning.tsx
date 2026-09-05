'use client';

/**
 * The reasoning NODE of the turn's activity group (mock E) on the AI
 * Elements `Reasoning` collapsible: the summary auto-opens while it
 * streams, auto-closes shortly after it finishes, and stays collapsed
 * in history behind its one-line note — so reasoning reads as the
 * first thing the turn did, never as clutter wedged between the tool
 * results and the answer.
 *
 * The row is the rail's node line: mono "reasoned", a dim note, and
 * the elapsed time the group measured (live turns only — nothing on
 * the wire carries durations).
 */

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  useReasoning,
} from '@/components/ai-elements/reasoning';
import { Shimmer } from '@/components/ai-elements/shimmer';

function TriggerLabel({ note, elapsed }: { note: string | null; elapsed: string | null }) {
  const { isStreaming } = useReasoning();
  return (
    <span className="flex min-h-[19px] w-full items-center gap-[7px] text-[11px] leading-tight">
      {isStreaming ? (
        <Shimmer as="span" className="shrink-0 text-[11px] [font-family:var(--sans)] tabular-nums" duration={1.4}>
          reasoned
        </Shimmer>
      ) : (
        <span className="shrink-0 text-[var(--ink-2)] [font-family:var(--sans)] tabular-nums">reasoned</span>
      )}
      {note !== null ? (
        <span className="min-w-0 flex-1 truncate text-left text-[11px] text-[var(--ink-3)]">
          {note}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {elapsed !== null ? (
        <span className="shrink-0 text-[10px] tabular-nums text-[var(--ink-4)] [font-family:var(--sans)] tabular-nums">
          {elapsed}
        </span>
      ) : null}
    </span>
  );
}

export function AgentReasoning({
  summary,
  streaming = false,
  note = null,
  elapsed = null,
}: {
  summary: string;
  streaming?: boolean;
  /** Dim one-line peek at the summary when the disclosure is closed. */
  note?: string | null;
  /** Elapsed time measured by the activity group, when it has one. */
  elapsed?: string | null;
}) {
  return (
    <Reasoning isStreaming={streaming} className="mb-0" data-testid="agent-part-reasoning">
      <ReasoningTrigger className="w-full gap-0">
        <TriggerLabel note={note} elapsed={elapsed} />
      </ReasoningTrigger>
      <ReasoningContent className="agent-md agent-md--dim mb-1.5 mt-0.5 border-l-2 border-[var(--hairline-2)] pl-2.5 text-[11.5px] leading-[1.6]">
        {summary}
      </ReasoningContent>
    </Reasoning>
  );
}
