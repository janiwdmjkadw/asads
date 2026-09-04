'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndProvider, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { toast } from 'sonner';
import { useMe, type MeWalletEntry } from '@/lib/api/me';
import { isEligibleWallet, useSelectedWalletStore } from '@/lib/state/selected-wallet-store';
import {
  groupsFromResult,
  useDeleteWalletGroup,
  useWalletGroups,
} from '@/lib/state/wallet-groups-store';
import {
  listWalletBalances,
  type WalletBalancesResult,
} from '@/lib/api/wallet-balances';
import { transferSol, type TransferSolResult } from '@/lib/api/wallets';
import {
  copyForNonConfirmedIntentStatus,
  copyForTransferError,
  isAmbiguousTransferOutcome,
} from '@/components/listen/MoveSolPanel';
import { Caption } from '@/components/listen/primitives';
import { filterWalletsForTable } from './walletsTableFilter';
import { WalletsTabHeader, WalletsTabToolbar } from './WalletsTab.header';
import { EvmWalletsPanel } from '@/components/portfolio/EvmWalletsPanel';
import { EvmActivityHistory } from '@/components/portfolio/EvmActivityHistory';
import { useEvmEnabled } from '@/lib/evm/useEvmEnabled';
import { WalletsTable } from './WalletsTable';
import { TransferRail, type PerPairResult } from './TransferRail';
import { ConfirmDialog } from './ConfirmDialog';
import { TransferModal } from './TransferModal';
import { partitionTransfer, type TransferPair } from './partitionTransfer';
import { CreateGroupModal } from './CreateGroupModal';
import { EditGroupModal } from './EditGroupModal';
import { CreateWalletModal } from './CreateWalletModal';
import { ImportWalletModal } from './ImportWalletModal';
import { WalletSetupModal } from './WalletSetupModal';
import { WALLET_DND_TYPE, type WalletDndItem } from './dnd';
import { WalletRecoveryKeyPanel } from '@/components/listen/WalletRecoveryKeyPanel';
import type { WalletGroup } from '@/lib/api/wallet-groups';
import { AGENT_WALLET_QUERY_KEY, fetchAgentWalletStatus } from '@/components/agent-wallet';
import { AgentWalletModal } from './AgentWalletModal';
import {
  delegationChip,
  AGENT_WALLET_PARAM,
  AGENT_WALLET_SETUP_VALUE,
} from './agentWallet';
import type { AgentWalletRowModel } from './WalletsTable';

/**
 * Slice "Portfolio page wallets tab": owns the left/right split,
 * the DnD provider, show-archived state, group expansion, the
 * modals, AND the transfer-rail selection state (sources + dests).
 *
 * Lifting transfer state here lets a wallet be dragged FROM any
 * section (main list, From Wallet, Destination) and dropped INTO any
 * section — each drop target switches on `item.origin` to decide
 * whether to add, move, or no-op. The main list's drop handler
 * removes a wallet from the rail (so dragging back to the left
 * "ejects" it), while the rail's drop handlers handle main→rail and
 * rail↔rail moves.
 *
 * The submit pipeline (Distribute / Consolidate / Transfer) also
 * lives here so the TransferModal (controlled by the rail's
 * "Start Distribution" CTA) and the rail's `ResultsList` share one
 * source of truth for `submitting` and per-pair results.
 */

const WALLET_BALANCES_KEY = ['api', 'v1', 'wallets', 'balances'] as const;

interface WalletsTabProps {
  /**
   * True when the page was deep-linked with `?agent=setup` (which is
   * also where the retired `/agent-wallet` route now lands). Only seeds
   * the initial state — the modal is user-controlled thereafter.
   */
  readonly initialAgentModalOpen?: boolean;
}

