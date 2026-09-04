'use client';

/**
 * The readiness gate — and the one rule this whole directory exists to
 * keep.
 *
 * `readiness.readyToTrade` IS the server's boolean. This component reads
 * it and renders it. It does not AND the funding state with the nonce
 * pool with the delegation state, it does not fall back to
 * `blockers.length === 0`, and it does not treat an empty blocker list
 * as evidence of anything. The gate ladder lives in the api
 * (`routes/agent-wallet/state.ts`) and includes conditions this page
 * never sees — a disabled policy version, for one — so a browser-side
 * recomputation would disagree with the trade path the first time the
 * ladder changed, and the trade path is the one that is right.
 *
 * `blockers` is the EXPLANATION, never the input: every outstanding
 * blocker is listed so the user sees all of them at once instead of
 * discovering them one round trip at a time.
 */

import { Badge, Card, Note } from './Card';
import { blockerLabel } from './format';
import type { AgentWalletReadiness } from './types';

export function AgentWalletReadinessCard({ readiness }: { readiness: AgentWalletReadiness }) {
  // Server truth, used as-is. Do not replace with a derivation.
  const ready = readiness.readyToTrade;
  const tone = ready ? 'good' : 'warn';

  return (
    <Card
      title="Trading readiness"
      testId="agent-wallet-readiness"
      tone={tone}
      badge={
        <Badge tone={tone} testId="readiness-badge">
          {ready ? 'ready to trade' : 'not ready'}
        </Badge>
      }
    >
      {ready ? (
        <Note testId="readiness-ready-note">
          The server reports this agent wallet is ready to trade.
        </Note>
      ) : (
        <>
          <Note testId="readiness-blocked-note">
            The server reports this agent wallet is not ready to trade. Everything still
            outstanding is listed below.
          </Note>
          {readiness.blockers.length === 0 ? (
            <Note testId="readiness-no-blockers">
              No reason was reported with it. That is a server-side gap, not a green light —
              treat the wallet as not ready and retry shortly.
            </Note>
          ) : (
            <ul data-testid="readiness-blockers" className="flex flex-col gap-1">
              {readiness.blockers.map((blocker, index) => (
                <li
                  key={`${blocker.raw}-${index}`}
                  data-testid={`readiness-blocker-${blocker.raw || 'unnamed'}`}
                  className="text-[11px]"
                  style={{ color: 'var(--ink-1)' }}
                >
                  {blockerLabel(blocker)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
