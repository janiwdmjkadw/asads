'use client';

import { useState } from 'react';
import type { MeWalletEntry } from '@/lib/api/me';
import { useSelectedWalletStore, isEligibleWallet, pickDefaultSelectedWallet } from '@/lib/state/selected-wallet-store';
import type { WalletGroup } from '@/lib/api/wallet-groups';
import { Caption } from '@/components/listen/primitives';
import { WalletRow } from './WalletRow';
import { WalletsHeaderRow, WALLETS_GRID_TEMPLATE } from './tableLayout';
import type { DelegationChip } from './agentWallet';

/**
 * Slice "Portfolio page wallets tab": main wallets list. Renders one
 * `<GroupRow/>` per server-persisted group (collapsed by default with
 * a chevron-expand affordance), followed by every filtered eligible
 * wallet as a `<WalletRow/>`.
 *
 * Selection is mirrored into the shared `useSelectedWalletStore`
 * `multiSelectedWalletAccountIds` set so the wallet-count button on
 * the trade page picks it up automatically.
 */

interface Props {
  readonly filtered: ReadonlyArray<MeWalletEntry>;
  readonly allWallets: ReadonlyArray<MeWalletEntry>;
  readonly groups: ReadonlyArray<WalletGroup>;
  readonly balancesByWalletId: ReadonlyMap<string, string>;
  readonly onEditGroup: (group: WalletGroup) => void;
  readonly onDeleteGroup: (group: WalletGroup) => Promise<void> | void;
  /** Open the Export Private Key modal for the given wallet. */
  readonly onExportKey: (walletAccountId: string) => void;
  /** Open the per-wallet nonce-setup modal for a not-trade-ready wallet. */
  readonly onSetup: (walletAccountId: string) => void;
  /**
   * Slice "Agent wallet in Portfolio → Wallets": the agent wallet, or
   * `null` when the user has none yet. Rendered in its OWN section
   * below the user wallets and DELIBERATELY absent from `filtered` —
   * `/me.wallets` now returns it alongside the user wallets, so the
   * caller owns that split and it is the only thing standing between
   * this table and rendering the same wallet twice.
   */
  readonly agentWallet: AgentWalletRowModel | null;
  /**
   * Opens the agent-wallet ceremony. Present even when
   * `agentWallet` is null — that is the "no agent wallet yet" case, and
   * this is the inline affordance that starts setup.
   */
  readonly onOpenAgentWallet: () => void;
}

export interface AgentWalletRowModel {
  /** The wallet's real `/me.wallets` entry — never a synthetic copy. */
  readonly entry: MeWalletEntry;
  /**
   * Delegation chip, or `null` while the agent-wallet status read (the
   * one fact `/me` does not carry) is still in flight.
   */
  readonly delegation: DelegationChip | null;
}

