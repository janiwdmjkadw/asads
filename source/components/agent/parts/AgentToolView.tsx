'use client';

/**
 * The EXTERNAL tool lane — the two results that earn their own surface
 * outside the turn's activity group (mock E: the group holds reasoning
 * and the tool rail; a card that carries real content sits below it):
 *
 *   proposal ack → the real approval card (ProposalPart)
 *   token state  → TokenStateCard (chart folded in when paired)
 *   a propose_conditional still IN FLIGHT → the build sequence over the
 *     true ghost (SorenBuildSequence; `null` with the flag off)
 *
 * Everything else — running rows, soft fails, holders, generic
 * previews, the unparseable/orphan fallback — is a NODE inside
 * `AgentActivityGroup`, which is where the digest, the formatted
 * key/value grid and "view raw json" now live.
 *
 * `hasExternalView` is the seam the conversation splits on, so the
 * group and this lane can never both claim one item's payload.
 *
 * Tool payload strings ALWAYS render as text (React escaping); nothing
 * from a preview is ever markdown-rendered or injected as HTML.
 */

import {
  buildActivityGroup,
  parseChartPreview,
  parseComparePreview,
  parseHoldersRows,
  parseTokenListPreview,
  parseTokenStatePreview,
  parseTradesPreview,
  TOOL_COMPARE_WALLETS,
  TOOL_MY_TRADES,
  TOOL_SCREEN_TOKENS,
  TOOL_SEARCH_TOKENS,
  TOOL_TOKEN_HOLDERS,
  TOOL_TOKEN_STATE,
  TOOL_TOKEN_TRADES,
  TOOL_TRACKED_ACTIVITY,
  type ToolViewItem,
} from '@/lib/agent/view';
import { useSorenChat } from '@/lib/flags/useSorenChat';
import {
  ComparePane,
  HoldersListPane,
  TokensListPane,
  TradesListPane,
} from '../soren/panes/ResultListPane';
import {
  ghostPlanFromArgs,
  TOOL_PROPOSE_CONDITIONAL,
  type GhostPlan,
} from '@/lib/agent/ghost-plan';
import { TokenStateCard } from '../cards/TokenStateCard';
import { ProposalPart, proposalRefFromToolResult } from '../proposal';
import { SorenBuildSequence } from '../soren/SorenBuildSequence';
import { AgentActivityGroup } from './AgentActivityGroup';

/**
 * THE SHAPE-KNOWN LANE (spec/30-creature.md §3.5, act 2).
 *
 * A `propose_conditional` call that has not finished still carries, in
 * its typed arguments, everything about the card it will produce. That is
 * a payload a surface owns, so the item leaves the activity group the
 * same way a finished ack does — and it leaves for the same reason: the
 * group must never draw what a card below it already draws.
 *
 * `null` means "read nothing usable", and the item stays an ordinary
 * activity node.
 */
export function shapeKnownPlan(item: ToolViewItem): GhostPlan | null {
  if (item.name !== TOOL_PROPOSE_CONDITIONAL) return null;
  return ghostPlanFromArgs(item.args);
}

/**
 * True when a card below the group renders this result's payload.
 *
 * The unfinished arm is the redesign's. It is safe for the CLASSIC path
 * because `external` changes nothing about a node that is not `done` —
 * its fields, digest and raw text are already empty — and because
 * `SorenBuildSequence` renders `null` with the flag off, which is exactly
 * what the conversation drew for an unfinished tool before.
 */
export function hasExternalView(item: ToolViewItem): boolean {
  if (item.state !== 'done') return shapeKnownPlan(item) !== null;
  if (proposalRefFromToolResult(item.preview) !== null) return true;
  return item.name === TOOL_TOKEN_STATE && parseTokenStatePreview(item.preview) !== null;
}

/**
 * True when the SOREN skin gives this result an object of its own — the
 * L06 list, holders first. Deliberately NOT part of `hasExternalView`:
 * flag-off, a done holders result is a real node in the classic group
 * (its preview grid), and claiming it here would strip that. The
 * conversation consults this only under the flag, where the group is
 * gone and the pane is the result's only surface. The ≤4-row law lives
 * in the pane; this asks only "is there a pane-shaped result at all".
 */
export function hasSorenResultView(item: ToolViewItem): boolean {
  if (item.state !== 'done') return false;
  switch (item.name) {
    case TOOL_TOKEN_HOLDERS: {
      const rows = parseHoldersRows(item.preview);
      return rows !== null && rows.length > 4;
    }
    case TOOL_TOKEN_TRADES:
    case TOOL_MY_TRADES:
    case TOOL_TRACKED_ACTIVITY: {
      const rows = parseTradesPreview(item.preview);
      return rows !== null && rows.length > 4;
    }
    case TOOL_SEARCH_TOKENS:
    case TOOL_SCREEN_TOKENS: {
      const rows = parseTokenListPreview(item.preview);
      return rows !== null && rows.length > 4;
    }
    case TOOL_COMPARE_WALLETS:
      // Two comparable wallets; the ≤3-metric law lives in the pane.
      return parseComparePreview(item.preview) !== null;
    default:
      return false;
  }
}

