'use client';

/**
 * Part renderers for the agent chat thread, on the AI Elements stack:
 * text parts stream through Streamdown (parts/AgentMarkdown), reasoning
 * through the collapsible disclosure (parts/AgentReasoning), and tool
 * parts through the paired chrome/cards (parts/AgentToolView via the
 * pure lib/agent/view.ts join — a single part here renders its
 * standalone projection: a call → running row, a result → digest chip).
 *
 * Unknown part types render the F§ invariant-3 graceful fallback (dim
 * "unsupported content" chip) — never a crash, never raw JSON.
 * `proposal_ref` renders the real proposal card, which fetches the
 * canonical proposal from api BY ID — chat content supplies the id and
 * nothing else (F§ invariant 1).
 */

import type { ParsedPart } from '@/lib/agent/contracts';
import type { LinkEntities } from '@/lib/agent/mint-links';
import { buildTurnItems } from '@/lib/agent/view';
import { AgentMarkdown } from './parts/AgentMarkdown';
import { AgentReasoning } from './parts/AgentReasoning';
import { AgentToolView } from './parts/AgentToolView';
import { Chip } from './parts/Chip';
import { ProposalPart } from './proposal';

export function AgentPartView({
  parsed,
  streaming = false,
  onRetry,
  linkEntities,
}: {
  parsed: ParsedPart;
  /** True while this part belongs to the in-flight turn (activity affordances). */
  streaming?: boolean;
  /** Retry affordance for retryable error parts. */
  onRetry?: () => void;
  /** Link context from this turn's tool results ($TICKER→mint, mint vs wallet). */
  linkEntities?: LinkEntities;
}) {
  if (!parsed.known) {
    // F§ invariant 3: unknown content-part types degrade gracefully.
    return (
      <Chip
        tone="dim"
        label={`unsupported content · ${parsed.part.type}`}
        title="This client version cannot render this content yet."
        testId="agent-part-unknown"
      />
    );
  }
  const part = parsed.part;
  switch (part.type) {
    case 'text':
      return (
        <AgentMarkdown text={part.text} streaming={streaming} linkEntities={linkEntities} />
      );
    case 'reasoning':
      return <AgentReasoning summary={part.summary} streaming={streaming} />;
    case 'status':
      // Small activity chip ("reading the chart…").
      return <Chip tone="active" pulse={streaming} label={part.label} testId="agent-part-status" />;
    case 'error':
      return (
        <div
          data-testid="agent-part-error"
          className="rounded-[11px] border border-[rgba(224,106,106,0.3)] bg-[linear-gradient(160deg,rgba(224,106,106,0.14),rgba(224,106,106,0.045))] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
        >
          <div className="text-[12px] leading-snug text-[var(--down)]">{part.message}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--ink-3)]">{part.code}</span>
            {part.retryable && onRetry !== undefined ? (
              <button
                type="button"
                onClick={onRetry}
                className="ag-chip rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[var(--ink-1)] hover:text-[var(--ink-0)]"
              >
                retry
              </button>
            ) : null}
          </div>
        </div>
      );
    case 'tool_call':
    case 'tool_result': {
      // Standalone projection of a single tool part (the conversation
      // renders PAIRED items itself; this lane serves external callers
      // and lone parts): call → running row, result → digest chip.
      const item = buildTurnItems([parsed])[0];
      return item !== undefined && item.kind === 'tool' ? (
        <AgentToolView item={item} streaming={streaming} />
      ) : null;
    }
    case 'proposal_ref':
      return <ProposalPart part={part} streaming={streaming} />;
    default:
      return null;
  }
}