export function WalletsTable(props: Props): React.ReactElement {
  const selectedIds = useSelectedWalletStore(
    (s) => s.multiSelectedWalletAccountIds,
  );
  const setMultiSelectedWalletAccountIds = useSelectedWalletStore(
    (s) => s.setMultiSelectedWalletAccountIds,
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const selectedSet = new Set(selectedIds);
  const fallbackPrimaryId =
    pickDefaultSelectedWallet(props.allWallets.filter(isEligibleWallet))?.wallet_account_id ?? null;

  /* No fallback: on this table, unselecting the last wallet means none
     are selected, and that is a state the page is allowed to be in. */
  const toggleSelect = (walletAccountId: string) => {
    const next = new Set(selectedIds);
    if (next.has(walletAccountId)) {
      next.delete(walletAccountId);
    } else {
      next.add(walletAccountId);
    }
    setMultiSelectedWalletAccountIds(Array.from(next));
  };

  const toggleExpand = (groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleGroupSelect = (group: WalletGroup) => {
    const members = group.wallet_account_ids;
    const allSelected = members.every((id) => selectedSet.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of members) next.delete(id);
    } else {
      for (const id of members) next.add(id);
    }
    setMultiSelectedWalletAccountIds(Array.from(next));
  };

  // Build a quick lookup so we can render group members in the same
  // table even when search has filtered some out.
  const walletById = new Map<string, MeWalletEntry>();
  for (const w of props.allWallets) walletById.set(w.wallet_account_id, w);

  // Determine which wallet ids are "claimed" by an expanded group, so
  // we can render them inline under the group row but skip them from
  // the standalone list below.
  const inlineMemberIds = new Set<string>();
  for (const g of props.groups) {
    if (expandedGroupIds.has(g.id)) {
      for (const id of g.wallet_account_ids) inlineMemberIds.add(id);
    }
  }

  return (
    <div
      className="flex flex-col"
      style={{
        gap: 0,
      }}
    >
      <WalletsHeaderRow />
      {/*
        * ── NO GROUP TREE ────────────────────────────────────────────
        *
        * This rendered a `GroupRow` per user-made group, each expanding
        * into an indented sub-list of the same wallet rows behind a
        * dashed rule — a second, nested copy of the list, above the
        * list.
        *
        * A wallets screen answers "what do I own and where". A grouping
        * of it is a different question, and putting both on one screen
        * meant a wallet could appear twice, in two places, with two
        * checkboxes that had to agree.
        *
        * `GroupRow`, `EditGroupModal` and the group store are all still
        * here; the tree is simply not on this screen.
        */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {props.filtered
          .filter((w) => !inlineMemberIds.has(w.wallet_account_id))
          .map((w) => (
            <WalletRow
              key={w.wallet_account_id}
              wallet={w}
              selected={selectedSet.has(w.wallet_account_id)}
              onToggleSelect={toggleSelect}
              balanceLamports={props.balancesByWalletId.get(w.wallet_account_id) ?? null}
              holdingsCount={null}
              onExportKey={props.onExportKey}
              onSetup={props.onSetup}
            />
          ))}
        {props.filtered.length === 0 ? (
          <Caption size="sm" tone="ink-3" style={{ padding: '10px 4px' }}>
            No wallets match your search.
          </Caption>
        ) : null}
      </div>
      {/* Agent section. A labelled hairline separates it from the user
          wallets above: the agent wallet is a different KIND of wallet
          (authorized rather than enabled, and the agent trades from it
          unattended), so the table states that instead of letting it
          read as one more row in the list. It IS one more row for
          selection and totals now — the separation is presentational. */}
      <AgentSectionDivider />
      {props.agentWallet !== null ? (
        <WalletRow
          wallet={props.agentWallet.entry}
          selected={selectedSet.has(props.agentWallet.entry.wallet_account_id)}
          onToggleSelect={toggleSelect}
          balanceLamports={
            props.balancesByWalletId.get(props.agentWallet.entry.wallet_account_id) ?? null
          }
          holdingsCount={null}
          agent={{
            delegation: props.agentWallet.delegation,
            onManage: props.onOpenAgentWallet,
          }}
        />
      ) : (
        <AgentEmptyRow onSetUp={props.onOpenAgentWallet} />
      )}
    </div>
  );
}

/**
 * Section label + hairline in the table's own visual language. Not a
 * `GroupRow`: that row is a user-created wallet GROUP — selectable,
 * expandable, editable, deletable — and none of those verbs apply to
 * the agent section, which is a fixed partition of the table rather
 * than a collection the user assembled.
 */
function AgentSectionDivider(): React.ReactElement {
  return (
    <div
      role="row"
      data-testid="agent-section-divider"
      style={{
        display: 'grid',
        gridTemplateColumns: WALLETS_GRID_TEMPLATE,
        alignItems: 'center',
        gap: 12,
        padding: '10px 10px 4px',
        marginTop: 4,
        borderTop: '1px solid var(--hairline)',
      }}
    >
      {/* Sentence case, no track. It was `AGENT` in capitals on a
          0.04em track — the last of that voice on this tab. */}
      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
        Agent
      </span>
    </div>
  );
}

/**
 * No agent wallet yet.
 *
 * It was a cyan link and a grey sentence sitting loose on the list —
 * `Set up agent wallet` in `--accent-primary` beside "Let the agent
 * trade from its own wallet.", at two sizes, in a row that looked like
 * neither a wallet nor a control. The accent made it the brightest
 * thing on the tab, for a state most people pass once.
 *
 * Now it reads like the rows above it: the name of the thing on the
 * left where a wallet's name goes, what it does under it, and the
 * action as a word at the end of the line where a row's actions are.
 * Nothing coloured, nothing centred, nothing bigger than a row.
 */
function AgentEmptyRow(props: { onSetUp: () => void }): React.ReactElement {
  return (
    <div
      role="row"
      data-testid="agent-wallet-empty-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '9px 10px',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-1)', fontFamily: 'var(--sans)' }}>
          Agent wallet
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}>
          Let the agent trade from its own wallet
        </span>
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={props.onSetUp}
        data-testid="agent-wallet-setup-cta"
        className="wt-word"
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--ink-3)',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--sans)',
        }}
      >
        Set up
      </button>
    </div>
  );
}