/**
 * Standalone projection of ONE tool item: the card when it has one,
 * otherwise a one-node activity group (the lone-part lane in
 * `AgentPartView`; the conversation splits the turn itself).
 */
export function AgentToolView({
  item,
  nowMs,
  streaming = false,
  movedOn = false,
  onStepUp,
}: {
  item: ToolViewItem;
  nowMs?: number;
  /**
   * The TURN this result belongs to is still streaming. It no longer
   * holds the card back (§3.5: beat 8 fires when the RECORD resolves,
   * not at turn commit) — the ghost it replaces stands at the plan's real
   * geometry, so the swap holds heights on its own.
   */
  streaming?: boolean;
  /**
   * The conversation has MOVED ON past this turn — a later assistant
   * turn exists (or one is streaming). The L06 list starts folded then
   * (§1.4.5's after-state); everything else ignores it.
   */
  movedOn?: boolean;
  /** Host-supplied step-up flow, forwarded to the proposal card. */
  onStepUp?: () => void;
}) {
  const soren = useSorenChat();
  // Checked before anything else so a RELOADED thread, where the call
  // part may not pair, still renders the card. Only the id crosses
  // over; the card fetches the canonical proposal by that id itself.
  if (proposalRefFromToolResult(item.preview) !== null) {
    /*
     * THE SAME PLAN THE BUILD SEQUENCE DREW, read off the same call's
     * arguments. That is what makes beat 8 move nothing: the ghost this
     * lane mounts is the ghost the running lane left behind, row for row.
     * An ORPHANED result — a reloaded thread whose call part did not pair
     * — has no arguments to read, so it falls back to the measured
     * reserve, which is the behaviour it has always had.
     */
    return (
      <div data-testid="agent-tool-proposal">
        <ProposalPart
          part={item.preview}
          streaming={streaming}
          ghostPlan={shapeKnownPlan(item)}
          {...(onStepUp === undefined ? {} : { onStepUp })}
        />
      </div>
    );
  }

  // The call is still in flight (or ended badly) and its shape is already
  // known: the build sequence owns the surface. Flag-off it renders null.
  if (item.state !== 'done') {
    const plan = shapeKnownPlan(item);
    if (plan !== null) return <SorenBuildSequence plan={plan} state={item.state} />;
  }

  if (item.name === TOOL_TOKEN_STATE && item.state === 'done') {
    const state = parseTokenStatePreview(item.preview);
    if (state !== null) {
      const chart = item.chart !== null ? parseChartPreview(item.chart.preview) : null;
      return (
        <div data-testid="agent-tool-token-state">
          <TokenStateCard state={state} chart={chart} nowMs={nowMs} />
        </div>
      );
    }
  }

  // The result objects — soren only (flag-off these items never reach
  // here: the conversation's fence consults `hasSorenResultView` only
  // under the flag, and the lone-part lane below keeps the classic group
  // node). Lists fold once the conversation has moved on.
  if (soren && item.state === 'done') {
    if (item.name === TOOL_TOKEN_HOLDERS) {
      const rows = parseHoldersRows(item.preview);
      if (rows !== null && rows.length > 4) {
        return <HoldersListPane rows={rows} folded={movedOn} />;
      }
    }
    if (
      item.name === TOOL_TOKEN_TRADES ||
      item.name === TOOL_MY_TRADES ||
      item.name === TOOL_TRACKED_ACTIVITY
    ) {
      const rows = parseTradesPreview(item.preview);
      if (rows !== null && rows.length > 4) {
        return <TradesListPane rows={rows} folded={movedOn} />;
      }
    }
    if (item.name === TOOL_SEARCH_TOKENS || item.name === TOOL_SCREEN_TOKENS) {
      const rows = parseTokenListPreview(item.preview);
      if (rows !== null && rows.length > 4) {
        return <TokensListPane rows={rows} folded={movedOn} />;
      }
    }
    if (item.name === TOOL_COMPARE_WALLETS) {
      const wallets = parseComparePreview(item.preview);
      if (wallets !== null) {
        return <ComparePane wallets={wallets} folded={movedOn} />;
      }
    }
  }

  // A lone item has no turn to take its streaming flag from: a call
  // still in flight IS the turn's activity, so the group opens on it.
  const { group } = buildActivityGroup([item], {
    streaming: item.state === 'running',
    hasExternalView,
  });
  return group === null ? null : <AgentActivityGroup group={group} />;
}
