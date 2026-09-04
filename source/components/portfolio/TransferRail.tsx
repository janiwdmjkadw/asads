'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { useDrop } from 'react-dnd';
import type { MeWalletEntry } from '@/lib/api/me';
import { walletDisplayName } from '@/components/listen/WalletSelector';
import { ArrowDown, Solana } from '@/components/listen/icons/Icons';
import { WALLET_DND_TYPE, type WalletDndItem } from './dnd';
import type { TransferPair } from './partitionTransfer';
import { WalletsHeaderRow } from './tableLayout';
import { formatSolBalance, WalletRow } from './WalletRow';

/**
 * Slice "Portfolio page wallets tab": right-rail drag-drop transfer
 * surface. Mirrors Axiom's "rail is a second table" design.
 *
 *   - From Wallet zone (multi): rendered as a mini-table with the
 *     same grid as the main list, each dropped wallet is a full
 *     WalletRow with a trash "remove" affordance.
 *   - Destination zone (multi): same shape as From, now also a
 *     multi-slot zone so a 1→N distribution can target multiple
 *     wallets. Start Distribution is pinned inline-right with the
 *     header and OPENS the shadcn TransferModal — it no longer
 *     executes the transfer inline (the modal owns the amount and
 *     fires `onSubmit` on confirm).
 *
 * State (sources / destinations / submit pipeline / per-pair
 * results) lives in `WalletsTab` so the main list can also be a
 * drop target (dropping a rail wallet back onto the left "ejects"
 * it). Drop handlers here switch on `item.origin` to support all
 * six directions:
 *   main → source, main → destination,
 *   source ↔ destination, source → main, destination → main.
 */

export interface PerPairResult {
  readonly pair: TransferPair;
  readonly status: 'pending' | 'ok' | 'error';
  readonly message?: string;
  readonly signature?: string;
}

interface Props {
  readonly className?: string;
  readonly walletsById: ReadonlyMap<string, MeWalletEntry>;
  readonly balancesByWalletId: ReadonlyMap<string, string>;
  readonly sources: ReadonlyArray<string>;
  readonly destinations: ReadonlyArray<string>;
  readonly onAddSource: (walletAccountId: string) => void;
  readonly onRemoveSource: (walletAccountId: string) => void;
  readonly onAddDestination: (walletAccountId: string) => void;
  readonly onRemoveDestination: (walletAccountId: string) => void;
  readonly onOpenTransferModal: () => void;
  readonly submitting: boolean;
  readonly results: ReadonlyArray<PerPairResult>;
  readonly onClearResults: () => void;
  readonly error: string | null;
}

export function TransferRail(props: Props & { readonly 'data-idle'?: string }): React.ReactElement {
  const sourceWallets = props.sources
    .map((id) => props.walletsById.get(id))
    .filter((w): w is MeWalletEntry => w !== undefined);
  const destinationWallets = props.destinations
    .map((id) => props.walletsById.get(id))
    .filter((w): w is MeWalletEntry => w !== undefined);

  // Both sides need at least one wallet for a transfer to be
  // possible — the modal owns the amount + plan validity, but
  // there's no point opening it with an empty shape.
  const canOpenModal =
    !props.submitting &&
    props.sources.length > 0 &&
    props.destinations.length > 0;

  return (
    <aside className={`grid grid-rows-2 ${props.className ?? ''}`} data-idle={props['data-idle']}>
      <FromWalletZone
        wallets={sourceWallets}
        balancesByWalletId={props.balancesByWalletId}
        onAddSource={props.onAddSource}
        onRemoveSource={props.onRemoveSource}
        onRemoveDestination={props.onRemoveDestination}
      />
      <ToWalletZone
        wallets={destinationWallets}
        balancesByWalletId={props.balancesByWalletId}
        onAddDestination={props.onAddDestination}
        onRemoveDestination={props.onRemoveDestination}
        onRemoveSource={props.onRemoveSource}
        canOpen={canOpenModal}
        submitting={props.submitting}
        onOpenTransferModal={props.onOpenTransferModal}
      />
      {props.results.length > 0 ? (
        <ResultsList
          results={props.results}
          walletsById={props.walletsById}
          onDismiss={props.onClearResults}
        />
      ) : null}
      {props.error ? (
        <p
          className="text-[11px] m-0"
          style={{ color: 'var(--down)', fontFamily: 'var(--sans)' }}
        >
          {props.error}
        </p>
      ) : null}
    </aside>
  );
}