export function WalletsTab(props: WalletsTabProps = {}): React.ReactElement {
  const evmEnabled = useEvmEnabled();
  const { data: me } = useMe();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const groupsQuery = useWalletGroups();
  const deleteGroupMutation = useDeleteWalletGroup();
  const balancesQuery = useQuery<WalletBalancesResult>({
    queryKey: WALLET_BALANCES_KEY,
    queryFn: async ({ signal }) =>
      listWalletBalances({ authToken: await getToken(), signal }),
    enabled: isLoaded && isSignedIn === true,
    staleTime: 8_000,
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  /**
   * Shares `AGENT_WALLET_QUERY_KEY` with `AgentWalletPanel` inside the
   * modal ON PURPOSE: one cache entry means the panel's post-action
   * re-read (create / provision / grant / revoke) updates the table row
   * in the same tick, with no second request and no chance of the row
   * and the modal disagreeing about delegation state.
   */
  const agentQuery = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: ({ signal }) => fetchAgentWalletStatus({ signal }),
    enabled: isLoaded && isSignedIn === true,
    staleTime: 2_000,
    refetchInterval: 15_000,
  });
  /* The filter never stopped being wired, so the field going back on
     the toolbar is the state and nothing else. */
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(props.initialAgentModalOpen === true);
  const [createWalletOpen, setCreateWalletOpen] = useState(false);
  const [importWalletOpen, setImportWalletOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WalletGroup | null>(null);
  const [exportKeyWalletId, setExportKeyWalletId] = useState<string | null>(null);
  const [setupWalletId, setSetupWalletId] = useState<string | null>(null);
  const [sources, setSources] = useState<ReadonlyArray<string>>([]);
  const [destinations, setDestinations] = useState<ReadonlyArray<string>>([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ReadonlyArray<PerPairResult>>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * EVERY wallet the user owns, agent included — `/me.wallets` now
   * carries the agent wallet as a real entry (`purpose: 'agent'`,
   * ordered last), so this list is the single source of truth for the
   * lookup map, the balances join and the header totals.
   */
  const allWallets = useMemo<ReadonlyArray<MeWalletEntry>>(() => {
    if (!me || me.reauth_required) return [];
    return me.wallets;
  }, [me]);

  /**
   * The user wallets only. The table renders the agent wallet in its
   * OWN section below, so it must be absent from the main list — that
   * split is now the ONLY thing keeping the two presentations from
   * rendering the same wallet twice.
   */
  const userWallets = useMemo<ReadonlyArray<MeWalletEntry>>(
    () => allWallets.filter((w) => w.purpose !== 'agent'),
    [allWallets],
  );

  const eligibleVisible = useMemo<ReadonlyArray<MeWalletEntry>>(
    () => allWallets.filter((w) => showArchived || !w.is_archived),
    [allWallets, showArchived],
  );

  const filtered = useMemo<ReadonlyArray<MeWalletEntry>>(
    () => filterWalletsForTable(userWallets, { search, showArchived }),
    [userWallets, search, showArchived],
  );

  /**
   * The agent wallet's REAL `/me.wallets` entry, or null when the user
   * has none. This replaced a synthetic sidecar entry: the wallet is
   * now returned, balanced and traded through exactly the same paths as
   * every other wallet, so building a second parallel copy of it could
   * only make the two disagree.
   */
  const agentEntry = useMemo<MeWalletEntry | null>(
    () => allWallets.find((w) => w.purpose === 'agent') ?? null,
    [allWallets],
  );

  /**
   * Delegation state is the one agent-wallet fact `/me` does NOT carry,
   * so the chip still comes from the status read. Null until it lands —
   * the row no longer waits for it.
   */
  const agentDelegation = useMemo(() => {
    const result = agentQuery.data;
    if (!result || result.kind !== 'ok' || result.value.agentWallet === null) return null;
    return delegationChip(result.value.agentWallet.delegation);
  }, [agentQuery.data]);

  const agentRow = useMemo<AgentWalletRowModel | null>(() => {
    if (agentEntry === null) return null;
    return { entry: agentEntry, delegation: agentDelegation };
  }, [agentEntry, agentDelegation]);

  const walletsById = useMemo<ReadonlyMap<string, MeWalletEntry>>(() => {
    const map = new Map<string, MeWalletEntry>();
    for (const w of allWallets) map.set(w.wallet_account_id, w);
    return map;
  }, [allWallets]);

  const balancesByWalletId = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    const result = balancesQuery.data;
    if (result && result.kind === 'ok') {
      for (const b of result.balances) {
        map.set(b.wallet_account_id, b.lamports);
      }
    }
    return map;
  }, [balancesQuery.data]);

  const selectedIds = useSelectedWalletStore((st) => st.multiSelectedWalletAccountIds);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /*
   * THE STRIP COUNTS WHAT IS SELECTED, not what exists.
   *
   * It read "3 wallets active" and the total of all three whatever you
   * had ticked, so the one line at the top of the page ignored the only
   * control on it. Both figures follow the selection now, and with
   * nothing selected they say so.
   */
  const selectedRows = useMemo(
    () => eligibleVisible.filter((w) => selectedIdSet.has(w.wallet_account_id)),
    [eligibleVisible, selectedIdSet],
  );

  const totalSolDisplay = useMemo<string>(() => {
    let totalLamports = 0n;
    for (const w of selectedRows) {
      const lam = balancesByWalletId.get(w.wallet_account_id);
      if (typeof lam !== 'string') continue;
      try {
        totalLamports += BigInt(lam);
      } catch {
        // skip malformed entries
      }
    }
    if (totalLamports === 0n) return '0 SOL';
    const sol = Number(totalLamports) / 1_000_000_000;
    if (!Number.isFinite(sol)) return '— SOL';
    if (sol < 0.0001) return `${sol.toExponential(2)} SOL`;
    return `${sol.toFixed(4).replace(/\.?0+$/, '')} SOL`;
  }, [selectedRows, balancesByWalletId]);

  const groups = useMemo(() => groupsFromResult(groupsQuery.data), [groupsQuery.data]);
  const activeCount = selectedRows.length;

  /**
   * Keeps `?agent=setup` in step with the modal so the URL stays
   * shareable and a reload re-opens what the user had open.
   *
   * `history.replaceState` rather than `router.replace`: this param
   * seeds state and nothing renders off it after mount, so a Next
   * navigation would re-render the whole tree — and re-mount the DnD
   * provider — to communicate something the component already knows.
   * `replaceState` also keeps the Back button pointing at the page the
   * user arrived from instead of stacking one entry per modal toggle.
   */
  const onAgentModalOpenChange = (open: boolean): void => {
    setAgentModalOpen(open);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (open) url.searchParams.set(AGENT_WALLET_PARAM, AGENT_WALLET_SETUP_VALUE);
    else url.searchParams.delete(AGENT_WALLET_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  };

  /*
   * The group waiting on a confirm. `window.confirm` used to gate this
   * — the browser's own grey sheet in the OS font, over the URL, which
   * blocks the main thread and looks like a crash. See `ConfirmDialog`.
   */
  const [groupPendingDelete, setGroupPendingDelete] = useState<WalletGroup | null>(null);

  const onDeleteGroup = async (group: WalletGroup): Promise<void> => {
    setGroupPendingDelete(null);
    try {
      const result = await deleteGroupMutation.mutateAsync(group.id);
      if (result.kind !== 'ok') {
        toast('Could not delete group', {
          description:
            result.kind === 'error'
              ? result.message
              : result.kind === 'reauth'
                ? 'Session expired. Sign in again to delete.'
                : 'Network error. Try again.',
        });
      }
    } catch {
      toast('Could not delete group', { description: 'Network error. Try again.' });
    }
  };

  const addSource = (walletAccountId: string) => {
    setSources((prev) => (prev.includes(walletAccountId) ? prev : [...prev, walletAccountId]));
  };
  const removeSource = (walletAccountId: string) => {
    setSources((prev) => prev.filter((id) => id !== walletAccountId));
  };
  const addDestination = (walletAccountId: string) => {
    setDestinations((prev) =>
      prev.includes(walletAccountId) ? prev : [...prev, walletAccountId],
    );
  };
  const removeDestination = (walletAccountId: string) => {
    setDestinations((prev) => prev.filter((id) => id !== walletAccountId));
  };

  // Per-chunk idempotency ids, keyed by the chunk's content
  // fingerprint. Retrying the SAME plan reuses the same ids so the
  // server replays / flags in-flight instead of double-sending. Ids
  // are dropped after a DEFINITIVE terminal outcome (so a deliberate
  // re-run is a new transfer) and KEPT after ambiguous outcomes
  // (pending_unconfirmed / network error — the tx may have landed).
  const transferIdsRef = useRef(new Map<string, string>());

  /**
   * Execute the transfer plan computed from current rail selection +
   * the modal's parsed amount:
   *   - partitionTransfer produces 1→1, 1→M, or N→1 pairs;
   *   - pairs sharing a SOURCE are grouped into ONE atomic
   *     multi-destination `transferSol` call (chunked by the api's
   *     destination cap), so a 1→M distribute is all-or-nothing
   *     instead of M races against the same source balance;
   *   - per-pair pending/ok/error status renders via the rail's
   *     ResultsList. Modal is already closed by the caller by the
   *     time we land here, so submit is "fire and forget" from the
   *     user's perspective.
   */
  const onSubmit = async (totalLamports: bigint): Promise<void> => {
    if (submitting) return;
    const plan = partitionTransfer({ sources, destinations, totalLamports });
    if (plan.kind !== 'ok') return;
    setSubmitting(true);
    setSubmitError(null);
    const initial = plan.pairs.map<PerPairResult>((p) => ({ pair: p, status: 'pending' }));
    setResults(initial);

    // Group pair indexes by source wallet, preserving pair order,
    // then chunk by the server's max-destinations cap.
    const bySource = new Map<string, number[]>();
    plan.pairs.forEach((pair, idx) => {
      const existing = bySource.get(pair.sourceWalletAccountId);
      if (existing) existing.push(idx);
      else bySource.set(pair.sourceWalletAccountId, [idx]);
    });
    const chunks: Array<{ source: string; pairIndexes: number[] }> = [];
    for (const [source, idxs] of bySource) {
      for (let i = 0; i < idxs.length; i += MAX_DESTINATIONS_PER_TRANSFER) {
        chunks.push({ source, pairIndexes: idxs.slice(i, i + MAX_DESTINATIONS_PER_TRANSFER) });
      }
    }

    try {
      const token = await getToken();
      const next: PerPairResult[] = [...initial];
      await Promise.all(
        chunks.map(async (chunk) => {
          const fingerprint = chunkFingerprint(chunk.source, chunk.pairIndexes, plan.pairs);
          let clientTransferId = transferIdsRef.current.get(fingerprint);
          if (!clientTransferId) {
            clientTransferId = makeClientTransferId();
            transferIdsRef.current.set(fingerprint, clientTransferId);
          }
          const result = await transferSol(
            {
              clientTransferId,
              sourceWalletAccountId: chunk.source,
              destinations: chunk.pairIndexes.map((i) => ({
                walletAccountId: plan.pairs[i]!.destinationWalletAccountId,
                lamports: plan.pairs[i]!.lamports.toString(),
              })),
            },
            { authToken: token },
          );
          if (!isAmbiguousTransferOutcome(result.kind)) {
            transferIdsRef.current.delete(fingerprint);
          }
          for (const i of chunk.pairIndexes) {
            next[i] = perPairResultFor(plan.pairs[i]!, result);
          }
          setResults([...next]);
        }),
      );
    } catch {
      setSubmitError('Transfer failed. Try again.');
    } finally {
      setSubmitting(false);
    }
    void queryClient.invalidateQueries({ queryKey: WALLET_BALANCES_KEY });
  };

  const onClearResults = () => {
    setResults([]);
    setSubmitError(null);
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-col gap-3 min-h-0 flex-1">
        {/* Stats strip lives ABOVE the panel — "N wallets active" +
            Solana + total SOL on the left, History pill on the right.
            Matches the Axiom reference where these page-level
            counters sit on the page chrome, not inside the framed
            data panel. */}
        <WalletsTabHeader
          activeCount={activeCount}
          totalSolDisplay={totalSolDisplay}
          onImport={() => setImportWalletOpen(true)}
          importDisabled={false}
          onCreateWallet={() => setCreateWalletOpen(true)}
          onCreateGroup={() => setCreateGroupOpen(true)}
          onCreateAgentWallet={() => onAgentModalOpenChange(true)}
        />
        {/*
          One panel holding everything below the stats strip, with
          internal dividers rather than separate cards: a vertical
          hairline at the 50% mark (wallets list | transfer rail) from
          `border-r` on the left cell, and a horizontal one between From
          Wallet and Destination owned by `<TransferRail>`.

          The toolbar lives INSIDE the left cell so its right cluster
          sits at the vertical divider rather than at the panel's far
          edge. Panel padding is removed so the dividers reach the
          edges; each section adds its own inner padding.
        */}
        <section
          role="tabpanel"
          aria-label="Wallets tab"
          className="panel portfolio-panel wallets-panel flex-1 min-h-0 overflow-hidden flex flex-col lg:grid lg:grid-cols-2 lg:grid-rows-1"
        >
          <div
            className="flex flex-col min-w-0 min-h-0 lg:border-r lg:overflow-hidden"
            style={{ borderColor: 'var(--hairline)' }}
          >
            <div
              className="flex items-center px-3 lg:px-4"
              style={{ minHeight: 48, borderBottom: '1px solid var(--hairline)' }}
            >
              <WalletsTabToolbar
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
                search={search}
                onSearchChange={setSearch}
              />
            </div>
            <MainListDropZone
              className="flex-1 min-w-0 min-h-0 lg:overflow-y-auto dk-scroll"
              onEjectSource={removeSource}
              onEjectDestination={removeDestination}
            >
              {me && !me.reauth_required ? (
                <WalletsTable
                  filtered={filtered}
                  allWallets={allWallets}
                  groups={groups}
                  balancesByWalletId={balancesByWalletId}
                  onEditGroup={setEditingGroup}
                  onDeleteGroup={setGroupPendingDelete}
                  onExportKey={setExportKeyWalletId}
                  onSetup={setSetupWalletId}
                  agentWallet={agentRow}
                  onOpenAgentWallet={() => onAgentModalOpenChange(true)}
                />
              ) : (
                <Caption tone="ink-3" style={{ padding: 12 }}>
                  Sign in to view your wallets.
                </Caption>
              )}
            </MainListDropZone>
          </div>
          <TransferRail
            /* `wt-rail` is the hook the phone rules hide it on — two
               drop targets are a dead feature on a touch screen. */
            className="wt-rail min-w-0 min-h-0"
            walletsById={walletsById}
            balancesByWalletId={balancesByWalletId}
            sources={sources}
            destinations={destinations}
            onAddSource={addSource}
            onRemoveSource={removeSource}
            onAddDestination={addDestination}
            onRemoveDestination={removeDestination}
            onOpenTransferModal={() => setTransferModalOpen(true)}
            submitting={submitting}
            results={results}
            onClearResults={onClearResults}
            error={submitError}
          />
        </section>
        <ConfirmDialog
          open={groupPendingDelete !== null}
          title={`Delete ${groupPendingDelete?.name ?? 'group'}?`}
          body="The wallets in it are not affected."
          confirmLabel="Delete group"
          destructive
          busy={deleteGroupMutation.isPending}
          onCancel={() => setGroupPendingDelete(null)}
          onConfirm={() => {
            if (groupPendingDelete !== null) void onDeleteGroup(groupPendingDelete);
          }}
        />

        {/* EVM wallets, below the Solana panel and deliberately outside it:
            the panel above is the Solana transfer rig (drag-to-transfer,
            SOL balances, nonce state), none of which applies to a 0x
            address. Rendering them here makes a provisioned EVM address
            visible and verifiable — it was neither, because nothing in the
            terminal called `GET /api/v1/wallets/evm-balances`. */}
        {evmEnabled ? (
          <>
            <EvmWalletsPanel />
            <EvmActivityHistory />
          </>
        ) : null}
      </div>
      <CreateWalletModal
        open={createWalletOpen}
        onClose={() => setCreateWalletOpen(false)}
      />
      {/* Import is the counterpart of the row's Export: one hands a key
          out, the other takes one back. */}
      <ImportWalletModal open={importWalletOpen} onClose={() => setImportWalletOpen(false)} />
      {/* The whole agent-wallet ceremony — create, fund, nonce pool,
          readiness, grant/revoke. Setup and ongoing management are the
          same modal; there is nowhere else to go to finish one. */}
      <AgentWalletModal open={agentModalOpen} onOpenChange={onAgentModalOpenChange} />
      {/* Per-wallet nonce setup — the onboarding "Enable trading" flow,
          targeted at the clicked "needs setup" wallet. Reads the wallet
          fresh from walletsById each render so the post-setup /me
          refetch flips trade_ready and the modal auto-closes. */}
      <WalletSetupModal
        wallet={setupWalletId !== null ? walletsById.get(setupWalletId) ?? null : null}
        onClose={() => setSetupWalletId(null)}
      />
      <CreateGroupModal
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
      />
      <EditGroupModal
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
      />
      <TransferModal
        open={transferModalOpen}
        onOpenChange={setTransferModalOpen}
        sources={sources}
        destinations={destinations}
        walletsById={walletsById}
        balancesByWalletId={balancesByWalletId}
        onSubmit={onSubmit}
        submitting={submitting}
        agentWalletAccountId={agentRow?.entry.wallet_account_id ?? null}
      />
      {/* Export-private-key modal. The Turnkey iframe inside enforces
          its own auth boundary — the iframe re-prompts the user and
          plaintext key material renders only inside the export.turnkey.com
          origin, never in our React tree. */}
      <WalletRecoveryKeyPanel
        open={exportKeyWalletId !== null}
        onClose={() => setExportKeyWalletId(null)}
        onSuccess={() => undefined}
        initialWalletAccountId={exportKeyWalletId}
      />
    </DndProvider>
  );
}

/**
 * Drop target wrapping the main wallets list. Dropping a row that
 * originated from the rail "ejects" it back to the main list. Drops
 * from origin='main' are a no-op (rearranging within the main list
 * isn't a feature we surface — it just happens via search/filter).
 *
 * Sizing is owned by the parent via `className` so this component
 * stays presentation-free: the parent picks the responsive grid
 * behavior (stack on mobile, equal columns on lg+).
 */
function MainListDropZone(props: {
  readonly className?: string;
  readonly onEjectSource: (walletAccountId: string) => void;
  readonly onEjectDestination: (walletAccountId: string) => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [{ isOver, canDrop }, dropRef] = useDrop<
    WalletDndItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: WALLET_DND_TYPE,
    canDrop: (item) => item.origin !== 'main',
    drop: (item) => {
      // Drop on the main list = "eject" the dragged row from
      // whichever rail zone it came from. With multi-destination
      // we remove ONLY the dragged wallet (not the whole zone),
      // matching the per-row semantics of the trash affordance.
      if (item.origin === 'source') props.onEjectSource(item.walletAccountId);
      else if (item.origin === 'destination') props.onEjectDestination(item.walletAccountId);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  useEffect(() => {
    if (ref.current) dropRef(ref.current);
  }, [dropRef]);

  const dragActive = isOver && canDrop;
  return (
    <div
      ref={ref}
      data-testid="main-list-drop-zone"
      className={`transition-colors ${props.className ?? ''}`}
      style={{
        // Drag-active feedback uses background tint + inset accent
        // ring instead of an outer border, so we don't fight the
        // outer panel's framed chrome or the vertical divider on
        // the right edge of the left cell.
        background: dragActive ? 'var(--accent-soft)' : 'transparent',
        boxShadow: dragActive
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 35%, transparent)'
          : 'none',
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Mirrors `WALLET_TRANSFER_MAX_DESTINATIONS` (api/src/config/env.ts,
 * default 8): the per-request destination cap that bounds the on-chain
 * tx size. Chunks above this are split into multiple atomic calls.
 */
const MAX_DESTINATIONS_PER_TRANSFER = 8;

function makeClientTransferId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Content fingerprint of one chunked transferSol call. */
function chunkFingerprint(
  source: string,
  pairIndexes: ReadonlyArray<number>,
  pairs: ReadonlyArray<TransferPair>,
): string {
  return `${source}|${pairIndexes
    .map((i) => `${pairs[i]!.destinationWalletAccountId}:${pairs[i]!.lamports.toString()}`)
    .join(',')}`;
}

/**
 * Maps one chunk outcome onto a per-pair row. Switches on the typed
 * `result.kind` (reusing the Move SOL copy table) instead of
 * collapsing everything to a generic "transfer failed";
 * `pending_unconfirmed` carries explicit may-have-landed copy that
 * never invites an immediate retry.
 */
function perPairResultFor(pair: TransferPair, result: TransferSolResult): PerPairResult {
  if (result.kind === 'ok' && result.intent.status === 'confirmed') {
    const sig = result.intent.signature ?? undefined;
    return { pair, status: 'ok', ...(sig ? { signature: sig } : {}) };
  }
  if (result.kind === 'ok') {
    // Idempotency replay of a previous non-confirmed attempt — never
    // render it as a fresh success.
    return {
      pair,
      status: 'error',
      message: copyForNonConfirmedIntentStatus(result.intent.status),
    };
  }
  return { pair, status: 'error', message: copyForTransferError(result) };
}