function FromWalletZone(props: {
  readonly wallets: ReadonlyArray<MeWalletEntry>;
  readonly balancesByWalletId: ReadonlyMap<string, string>;
  readonly onAddSource: (walletAccountId: string) => void;
  readonly onRemoveSource: (walletAccountId: string) => void;
  readonly onRemoveDestination: (walletAccountId: string) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [{ isOver, canDrop }, dropRef] = useDrop<
    WalletDndItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: WALLET_DND_TYPE,
    canDrop: (item) => item.origin !== 'source',
    drop: (item) => {
      if (item.origin === 'destination') {
        props.onRemoveDestination(item.walletAccountId);
      }
      props.onAddSource(item.walletAccountId);
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
    <ZoneCard
      cardRef={ref}
      title="From Wallet"
      totalSol={sumWalletsToSol(props.wallets, props.balancesByWalletId)}
      dragActive={dragActive}
      testId="transfer-source-zone"
      bottomDivider
    >
      {props.wallets.length === 0 ? (
        <ZoneEmpty hint="Drag wallets to distribute SOL" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {props.wallets.map((w) => (
            <WalletRow
              key={`src-${w.wallet_account_id}`}
              wallet={w}
              selected={false}
              onToggleSelect={() => undefined}
              balanceLamports={props.balancesByWalletId.get(w.wallet_account_id) ?? null}
              holdingsCount={null}
              onRemove={() => props.onRemoveSource(w.wallet_account_id)}
              hidePin
              origin="source"
            />
          ))}
        </div>
      )}
    </ZoneCard>
  );
}

function ToWalletZone(props: {
  readonly wallets: ReadonlyArray<MeWalletEntry>;
  readonly balancesByWalletId: ReadonlyMap<string, string>;
  readonly onAddDestination: (walletAccountId: string) => void;
  readonly onRemoveDestination: (walletAccountId: string) => void;
  readonly onRemoveSource: (walletAccountId: string) => void;
  readonly canOpen: boolean;
  readonly submitting: boolean;
  readonly onOpenTransferModal: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const [{ isOver, canDrop }, dropRef] = useDrop<
    WalletDndItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(() => ({
    accept: WALLET_DND_TYPE,
    canDrop: (item) => item.origin !== 'destination',
    drop: (item) => {
      if (item.origin === 'source') {
        props.onRemoveSource(item.walletAccountId);
      }
      props.onAddDestination(item.walletAccountId);
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
    <ZoneCard
      cardRef={ref}
      title="Destination"
      totalSol={sumWalletsToSol(props.wallets, props.balancesByWalletId)}
      dragActive={dragActive}
      testId="transfer-destination-zone"
      headerRight={
        <button
          type="button"
          onClick={props.onOpenTransferModal}
          disabled={!props.canOpen}
          data-testid="transfer-start-button"
          style={inlineStartButtonStyle(props.canOpen)}
        >
          {props.submitting ? 'Sending…' : 'Start Distribution'}
        </button>
      }
    >
      {props.wallets.length === 0 ? (
        <ZoneEmpty hint="Drag wallets here" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {props.wallets.map((w) => (
            <WalletRow
              key={`dst-${w.wallet_account_id}`}
              wallet={w}
              selected={false}
              onToggleSelect={() => undefined}
              balanceLamports={props.balancesByWalletId.get(w.wallet_account_id) ?? null}
              holdingsCount={null}
              onRemove={() => props.onRemoveDestination(w.wallet_account_id)}
              hidePin
              origin="destination"
            />
          ))}
        </div>
      )}
    </ZoneCard>
  );
}

/**
 * Bordered drop-zone card. Mirrors Axiom's reference: outer 1px border,
 * a label header strip with a bottom rule, the shared column headers
 * (also with a bottom rule), and a flexible content area below that
 * either holds dropped wallet rows or a centered empty-state arrow.
 *
 * The whole card is the drop target — `cardRef` is wired into the
 * parent's `useDrop` so anywhere inside the card body accepts the
 * dropped wallet.
 */
function ZoneCard(props: {
  readonly cardRef: React.RefObject<HTMLDivElement | null>;
  readonly title: string;
  readonly totalSol?: string;
  readonly headerRight?: React.ReactNode;
  readonly dragActive: boolean;
  readonly testId: string;
  readonly bottomDivider?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      ref={props.cardRef}
      data-testid={props.testId}
      className="min-h-0 flex flex-col overflow-hidden transition-colors"
      style={{
        borderBottom: props.bottomDivider ? '1px solid var(--hairline)' : 'none',
        background: props.dragActive
          ? 'color-mix(in srgb, var(--accent-soft) 60%, transparent)'
          : 'transparent',
        boxShadow: props.dragActive
          ? 'inset 0 0 0 1px color-mix(in srgb, var(--ink-0) 28%, transparent)'
          : 'none',
      }}
    >
      <ZoneCardHeader
        title={props.title}
        totalSol={props.totalSol}
        right={props.headerRight}
      />
      <WalletsHeaderRow />
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        {props.children}
      </div>
    </div>
  );
}

function ZoneCardHeader(props: {
  title: string;
  totalSol?: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
        padding: '0 12px',
        borderBottom: '1px solid var(--hairline)',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 13,
            color: 'var(--ink-0)',
            fontWeight: 600,
            letterSpacing: '-0.005em',
          }}
        >
          {props.title}
        </span>
        {props.totalSol !== undefined ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Solana style={{ width: 16, height: 16 }} />
            <span
              style={{
                fontFamily: 'var(--sans)',
                fontSize: 14,
                color: 'var(--ink-2)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {props.totalSol}
            </span>
          </span>
        ) : null}
      </div>
      {props.right ?? null}
    </div>
  );
}

/**
 * Sum a list of wallets' lamport balances and return a formatted SOL
 * number (no "SOL" suffix — the adjacent Solana icon implies it).
 * Returns "0" when the list is empty or all balances are unknown.
 */
function sumWalletsToSol(
  wallets: ReadonlyArray<MeWalletEntry>,
  balancesByWalletId: ReadonlyMap<string, string>,
): string {
  let totalLamports = 0n;
  for (const w of wallets) {
    const lam = balancesByWalletId.get(w.wallet_account_id);
    if (typeof lam !== 'string') continue;
    try {
      totalLamports += BigInt(lam);
    } catch {
      /* skip malformed */
    }
  }
  return formatSolBalance(totalLamports.toString());
}

function ZoneEmpty(props: { hint: string }): React.ReactElement {
  return (
    <div
      className="flex-1 min-h-[140px] p-6 flex flex-col items-center justify-center gap-2.5 text-center text-[12px]"
      style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)' }}
    >
      <ArrowDown style={{ width: 22, height: 22, opacity: 0.5 }} />
      <span>{props.hint}</span>
    </div>
  );
}

function ResultsList(props: {
  results: ReadonlyArray<PerPairResult>;
  walletsById: ReadonlyMap<string, MeWalletEntry>;
  onDismiss: () => void;
}): React.ReactElement {
  const succeeded = props.results.filter((r) => r.status === 'ok').length;
  return (
    <div
      style={{
        border: '1px solid var(--hairline)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--surface-1)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--ink-0)', fontWeight: 500 }}>
          Transfer: {succeeded} / {props.results.length} succeeded
        </span>
        <button
          type="button"
          onClick={props.onDismiss}
          style={{
            background: 'transparent',
            border: '1px solid var(--hairline)',
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 11,
            color: 'var(--ink-3)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
      {props.results.map((r) => {
        const src = props.walletsById.get(r.pair.sourceWalletAccountId);
        const dst = props.walletsById.get(r.pair.destinationWalletAccountId);
        return (
          <div
            key={`${r.pair.sourceWalletAccountId}->${r.pair.destinationWalletAccountId}`}
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <span style={{ fontSize: 11, color: 'var(--ink-1)' }}>
              {src ? walletDisplayName(src) : '—'} → {dst ? walletDisplayName(dst) : '—'}
            </span>
            <span
              style={{
                fontSize: 10,
                color:
                  r.status === 'ok'
                    ? 'var(--up)'
                    : r.status === 'error'
                      ? 'var(--down)'
                      : 'var(--ink-3)',
              }}
            >
              {r.status === 'pending'
                ? 'pending'
                : r.status === 'ok'
                  ? `sent · ${(r.signature ?? '').slice(0, 8)}…`
                  : (r.message ?? 'failed')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function inlineStartButtonStyle(canSubmit: boolean): CSSProperties {
  return {
    background: canSubmit ? 'var(--accent-soft)' : 'transparent',
    color: canSubmit ? 'var(--ink-0)' : 'var(--ink-3)',
    border: `1px solid ${canSubmit ? 'color-mix(in srgb, var(--ink-0) 22%, var(--hairline))' : 'var(--hairline)'}`,
    borderRadius: 999,
    padding: '4px 12px',
    fontSize: 11,
    cursor: canSubmit ? 'pointer' : 'not-allowed',
    fontFamily: 'var(--sans)',
    height: 24,
    lineHeight: 1,
  };
}
